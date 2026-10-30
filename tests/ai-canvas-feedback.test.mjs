import test from 'node:test';
import assert from 'node:assert/strict';
import { runResearch } from '../lib/ai-research-run.ts';
import { readAiStream, encodeAiEvent } from '../lib/ai-stream.ts';
import { readAiBoardActions } from '../lib/ai-board-tools.ts';
import { applyAiBoardActions } from '../app/ai-board-actions.ts';
import { boardActionReferences } from '../app/ai-board-action-references.ts';
import { createAiOperationRecord, undoAiOperation, aiOperationStatus, validAiOperationRecords } from '../app/ai-operation-history.ts';
import { readWorkspace } from '../app/workspace-store.ts';
import { canvasPanelMessages } from '../app/ai-canvas-presentation.ts';
const base={id:'op',boardId:'board',notes:[],connections:[]};
const group={id:'group:1',title:'共同主题',cardIds:['a','b'],reason:'两张资料都讨论角色与职责变化。'};
const board={id:'board',title:'Test',cards:['a','b'].map((id,i)=>({id,kind:'note',title:id,body:'Original',x:200*i,y:600*i,width:360,height:300})),edges:[]};
const tool=(name,args)=>({id:name,type:'function',function:{name,arguments:JSON.stringify(args)}});
const result=(content='',calls)=>({reason:calls?'tool_calls':'stop',message:{role:'assistant',content,...(calls?{tool_calls:calls}:{})}});

test('early routing and card activity correspond to actual evidence consumption, including abort',async()=>{
 for(const cancel of [false,true]){
  const events=[],controller=new AbortController();let n=0;
  const work=runResearch({question:'按主题分组',board:{boardId:'board',cards:board.cards.map(({id,title,kind})=>({id,title,kind})),edges:[]},operationId:'op',sources:[{cardId:'a',title:'A',kind:'note',text:'Evidence'}],readingNotes:[],history:[]},async()=>{
   n++;
   if(n===1)return result('',[tool('plan_research',{task:'question',queries:['Evidence'],card_ids:['a'],requirements:[],board_action:'group_cards'})]);
   assert.equal(events.find(e=>e.type==='task_mode').mode,'operation');
   if(n===2){assert.ok(!events.some(e=>e.type==='card_activity'));return result('',[tool('read_document',{card_id:'a'})]);}
   if(n===3){assert.deepEqual(events.filter(e=>e.type==='card_activity').at(-1).cardIds,['a']);if(cancel)controller.abort();return result('',[tool('group_cards',{title:group.title,cardIds:group.cardIds,reason:group.reason})]);}
   if(n===4){assert.deepEqual(events.filter(e=>e.type==='card_activity').at(-1).cardIds,[]);return result('准备好分组。');}
   if(n===5)return result('',[tool('replace_board_actions',{notes:[],connections:[],groups:[group],arrangements:[]})]);
   return result('已核对分组。');
  },event=>events.push(event),controller.signal);
  if(cancel){await assert.rejects(work,{name:'AbortError'});assert.ok(!events.some(e=>e.type==='board_actions'));}
  else{await work;assert.equal(events.find(e=>e.type==='board_actions').actions.groups[0].reason,group.reason);}
  assert.deepEqual(events.filter(e=>e.type==='card_activity').at(-1).cardIds,[]);
 }
});

test('reason survives grouping, persistence, arrangement and undo; later edits are protected',()=>{
 const result=applyAiBoardActions(board,{...base,groups:[group]});
 const record=createAiOperationRecord(board,result.board,'op',{chatId:'c',messageId:'m',request:'Group',answer:'Done',process:[]},123);
 const saved={...result.board,aiOperations:[record]};
 assert.equal(saved.sections[0].aiReason,group.reason);assert.ok(validAiOperationRecords([record]));
 const restored=readWorkspace(JSON.stringify({version:1,boards:[saved],deletedBoards:[],activeId:'board',nextUntitledIndex:1})).boards[0];
 assert.equal(restored.sections[0].aiReason,group.reason);
 const arranged=applyAiBoardActions(restored,{...base,id:'arrange',arrangements:[{layout:'row',cardIds:['a','b']}]}).board;
 assert.equal(arranged.sections[0].aiReason,group.reason);
 assert.equal(undoAiOperation(restored,'op').sections.length,0);
 assert.equal(aiOperationStatus({...restored,sections:restored.sections.map(s=>({...s,aiReason:'User edited reason'}))},record),'conflict');
});

test('reasons are bounded and their citations are validated and made portable',()=>{
 assert.throws(()=>readAiBoardActions({...base,groups:[{...group,reason:'x'.repeat(801)}]}));
 assert.throws(()=>readAiBoardActions({...base,groups:[{...group,reason:42}]}));
 const context={sources:[{id:'a',title:'原始资料',text:'Evidence',kind:'note'}]};
 const linked=boardActionReferences({...base,groups:[{...group,reason:'共同主题 [Lumior:1]'}]},context);
 assert.match(linked.groups[0].reason,/原始资料/);assert.ok(!linked.groups[0].reason.includes('Lumior:'));
 assert.throws(()=>boardActionReferences({...base,groups:[{...group,reason:'[Lumior:99]'}]},context));
 assert.equal(readAiBoardActions({...base,groups:[{id:group.id,title:group.title,cardIds:group.cardIds}]}).groups[0].reason,undefined);
});

test('stream validates task modes and card IDs before showing activity',async()=>{
 const response=events=>new Response(new ReadableStream({start(c){events.forEach(e=>c.enqueue(encodeAiEvent(e)));c.close();}}),{headers:{'Content-Type':'text/event-stream'}});
 const observed=[];await readAiStream(response([{type:'task_mode',mode:'operation'},{type:'card_activity',cardIds:['a']},{type:'card_activity',cardIds:[]},{type:'done',reason:'stop'}]),e=>observed.push(e));assert.equal(observed.length,4);
 for(const event of [{type:'task_mode',mode:'delete'},{type:'card_activity',cardIds:['a','a']},{type:'card_activity',cardIds:[42]}])await assert.rejects(readAiStream(response([event]),()=>{}),/格式/);
});

test('an operation explicitly expanded by the user retains its original transcript',()=>{
 const question={id:'q',role:'user',text:'Group'};
 const answer={id:'a',replyTo:'q',role:'assistant',text:'Grouped',status:'complete',operationOnly:true,presentationMode:'conversation'};
 assert.deepEqual(canvasPanelMessages([question,answer]),[question,answer]);
});
