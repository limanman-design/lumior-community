import test from 'node:test';
import assert from 'node:assert/strict';
import { createThesisArtifact, enableBoardThesis, applyThesisResult, boardThesisSnapshot, thesisInputSignature, thesisCardMarkdown, validBoardThesis } from '../app/thesis-board.ts';
import { resolveBoardNoteChange, boardNoteChangePreview } from '../app/board-note-ai-change.ts';
import { patchCanvasCard } from '../app/canvas-card-update.ts';
import { newThesisSession } from '../lib/thesis/model.ts';
import { validNoteAiChange, proposeNoteChange } from '../app/note-ai-change.ts';
const path='thesis/topic.md';
const initial=()=>createThesisArtifact(createThesisArtifact(enableBoardThesis({id:'board',title:'Board',cards:[],edges:[]}),path,'Original'),'thesis/review-draft.md','Existing review');
const propose=b=>applyThesisResult(b,thesisInputSignature(b),{snapshot:{...boardThesisSnapshot(b),files:{[path]:{path,text:'# 选题卡 v2\n\nNew topic',modifiedAt:1}}},changed:[path],session:newThesisSession('mba-topic','chat')},'chat');
const deps={flush:async()=>{},parseMarkdown:async text=>[{type:'paragraph',content:text}]};
function harness(value){
 let board=value;
 return {get board(){return board;},set board(b){board=b;},resolve:(accept,extra={})=>resolveBoardNoteChange(board,board.cards[0],accept,()=>board,
  patch=>{board=patchCanvasCard(board,board.cards[0].id,patch,[board]).board;},fn=>{board=fn(board);},{...deps,...extra})};
}
void test('MBA accepts through common parser, preserves attachments, offers undo and retains thesis revisions',async()=>{
 const original=initial();original.cards[0].blocks=[{type:'paragraph',content:'Original'},{type:'file',props:{url:'lumior-file:attachment',name:'Evidence'}}];
 const h=harness(propose(original));const saved=JSON.stringify(h.board);
 assert.equal(boardNoteChangePreview(h.board,h.board.cards[0]).accepted,false);
 await h.resolve(true);
 assert.equal(h.board.thesis.proposals[path],undefined);
 assert.equal(h.board.thesis.topicVersion,2);assert.ok(h.board.thesis.artifacts['thesis/review-draft.md'].needsReview);
 assert.equal(h.board.cards[1].body,'Existing review');assert.equal(h.board.cards[0].blocks[1].props.url,'lumior-file:attachment');
 assert.equal(validNoteAiChange(h.board.cards[0].aiNoteChange),true);
 assert.equal(boardNoteChangePreview(h.board,h.board.cards[0]).accepted,true);
 assert.equal(h.board.thesis.history.length,1);
 h.board=JSON.parse(JSON.stringify(h.board));assert.equal(validBoardThesis(h.board.thesis),true);
 await h.resolve(true);
 assert.equal(h.board.cards[0].body,original.cards[0].body);assert.deepEqual(h.board.cards[0].blocks,original.cards[0].blocks);
 assert.equal(h.board.cards[0].aiNoteChange,undefined);assert.equal(h.board.thesis.topicVersion,3);
 assert.equal(h.board.thesis.history.length,2);assert.notEqual(JSON.stringify(h.board),saved);
});
void test('old saved MBA proposals adapt without migration; dismiss preserves contents',async()=>{
 const b=initial();b.thesis.proposals[path]={path,text:'Legacy change',base:`${b.cards[0].title}\n${thesisCardMarkdown(b.cards[0])}`,topicVersion:1,at:12};
 const h=harness(b);await h.resolve(true);assert.equal(h.board.cards[0].body,'Legacy change');
 const dismissed=harness(propose(initial()));const before=structuredClone(dismissed.board.cards);
 await dismissed.resolve(false);assert.deepEqual(dismissed.board.cards,before);assert.equal(dismissed.board.thesis.proposals[path],undefined);
});
void test('rich link edits and edits during parsing reject stale MBA replacements',async()=>{
 const b=initial();b.cards[0].blocks=[{type:'paragraph',content:[{type:'link',href:'https://example.org/old',content:'Evidence'}]}];
 const h=harness(propose(b));h.board=structuredClone(h.board);h.board.cards[0].blocks[0].content[0].href='https://example.org/new';
 await assert.rejects(h.resolve(true),/又有变化/);
 const r=harness(propose(initial()));
 await assert.rejects(r.resolve(true,{parseMarkdown:async()=>{r.board={...r.board,cards:r.board.cards.map((c,i)=>i?c:{...c,body:'User typed meanwhile'})};return [{type:'paragraph',content:'New topic'}];}}),/又有变化/);
 assert.equal(r.board.cards[0].body,'User typed meanwhile');assert.ok(r.board.thesis.proposals[path]);assert.equal(r.board.thesis.history.length,0);
});
void test('undo never overrides subsequent user edits; failed parse and switched board do not commit',async()=>{
 const h=harness(propose(initial()));await h.resolve(true);h.board.cards[0]={...h.board.cards[0],body:'Later edit'};
 await assert.rejects(h.resolve(true),/后续修改/);assert.equal(h.board.cards[0].body,'Later edit');
 const f=harness(propose(initial()));const before=JSON.stringify(f.board);
 await assert.rejects(f.resolve(true,{parseMarkdown:async()=>{throw Error('parse failed');}}),/parse failed/);assert.equal(JSON.stringify(f.board),before);
 await assert.rejects(f.resolve(true,{parseMarkdown:async()=>{f.board={...f.board,id:'other'};return [];}}),/画板已切换/);
});
void test('ordinary suggestions on MBA cards retain common accept/undo and version rules',async()=>{
 const b=initial();b.cards[0]=proposeNoteChange(b.cards[0],b.cards[0],'ordinary','Different topic');
 const h=harness(b);await h.resolve(true);assert.equal(h.board.cards[0].body,'Different topic');assert.equal(h.board.thesis.topicVersion,2);
 await h.resolve(true);assert.equal(h.board.cards[0].body,'Original');assert.ok(h.board.thesis.artifacts['thesis/review-draft.md'].needsReview);
});
void test('an oversized legacy proposal remains pending instead of saving an invalid undo record',async()=>{
 const h=harness(propose(initial()));h.board.thesis.proposals[path].text='x'.repeat(120001);
 const before=JSON.stringify(h.board);await assert.rejects(h.resolve(true),/长度/);assert.equal(JSON.stringify(h.board),before);
});
