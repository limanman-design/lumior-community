import test from 'node:test';
import assert from 'node:assert/strict';
import { AiBoardToolSession, readAiBoardActions, aiBoardActionsAllowed } from '../lib/ai-board-tools.ts';
import { runResearch } from '../lib/ai-research-run.ts';
import { isSimpleLayoutRequest } from '../lib/ai-request-route.ts';
const context={boardId:'board',cards:[{id:'a',title:'A',kind:'pdf'},{id:'b',title:'B',kind:'image'}],edges:[]};
const base={id:'op',boardId:'board',notes:[],connections:[]};
const group={id:'group:1',title:'Evidence',cardIds:['a','b']};
const tool=(name,args)=>({id:name,type:'function',function:{name,arguments:JSON.stringify(args)}});
const result=(text='',calls)=>({reason:calls?'tool_calls':'stop',message:{role:'assistant',content:text,...(calls?{tool_calls:calls}:{})}});
test('group and arrange validate exact scope, uniqueness, limits and review allocations atomically',()=>{
 const session=new AiBoardToolSession(context,'op');assert.equal(session.execute('group_cards',{title:'Evidence',cardIds:['a','missing']}).staged,undefined);
 assert.equal(session.execute('group_cards',{title:'Evidence',cardIds:['a']}).id,'group:1');
 const snapshot=session.snapshot();snapshot.groups[0].cardIds.push('b');assert.deepEqual(session.snapshot().groups[0].cardIds,['a']);
 assert.ok(session.execute('arrange_cards',{cardIds:['a'],layout:'row'}).error);assert.ok(session.executeReview({notes:[],connections:[],groups:[{...group,id:'group:2'}]}).error);
 assert.equal(session.execute('arrange_cards',{cardIds:['b'],layout:'column'}).staged,true);
 const stage=session.snapshot();assert.equal(session.executeReview({notes:[],connections:[],groups:stage.groups,arrangements:stage.arrangements}).reviewed,true);
 assert.ok(!aiBoardActionsAllowed('group_cards',session.snapshot()));assert.ok(aiBoardActionsAllowed('build_structure',session.snapshot()));
 const before=JSON.stringify(session.snapshot());assert.ok(session.executeReview({notes:[],connections:[],groups:[group],arrangements:[{cardIds:['b'],layout:'row'}]}).error);assert.equal(JSON.stringify(session.snapshot()),before);assert.equal(session.reviewed,true);
 for(const patch of [
  {groups:[{...group,cardIds:['a','a']}]}, {groups:[{...group,cardIds:[]}]}, {groups:[{...group,cardIds:['new:1']}]},
  {groups:[group],arrangements:[{cardIds:['a'],layout:'grid'}]}, {arrangements:[{cardIds:['a'],layout:'freeform',x:12}]},
  {arrangements:[{cardIds:Array.from({length:301},(_,i)=>`id${i}`),layout:'grid'}]},
 ])assert.throws(()=>readAiBoardActions({...base,...patch}));
 assert.equal(session.executeReview({notes:[],connections:[],groups:[],arrangements:[]}).reviewed,true);
});
test('pure arrangement does no source search/read and publishes only after review',async()=>{
 let n=0;const events=[];const arrangements=[{cardIds:['b','a'],layout:'row'}];
 await runResearch({question:'把卡片排成一排',board:context,operationId:'op',sources:[{cardId:'a',title:'Secret irrelevant PDF',kind:'pdf',text:'Original content'}],readingNotes:[],history:[]},async(messages,tools)=>{
  const names=tools?.map(t=>t.function.name)||[];
  if(++n===1){assert.ok(tools[0].function.parameters.properties.board_action.enum.includes('arrange_cards'));return result('',[tool('plan_research',{task:'summary',card_ids:['a'],queries:[],requirements:[],board_action:'arrange_cards',response_mode:'operation'})]);}
  assert.equal(events.some(e=>e.type==='board_actions'),false);
  assert.ok(!names.some(name=>['read_document','read_passages','semantic_search','search_materials','create_note','group_cards'].includes(name)));
  if(n===2)return result('',[tool('arrange_cards',arrangements[0])]);
  if(n===3)return result('Ready to arrange.');
  if(n===4)return result('',[tool('replace_board_actions',{notes:[],connections:[],groups:[],arrangements})]);
  return result('Ready to arrange.');
 },event=>events.push(event),new AbortController().signal);
 assert.equal(n,5);assert.deepEqual(events.find(e=>e.type==='evidence').indices,[]);assert.deepEqual(events.find(e=>e.type==='board_actions').actions.arrangements,arrangements);assert.equal(events.find(e=>e.type==='board_actions').operationOnly,true);assert.equal(events.at(-1).type,'done');assert.ok(!events.some(e=>e.type==='board_generation'));
});
test('content grouping reads sources, reviews titles and can cancel or abort without publishing',async()=>{
 for(const mode of ['ok','cancel','abort','bad-citation','expand-permission']){
  let n=0;const events=[],abort=new AbortController();const grouping={...group,title:mode==='bad-citation'?'Unsupported [Lumior:999]':'Evidence'};
  const promise=runResearch({question:'按主题分组',board:context,operationId:'op',sources:[{cardId:'a',title:'A',kind:'pdf',text:'Useful evidence'}],history:[],readingNotes:[]},async(messages,tools)=>{
   n++;if(n===1)return result('',[tool('plan_research',{task:'question',queries:['evidence'],card_ids:[],requirements:[],board_action:'group_cards'})]);
   if(n===2){assert.ok(tools.some(t=>t.function.name==='group_cards'));assert.ok(!tools.some(t=>['create_note','arrange_cards','connect_cards'].includes(t.function.name)));return result('',[tool('read_document',{card_id:'a'})]);}
   if(n===3)return result('',[tool('group_cards',{title:'Evidence',cardIds:['a','b']})]);
   if(n===4)return result('Group prepared.');
   if(n===5)return result('',[tool('replace_board_actions',{notes:[],connections:mode==='expand-permission'?[{from:'a',to:'b'}]:[],groups:mode==='cancel'?[]:[grouping],arrangements:[]})]);
   if(mode==='abort')abort.abort(new Error('Cancelled'));return result('Group prepared.');
  },e=>events.push(e),abort.signal);
  if(['abort','bad-citation','expand-permission'].includes(mode))await assert.rejects(promise);else await promise;
  assert.equal(events.some(e=>e.type==='board_actions'),mode==='ok');
  if(mode==='ok')assert.deepEqual(events.find(e=>e.type==='evidence').indices,[0]);
 }
});
test('build structure exposes all four bounded tools and commits notes, groups, arrangements and edges together',async()=>{
 let n=0;const events=[];
 const operations={notes:[{id:'new:1',title:'Outline',body:'A template'}],connections:[{from:'a',to:'new:1'}],groups:[{id:'group:1',title:'Research',cardIds:['new:1','a']}],arrangements:[{cardIds:['b'],layout:'column'}]};
 await runResearch({question:'Build an outline with groups and links',board:context,operationId:'op',sources:[],history:[],readingNotes:[]},async(messages,tools)=>{
  if(++n===1)return result('',[tool('plan_research',{task:'question',queries:[],card_ids:[],requirements:[],board_action:'build_structure'})]);
  if(n===2){assert.ok(['create_note','connect_cards','group_cards','arrange_cards'].every(name=>tools.some(t=>t.function.name===name)));return result('',[tool('create_note',{title:'Outline',body:'A template'})]);}
  if(n===3)return result('',[tool('group_cards',{title:'Research',cardIds:['new:1','a']}),tool('connect_cards',operations.connections[0]),tool('arrange_cards',operations.arrangements[0])]);
  if(n===4)return result('Prepared a structure.');
  if(n===5)return result('',[tool('replace_board_actions',operations)]);
  return result('Prepared a structure.');
 },e=>events.push(e),new AbortController().signal);
 assert.deepEqual(events.find(e=>e.type==='board_actions').actions,{...base,...operations});assert.ok(events.some(e=>e.type==='board_generation'));
});
test('only unambiguous position-only requests skip local extraction; semantic or mixed tasks still read',()=>{
 for(const text of ['把这些卡片排成网格，不改正文、不新建卡片或连线。','将所有卡片排成一排','卡片排为竖排','Arrange these cards as a grid. Do not change their content, create cards or add connections.'])assert.equal(isSimpleLayoutRequest(text),true,text);
 for(const text of ['按内容将卡片排成网格','请比较这些论文，然后排成一排','把这些卡片排成网格并总结','是否应该把卡片排成一排？','按年代把卡片排成一排','Do not arrange these cards as a grid'])assert.equal(isSimpleLayoutRequest(text),false,text);
});
test('content-dependent arrangement retains original-source tools and uses evidence before choosing order',async()=>{
 let n=0;const events=[];
 const arrangements=[{cardIds:['b','a'],layout:'row'}];
 await runResearch({question:'按文献中研究发生的时间整理这些卡片',board:context,operationId:'op',sources:[{cardId:'a',title:'A',kind:'pdf',text:'This study took place in 2020.'}],history:[],readingNotes:[]},async(messages,tools)=>{
  if(++n===1)return result('',[tool('plan_research',{task:'question',queries:['time'],card_ids:['a'],requirements:[],board_action:'arrange_cards',research_required:true})]);
  if(n===2){assert.ok(tools.some(t=>t.function.name==='read_document'));return result('',[tool('read_document',{card_id:'a'})]);}
  if(n===3)return result('',[tool('arrange_cards',arrangements[0])]);
  if(n===4)return result('Arrange using the stated date [Lumior:1].');
  if(n===5)return result('',[tool('replace_board_actions',{notes:[],connections:[],groups:[],arrangements})]);
  return result('Arrange using the stated date [Lumior:1].');
 },e=>events.push(e),new AbortController().signal);
 assert.deepEqual(events.find(e=>e.type==='evidence').indices,[0]);assert.ok(events.some(e=>e.type==='board_actions'));
});
