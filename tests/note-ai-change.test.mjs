import test from 'node:test';
import assert from 'node:assert/strict';
import { proposeNoteChange, noteChangePatch, validNoteAiChange, sameNote, noteSnapshot } from '../app/note-ai-change.ts';
import { resolveNoteAiChange } from '../app/note-ai-resolve.ts';
import { applyAiBoardActions } from '../app/ai-board-actions.ts';
import { AiBoardToolSession, readAiBoardActions, aiBoardActionsAllowed } from '../lib/ai-board-tools.ts';
import { patchCanvasCard } from '../app/canvas-card-update.ts';
import { createAiOperationRecord, validAiOperationRecords, aiOperationStatus, undoAiOperation } from '../app/ai-operation-history.ts';
import { readWorkspace } from '../app/workspace-store.ts';
import { mergeRestoredWorkspace, createWorkspaceBackup, readWorkspaceBackup } from '../app/workspace-backup.ts';
import { readStoredDocument, registerStoredDocumentCards } from '../app/stored-document.ts';
import { serializeWorkspace, fileReferences } from '../app/workspace-assets.ts';
import { enableBoardThesis, createThesisArtifact } from '../app/thesis-board.ts';
import { noteMarkdown } from '../app/note-markdown.ts';
import { boardActionReferences } from '../app/ai-board-action-references.ts';
import { readAiBoardActionResult } from '../app/ai-chat-store.ts';
const note = (id = 'one', extra = {}) => ({ id, kind: 'note', title: id, body: 'Original', x: 0, y: 0, width: 360, ...extra });
const board = cards => ({ id: 'board', title: 'Board', cards: cards || [note(), note('two')], edges: [] });
const batch = (updates = [{ cardId: 'one', body: 'Revised one' }, { cardId: 'two', body: 'Revised two' }]) => ({ id: 'operation', boardId: 'board', notes: [], connections: [], updates });
const snapshot = b => ({ version: 1, boards: [b], deletedBoards: [], activeId: b.id, nextUntitledIndex: 1 });
const parsed = markdown => [{ type: 'paragraph', content: markdown }];
const deps = { flush: async () => {}, parseMarkdown: parsed };
const details = { chatId: 'chat', messageId: 'answer', request: '修改这两张笔记', answer: '建议已准备', process: [] };

void test('tools allow multiple existing notes, reject files, duplicates, extra keys, overflow and review target injection', () => {
 const s = new AiBoardToolSession({ boardId: 'board', cards: [note(), note('two'), note('pdf', {kind:'pdf'})].map(({id,title,kind})=>({id,title,kind})), edges: [] }, 'operation');
 assert.ok(s.execute('propose_note_update', {cardId:'pdf',body:'invalid'}).error);
 assert.ok(s.execute('propose_note_update', {cardId:'missing',body:'invalid'}).error);
 assert.equal(s.execute('propose_note_update', {cardId:'one',body:'First'}).awaiting_acceptance, true);
 assert.ok(s.executeReview({notes:[],connections:[],updates:[{cardId:'two',body:'Injected'}]}).error);
 assert.equal(s.execute('propose_note_update', {cardId:'two',body:'Second'}).update_count, 2);
 assert.equal(s.executeReview({notes:[],connections:[],updates:[{cardId:'one',body:'Reviewed'},{cardId:'two',body:'Reviewed second'}]}).reviewed,true);
 const actions=s.snapshot();assert.equal(aiBoardActionsAllowed('update_notes',actions),true);assert.equal(aiBoardActionsAllowed('create_notes',actions),false);
 for(const updates of [[{cardId:'one',body:'x'},{cardId:'one',body:'y'}],[{cardId:'new:1',body:'x'}],[{cardId:'one',body:'x',title:'bad'}],Array.from({length:13},(_,i)=>({cardId:`c${i}`,body:'x'})),[{cardId:'one',body:'x'.repeat(20001)}]])assert.throws(()=>readAiBoardActions(batch(updates)));
});

void test('multi-note staging is atomic and preserves originals; fresh proposals cannot replace pending ones or mid-flight edits', () => {
 const before=board(), after=applyAiBoardActions(before,batch(),{layoutSnapshot:{cards:before.cards}});
 assert.equal(after.suggestedUpdates,2);assert.equal(after.createdCards,0);assert.equal(after.board.cards[0].body,'Original');
 assert.equal(before.cards[0].aiNoteChange,undefined);assert.ok(after.board.cards.every(c=>validNoteAiChange(c.aiNoteChange)));
 assert.equal(applyAiBoardActions(after.board,batch()).alreadyApplied,true);
 assert.throws(()=>applyAiBoardActions({...after.board,cards:[after.board.cards[0],before.cards[1]]},batch()),/部分保存/);
 assert.throws(()=>applyAiBoardActions({...before,cards:[before.cards[0],{...before.cards[1],body:'User edit'}]},batch(),{layoutSnapshot:{cards:before.cards}}),/生成期间/);
 assert.throws(()=>applyAiBoardActions(after.board,{...batch(),id:'next'},{layoutSnapshot:{cards:after.board.cards}}),/待处理/);
 assert.throws(()=>applyAiBoardActions(before,batch()),/本次范围/);
 const shared=board([note('one',{sharedId:'same'}),note('two',{sharedId:'same'})]);assert.throws(()=>applyAiBoardActions(shared,batch(),{layoutSnapshot:{cards:shared.cards}}),/共享引用/);
});

void test('accept, dismiss and durable undo operate per card, preserve attachments, and refuse later edits', async () => {
 let b=board([note('one',{blocks:[{type:'paragraph',content:'Original'},{type:'file',props:{url:'https://example.com/original.pdf',name:'Original'}}]}),note('two')]);
 b=applyAiBoardActions(b,batch(),{layoutSnapshot:{cards:b.cards}}).board;
 const proposal=b.cards[0].aiNoteChange;
 const commit=patch=>{b=patchCanvasCard(b,'one',patch,[b]).board;};
 await resolveNoteAiChange(()=>b.cards[0],proposal,'accept',commit,deps);
 assert.equal(b.cards[0].body,'Revised one');assert.equal(b.cards[0].blocks.at(-1).props.url,'https://example.com/original.pdf');
 assert.equal(b.cards[1].body,'Original');assert.ok(b.cards[1].aiNoteChange);assert.ok(b.cards[0].aiNoteChange.accepted);
 b=readWorkspace(JSON.stringify(snapshot(b))).boards[0];assert.ok(validNoteAiChange(b.cards[0].aiNoteChange));
 const accepted=b.cards[0].aiNoteChange;
 await assert.rejects(resolveNoteAiChange(()=>({...b.cards[0],body:'Later edit'}),accepted,'undo',()=>assert.fail('overwrite'),deps),/后续修改/);
 await resolveNoteAiChange(()=>b.cards[0],accepted,'undo',commit,deps);assert.equal(b.cards[0].body,'Original');assert.equal(b.cards[0].aiNoteChange,undefined);
 const second=b.cards[1];const patched=noteChangePatch({...second,body:'Newer'},second.aiNoteChange,'dismiss');assert.equal(patched.body,undefined);assert.equal(patched.aiNoteChange,undefined);
});

void test('a card changed while parsing is never overwritten and parse failure retains its pending proposal', async () => {
 let card=proposeNoteChange(note(),note(),'op','Change');const change=card.aiNoteChange;
 await assert.rejects(resolveNoteAiChange(()=>card,change,'accept',()=>assert.fail('commit'),{...deps,parseMarkdown:()=>{card={...card,body:'Typed meanwhile'};return parsed('Change');}}),/后续修改/);
 assert.equal(card.body,'Typed meanwhile');assert.equal(card.aiNoteChange,change);
 const other=proposeNoteChange(note('parse'),note('parse'),'op','Change');await assert.rejects(resolveNoteAiChange(()=>other,other.aiNoteChange,'accept',()=>assert.fail('commit'),{...deps,parseMarkdown:()=>{throw Error('parse failed');}}),/parse failed/);
});

void test('shared note acceptance and undo propagate contents, while MBA manual-edit revision guards still run', async () => {
 let b=createThesisArtifact(enableBoardThesis(board([])),'thesis/topic.md','## 一句话研究问题\n\nOld question');const original=b.cards[0];
 b={...b,cards:[{...original,aiNoteChange:proposeNoteChange(original,original,'generic','## 一句话研究问题\n\nNew question').aiNoteChange}]};
 let boards=[b,{id:'other-board',title:'Other',cards:[{...b.cards[0],id:'copy',sharedId:original.id,x:900}],edges:[]}];
 const commit=patch=>{const next=patchCanvasCard(b,original.id,patch,boards);b=next.board;boards=next.boards;};
 await resolveNoteAiChange(()=>b.cards[0],b.cards[0].aiNoteChange,'accept',commit,deps);
 assert.equal(boards[1].cards[0].body,b.cards[0].body);assert.equal(boards[1].cards[0].x,900);assert.ok(b.thesis.topicVersion>1);assert.ok(b.thesis.history.length);
 await resolveNoteAiChange(()=>b.cards[0],b.cards[0].aiNoteChange,'undo',commit,deps);assert.equal(boards[1].cards[0].body,original.body);
});

void test('suggestion receipts persist, withdraw only pending suggestions, and never undo accepted content in a batch', async () => {
 const before=board();let b=applyAiBoardActions(before,batch(),{layoutSnapshot:{cards:before.cards}}).board;
 const record=createAiOperationRecord(before,b,'operation',details);b={...b,aiOperations:[record]};
 assert.equal(validAiOperationRecords([record]),true);assert.equal(aiOperationStatus(b,record),'applied');
 const withdrawn=undoAiOperation(b,'operation');assert.equal(withdrawn.cards[0].body,'Original');assert.equal(aiOperationStatus(withdrawn,record),'undone');
 assert.equal(applyAiBoardActions(withdrawn,batch()).alreadyApplied,true);
 await resolveNoteAiChange(()=>b.cards[0],b.cards[0].aiNoteChange,'accept',patch=>{b={...b,cards:[{...b.cards[0],...patch},b.cards[1]]};},deps);
 assert.equal(aiOperationStatus(b,record),'reviewed');assert.throws(()=>undoAiOperation(b,'operation'),/每张笔记/);
 assert.equal(readAiBoardActionResult({id:'operation',createdCards:0,createdConnections:0,suggestedUpdates:2}).suggestedUpdates,2);
 assert.equal(readWorkspace(JSON.stringify(snapshot(b))).boards[0].aiOperations[0].version,3);
});

void test('imported notes save immutable internal documents, reload and undo without altering original Markdown', async () => {
 const id=crypto.randomUUID(),source=`lumior-file:${id}`;let card=note(id,{body:'',storedDocument:{version:1,source,path:'Note.md',libraryId:id},obsidianSource:{libraryId:id,path:'Note.md'}});
 const original=new Blob(['# Original vault file']);const files=new Map([[id,{id,name:'Note.md',type:'text/markdown',size:original.size,blob:original}]]);
 const io={...deps,getFile:async id=>files.get(id),putFile:async file=>{files.set(file.id,file);}};
 registerStoredDocumentCards([card]);card=proposeNoteChange(card,card,'import-op','Revised text');
 await resolveNoteAiChange(()=>card,card.aiNoteChange,'accept',patch=>{card={...card,...patch};},io);
 assert.equal(card.body,'');assert.equal(card.blocks,undefined);assert.ok(card.storedDocument.document);assert.equal(card.storedDocument.source,source);
 const loaded=await readStoredDocument(card,io);assert.equal(loaded.body,'Revised text');assert.equal(await files.get(id).blob.text(),'# Original vault file');
 const saved=serializeWorkspace(card);assert.equal(validNoteAiChange(saved.aiNoteChange),true);
 const backup=await readWorkspaceBackup(await createWorkspaceBackup(snapshot(board([saved])),io,()=>{}),()=>{});
 assert.ok(backup.files.length>=2);assert.ok(fileReferences(backup.snapshot).includes(source));
 const restored=mergeRestoredWorkspace(snapshot(board([])),backup.snapshot).boards.at(-1).cards[0];
 assert.ok(sameNote(restored,restored.aiNoteChange.accepted));
 await resolveNoteAiChange(()=>card,card.aiNoteChange,'undo',patch=>{card={...card,...patch};},io);
 assert.equal(card.storedDocument.document,undefined);assert.equal(card.storedDocument.source,source);
});

void test('failed or stale imported-note writes do not expose the proposed text as a draft or poison future saves', async () => {
 const id=crypto.randomUUID();let card=note(id,{body:'',storedDocument:{version:1,source:`lumior-file:${id}`,path:'Note.md',libraryId:id}});
 const blob=new Blob(['Original']);const io={...deps,getFile:async key=>key===id?{id,name:'Note.md',type:'text/markdown',size:blob.size,blob}:undefined};registerStoredDocumentCards([card]);card=proposeNoteChange(card,card,'op','Must not leak');
 await assert.rejects(resolveNoteAiChange(()=>card,card.aiNoteChange,'accept',()=>assert.fail('commit'),{...io,putFile:async()=>{throw Error('Disk full');}}),/Disk full/);
 assert.equal((await readStoredDocument(card,io)).body,'Original');assert.equal(card.storedDocument.document,undefined);
 await assert.rejects(resolveNoteAiChange(()=>card,card.aiNoteChange,'accept',()=>assert.fail('commit'),{...io,putFile:async()=>{card={...card,title:'Renamed during write'};}}),/后续修改/);
 assert.equal((await readStoredDocument(card,io)).body,'Original');
});

void test('backup restores pending snapshots and link targets together; malformed suggestions reject workspace', () => {
 let card=note('one',{body:'[Second](?lumior-content=two)'});card=proposeNoteChange(card,card,'op','Revised');
 const b=board([card,note('two')]);const restored=mergeRestoredWorkspace(snapshot(board([])),snapshot(b)).boards.at(-1);
 assert.ok(sameNote(restored.cards[0],restored.cards[0].aiNoteChange.base));
 const invalid={...b,cards:[{...card,aiNoteChange:{...card.aiNoteChange,base:{title:5}}}]};assert.equal(readWorkspace(JSON.stringify(snapshot(invalid))),null);
});

void test('note sources retain headings, rich text, links and citations are made readable in proposed text', () => {
 const card=note('rich',{blocks:[{type:'heading',props:{level:2},content:[{type:'text',text:'Heading',styles:{}}]},{type:'paragraph',content:[{type:'link',href:'https://example.com',content:[{type:'text',text:'Evidence',styles:{bold:true}}]}]}]});
 assert.match(noteMarkdown(card),/## Heading/);assert.match(noteMarkdown(card),/\[\*\*Evidence\*\*\]\(https:\/\/example.com\)/);
 const actions=boardActionReferences(batch([{cardId:'one',body:'Update [Lumior:1]'}]),{sources:[{id:'two',title:'Source',location:'p. 1'}]});
 assert.ok(!actions.updates[0].body.includes('[Lumior:'));assert.match(actions.updates[0].body,/Source/);
});
