import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAiBoardActions } from '../app/ai-board-actions.ts';
import { createAiOperationRecord, aiOperationStatus, undoAiOperation, retainAiOperations, validAiOperationRecords } from '../app/ai-operation-history.ts';
import { readWorkspace } from '../app/workspace-store.ts';
const source = { id:'source',kind:'note',title:'Source',body:'Original evidence',x:0,y:0,width:360 };
const base = () => ({id:'board',title:'Board',cards:[source],edges:[]});
const actions = {id:'question',boardId:'board',notes:[{id:'new:1',title:'AI note',body:'Evidence summary'}],connections:[{from:'source',to:'new:1'}]};
const details = {chatId:'chat',messageId:'answer',request:'Create a note and connect it',answer:'Prepared a summary.',process:[{message:'Read evidence',elapsed:1}]};
function created(){const before=base(),result=applyAiBoardActions(before,actions);return {...result.board,aiOperations:[createAiOperationRecord(before,result.board,actions.id,details,123)]};}
test('persistent receipt selectively undoes its batch and preserves later unrelated edits',()=>{
 const initial=created(), raw=JSON.stringify({version:1,boards:[initial],deletedBoards:[],activeId:'board',nextUntitledIndex:1});
 const board=readWorkspace(raw).boards[0];assert.deepEqual(board.aiOperations,initial.aiOperations);
 const changed={...board,cards:board.cards.map(card=>card.id==='source'?{...card,body:'Later unrelated edit',x:910}:card)};
 assert.equal(aiOperationStatus(changed,changed.aiOperations[0]),'applied');
 const undone=undoAiOperation(changed,'question');assert.equal(undone.cards.length,1);assert.equal(undone.cards[0].body,'Later unrelated edit');assert.equal(undone.cards[0].x,910);assert.equal(undone.edges.length,0);assert.equal(aiOperationStatus(undone,undone.aiOperations[0]),'undone');
 assert.equal(undoAiOperation(undone,'question'),undone);
});
test('edited geometry, content, formatting, added connections and synced references block undo atomically',()=>{
 for(const patch of [{body:'Edited'},{x:30},{tags:['Important']},{blocks:[{type:'paragraph',content:'Formatted'}]}]){
  const board=created(), changed={...board,cards:board.cards.map(card=>card.id!=='source'?{...card,...patch}:card)},before=JSON.stringify(changed);
  assert.equal(aiOperationStatus(changed,changed.aiOperations[0]),'conflict');assert.throws(()=>undoAiOperation(changed,'question'));assert.equal(JSON.stringify(changed),before);
 }
 const board=created(), id=board.aiOperations[0].cards[0].id;
 assert.throws(()=>undoAiOperation({...board,edges:[...board.edges,{id:'later',from:id,to:'source'}]},'question'));
 assert.throws(()=>undoAiOperation(board,'question',[{...base(),id:'another',cards:[{...source,id:'copy',sharedId:id}]}]));
 assert.throws(()=>undoAiOperation({...board,edges:[]},'question'));
});
test('workspace empty tags and automatic timestamps do not prevent immediate undo',()=>{
 const board=created(), normalized={...board,cards:board.cards.map(card=>({...card,tags:[],createdAt:'2026-10-22',updatedAt:'2026-10-22',creationDateSource:'actual'}))};
 assert.equal(aiOperationStatus(normalized,normalized.aiOperations[0]),'applied');
 assert.equal(undoAiOperation(normalized,'question').cards.length,1);
});
test('Cmd+Z and redo retain receipts; replay after undo cannot duplicate an operation',()=>{
 const applied=created(), undone=retainAiOperations(applied,base());assert.equal(undone.aiOperations.length,1);assert.equal(aiOperationStatus(undone,undone.aiOperations[0]),'undone');
 const redone=retainAiOperations(undone,applied);assert.equal(aiOperationStatus(redone,redone.aiOperations[0]),'applied');
 const result=applyAiBoardActions(undone,actions,{appliedActionIds:new Set(undone.aiOperations.map(item=>item.id))});assert.equal(result.board,undone);assert.equal(result.alreadyApplied,true);
});
test('invalid receipts cannot become persistent undo targets',()=>{
 const record=created().aiOperations[0];assert.ok(validAiOperationRecords([record]));
 for(const changed of [{...record,cards:[{id:'source',fingerprint:'{}'}]},{...record,edges:null},{...record,process:[{message:'x',elapsed:-1}]}]) assert.equal(validAiOperationRecords([changed]),false);
 assert.equal(validAiOperationRecords([record,record]),false);
});
