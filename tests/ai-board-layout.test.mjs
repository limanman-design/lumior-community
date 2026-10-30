import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAiBoardActions } from '../app/ai-board-actions.ts';
import { occupiedRectangle } from '../app/imported-media-layout.ts';
import { aiOperationStatus, createAiOperationRecord, undoAiOperation, validAiOperationRecords, retainAiOperations } from '../app/ai-operation-history.ts';
import { readWorkspace } from '../app/workspace-store.ts';
import { readAiBoardActionResult } from '../app/ai-chat-store.ts';
import { aiOperationSummary, aiOperationRecordResult } from '../app/ai-operation-summary.ts';
const card=(id,extra={})=>({id,kind:'note',title:id,body:'Original body',x:0,y:0,width:360,height:300,...extra});
const board=(extra={})=>({id:'board',title:'Layout',cards:[card('a'),card('b',{x:100,y:500}),card('c',{x:200,y:1000})],edges:[],...extra});
const actions=(extra={})=>({id:'operation',boardId:'board',notes:[],connections:[],...extra});
const arrange=(layout='grid',cardIds=['a','b','c'])=>actions({arrangements:[{layout,cardIds}]});
const group=(cardIds=['a','b','c'])=>actions({groups:[{id:'group:1',title:'Research',cardIds}]});
const details={chatId:'chat',messageId:'answer',request:'Organize',answer:'Prepared',process:[]};
const overlaps=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
const receipt=(before,result)=>({...result.board,aiOperations:[createAiOperationRecord(before,result.board,result.actionId,details,123)]});
function noOverlap(cards,sizes={}) { for(let i=0;i<cards.length;i++)for(let j=i+1;j<cards.length;j++)assert.equal(overlaps(occupiedRectangle(cards[i],sizes),occupiedRectangle(cards[j],sizes)),false,`${cards[i].id}/${cards[j].id}`); }

test('row, column and grid use actual heterogeneous sizes and preserve bodies, IDs and unrelated objects',()=>{
 for(const layout of ['row','column','grid']){
  const source=board({cards:[card('a',{width:500,height:150}),card('b',{kind:'pdf',height:600}),card('c',{kind:'image',width:600,height:430}),card('outside',{x:0,y:1800,width:1500})],edges:[{id:'edge',from:'a',to:'b'}]}),raw=JSON.stringify(source);
  const sizes={a:900},result=applyAiBoardActions(source,arrange(layout),{measuredHeights:sizes,layoutSnapshot:source});
  assert.equal(JSON.stringify(source),raw);assert.equal(result.createdCards,0);assert.equal(result.createdSections,0);
  assert.strictEqual(result.board.cards[3],source.cards[3]);assert.strictEqual(result.board.edges,source.edges);
  noOverlap(result.board.cards,sizes);
  for(const item of result.board.cards) {const old=source.cards.find(c=>c.id===item.id);const {x,y,...other}=item;const {x:ox,y:oy,...oldOther}=old;assert.deepEqual(other,oldOther);}
  const selected=result.board.cards.slice(0,3);
  if(layout==='row')assert.equal(new Set(selected.map(c=>c.y)).size,1);
  if(layout==='column')assert.equal(new Set(selected.map(c=>c.x)).size,1);
  const again=applyAiBoardActions(result.board,{...arrange(layout),id:'again'},{measuredHeights:sizes});
  assert.strictEqual(again.board,result.board,'a repeated identical layout has no drift');
 }
});
test('groups reserve card labels and section headers and avoid untouched sections and cards',()=>{
 const source=board({sections:[{id:'keep',title:'Keep',x:0,y:-50,width:2000,height:1500,color:'#fff'}],cards:[...board().cards,card('untouched',{x:1000,y:0})]});
 const result=applyAiBoardActions(source,actions({groups:[{id:'group:1',title:'A',cardIds:['a','b']},{id:'group:2',title:'B',cardIds:['c']}]}));
 assert.equal(result.createdSections,2);assert.equal(result.board.sections.length,3);assert.strictEqual(result.board.cards.at(-1),source.cards.at(-1));
 const [keep,...added]=result.board.sections;
 for(const frame of added){assert.ok(frame.y-32>=keep.y+keep.height+32);for(const other of added)if(frame!==other)assert.equal(overlaps({...frame,y:frame.y-32,height:frame.height+32},{...other,y:other.y-32,height:other.height+32}),false);}
 noOverlap(result.board.cards);
});
test('regroup replaces complete old frames, preserves partial frames, and selective undo restores everything',()=>{
 const source=board({sections:[{id:'old',title:'Original group',x:-32,y:-32,width:800,height:900,color:'#aaa'}]});
 const result=applyAiBoardActions(source,group()),saved=receipt(source,result),record=saved.aiOperations[0];
 assert.equal(saved.sections.some(s=>s.id==='old'),false);assert.equal(record.version,2);assert.equal(validAiOperationRecords([record]),true);assert.equal(aiOperationStatus(saved,record),'applied');
 const restored=readWorkspace(JSON.stringify({version:1,boards:[saved],deletedBoards:[],activeId:'board',nextUntitledIndex:1})).boards[0];
 assert.equal(aiOperationStatus(restored,restored.aiOperations[0]),'applied');
 const edited={...restored,cards:restored.cards.map(c=>c.id==='a'?{...c,body:'My later text'}:c)};
 const undone=undoAiOperation(edited,'operation');assert.deepEqual(undone.sections,source.sections);assert.deepEqual(undone.cards.map(c=>[c.x,c.y]),source.cards.map(c=>[c.x,c.y]));assert.equal(undone.cards[0].body,'My later text');assert.equal(aiOperationStatus(undone,record),'undone');
 assert.equal(applyAiBoardActions(undone,group()).alreadyApplied,true);
 const partial=applyAiBoardActions(source,group(['a'])).board;assert.ok(partial.sections.some(s=>s.id==='old'));assert.strictEqual(partial.cards[1],source.cards[1]);
});
test('arranging complete existing groups preserves their identity, names and membership',()=>{
 const source=board({cards:[card('a',{x:0,y:0}),card('b',{x:100,y:400}),card('c',{x:1000,y:0})],sections:[{id:'one',title:'One',color:'#abc',x:-32,y:-64,width:700,height:900},{id:'two',title:'Two',color:'#def',x:968,y:-64,width:500,height:500}]});
 const result=applyAiBoardActions(source,arrange('row'));assert.equal(result.createdSections,0);assert.equal(result.updatedSections,2);assert.deepEqual(result.board.sections.map(s=>s.id),['one','two']);
 assert.equal(result.board.sections[0].title,'One');assert.equal(result.board.sections[1].color,'#def');noOverlap(result.board.cards);
 const saved=receipt(source,result),undone=undoAiOperation(saved,'operation');assert.deepEqual(undone.cards,source.cards);assert.deepEqual(undone.sections,source.sections);
});
test('mixed structures are one atomic batch with durable undo and no double execution',()=>{
 const source=board(),action=actions({notes:[{id:'new:1',title:'Outline',body:'Proposed outline'}],connections:[{from:'a',to:'new:1'}],groups:[{id:'group:1',title:'Ideas',cardIds:['new:1','a']}],arrangements:[{cardIds:['b','c'],layout:'column'}]});
 const result=applyAiBoardActions(source,action),saved=receipt(source,result),record=saved.aiOperations[0];
 assert.equal(result.createdCards,1);assert.equal(result.createdConnections,1);assert.equal(result.createdSections,1);assert.equal(validAiOperationRecords([record]),true);noOverlap(result.board.cards);
 const undone=undoAiOperation(saved,action.id);assert.deepEqual(undone.cards,source.cards);assert.deepEqual(undone.edges,source.edges);assert.deepEqual(undone.sections,[]);
 assert.equal(aiOperationStatus(undone,record),'undone');assert.equal(applyAiBoardActions(undone,action).board,undone);
 assert.equal(aiOperationStatus(retainAiOperations(saved,source),record),'undone');assert.equal(aiOperationStatus(retainAiOperations(undone,saved),record),'applied');
});
test('stale cards, geometry and sections reject a whole batch, while unrelated edits remain intact',()=>{
 const source=board({sections:[]}),action=group(['a','b']);
 for(const patch of [{x:10},{body:'edited'},{width:900},{blocks:[{type:'paragraph',content:'changed'}]}]){
  const changed={...source,cards:source.cards.map(c=>c.id==='a'?{...c,...patch}:c)},raw=JSON.stringify(changed);assert.throws(()=>applyAiBoardActions(changed,action,{layoutSnapshot:source}),/已有改动/);assert.equal(JSON.stringify(changed),raw);
 }
 assert.throws(()=>applyAiBoardActions({...source,sections:[{id:'later',x:0,y:0,width:10,height:10,title:'x',color:'#fff'}]},action,{layoutSnapshot:source}),/已有改动/);
 const unrelated={...source,cards:source.cards.map(c=>c.id==='c'?{...c,body:'Preserve',x:8000}:c)};
 assert.strictEqual(applyAiBoardActions(unrelated,action,{layoutSnapshot:source}).board.cards[2],unrelated.cards[2]);
 assert.throws(()=>applyAiBoardActions(source,group(['a','missing'])),/不存在/);
 assert.throws(()=>applyAiBoardActions({...source,sections:[{id:'dup'},{id:'dup'}]},action),/重复/);
});
test('later moves, resizes, frame changes, deletion or new group members block selective undo',()=>{
 const source=board(),saved=receipt(source,applyAiBoardActions(source,group())),record=saved.aiOperations[0],section=saved.sections[0];
 for(const changed of [
  {...saved,cards:saved.cards.map(c=>c.id==='a'?{...c,x:c.x+10}:c)},
  {...saved,cards:saved.cards.map(c=>c.id==='a'?{...c,width:900}:c)},
  {...saved,cards:saved.cards.filter(c=>c.id!=='a')},
  {...saved,sections:[{...section,title:'Manual title'}]},
  {...saved,cards:[...saved.cards,card('later',{x:section.x+10,y:section.y+10})]},
 ]){assert.equal(aiOperationStatus(changed,record),'conflict');assert.throws(()=>undoAiOperation(changed,'operation'));}
 const bad=structuredClone(record);bad.moves[0].after.width=0;assert.equal(validAiOperationRecords([bad]),false);
 const badSection=structuredClone(record);badSection.sections[0].id='original';assert.equal(validAiOperationRecords([badSection]),false);
});
test('new receipts retain bounded optional counts without changing legacy receipts',()=>{
 const source=board(),result=applyAiBoardActions(source,group()),saved=receipt(source,result),counts=aiOperationRecordResult(saved.aiOperations[0]);
 assert.deepEqual(readAiBoardActionResult(JSON.parse(JSON.stringify(counts))),counts);
 assert.match(aiOperationSummary(counts,(_en,zh,p)=>zh.replace('{n}',p?.n)),/分区/);
 for(const patch of [{createdSections:13},{movedCards:301},{updatedSections:-1},{movedCards:'2'}])assert.throws(()=>readAiBoardActionResult({...counts,...patch}));
});
