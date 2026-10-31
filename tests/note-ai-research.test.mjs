import test from 'node:test';
import assert from 'node:assert/strict';
import { runResearch } from '../lib/ai-research-run.ts';
import { encodeAiEvent, readAiStream } from '../lib/ai-stream.ts';
const tool = (name,value,id=name)=>({id,type:'function',function:{name,arguments:JSON.stringify(value)}});
const reply = (content='',calls)=>({reason:calls?'tool_calls':'stop',message:{role:'assistant',content,...(calls?{tool_calls:calls}:{})}});
const board={boardId:'board',cards:[{id:'one',title:'First note',kind:'note'},{id:'two',title:'Second note',kind:'note'}],edges:[]};
const input={question:'请把这两张笔记改得更清晰，保留链接和原有内容',board,operationId:'op',history:[],readingNotes:[],sources:[{cardId:'one',title:'First note',kind:'note',text:'First original [reference](https://example.com)'},{cardId:'two',title:'Second note',kind:'note',text:'Second original'}]};
const plan=()=>reply('',[tool('plan_research',{task:'question',research_required:true,board_action:'update_notes',card_ids:['one','two'],queries:['original'],requirements:['保留原文信息']})]);
void test('normal research reads complete notes, stages two suggestions, reviews originals, and emits them through the normal stream',async()=>{
 let turn=0;const events=[];const updates=[{cardId:'one',body:'Revised first [reference](https://example.com)'},{cardId:'two',body:'Revised second'}];
 await runResearch(input,async(messages,tools)=>{
  turn++;const names=tools.map(tool=>tool.function.name);
  if(turn===1)return plan();
  if(turn===2){assert.ok(names.includes('propose_note_update'));assert.ok(!names.includes('create_note'));return reply('',[tool('propose_note_update',updates[0],'too-early')]);}
  if(turn===3){assert.match(JSON.parse(messages.at(-1).content).error,/完整读取/);return reply('',[tool('read_document',{card_id:'one'},'read-one'),tool('read_document',{card_id:'two'},'read-two')]);}
  if(turn===4)return reply('已读完两张原文，准备修改建议。',updates.map((value,i)=>tool('propose_note_update',value,'update-'+i)));
  if(turn===5){assert.ok(!events.some(event=>event.type==='board_actions'));return reply('两张笔记的建议已准备，接受后替换。');}
  if(turn===6){const review=JSON.parse(messages.at(-1).content);assert.deepEqual(review.evidence.map(s=>s.cardId),['one','two']);assert.deepEqual(review.board_actions_to_review.updates,updates);return reply('',[tool('replace_board_actions',{notes:[],connections:[],groups:[],arrangements:[],updates})]);}
  assert.equal(turn,7);return reply('请在两张笔记旁分别查看并接受修改建议。');
 },e=>events.push(e),new AbortController().signal);
 assert.equal(events.at(-1).type,'done');assert.deepEqual(events.find(e=>e.type==='board_actions').actions.updates,updates);
 const stream=[];await readAiStream(new Response(new Uint8Array(events.flatMap(event=>[...encodeAiEvent(event)])),{headers:{'Content-Type':'text/event-stream'}}),e=>stream.push(e));
 assert.deepEqual(stream.find(e=>e.type==='board_actions').actions.updates,updates);
});
void test('reading just the beginning of a long note cannot authorize full replacement',async()=>{
 const events=[];let turn=0;
 const sources=Array.from({length:40},(_,i)=>({cardId:'one',title:'First note',kind:'note',text:`Paragraph ${i}. `+'x'.repeat(4000)}));
 await runResearch({...input,sources},async(messages)=>{
  if(++turn===1)return reply('',[tool('plan_research',{task:'question',research_required:true,board_action:'update_notes',card_ids:['one'],queries:['Paragraph'],requirements:[]})]);
  if(turn===2)return reply('',[tool('read_document',{card_id:'one'})]);
  if(turn===3){assert.ok(JSON.parse(messages.at(-1).content).next_cursor);return reply('',[tool('propose_note_update',{cardId:'one',body:'Incomplete replacement'})]);}
  if(turn===4){assert.match(JSON.parse(messages.at(-1).content).error,/完整读取/);return reply('尚未读完这张笔记，未生成修改建议。');}
  return reply('尚未读完，未生成修改建议。');
 },e=>events.push(e),new AbortController().signal);
 assert.ok(!events.some(e=>e.type==='board_actions'));
});
void test('cancellation after staging publishes no note suggestions',async()=>{
 const controller=new AbortController(),events=[];let turn=0;
 await assert.rejects(runResearch(input,async()=>{
  if(++turn===1)return plan();
  if(turn===2)return reply('',[tool('read_document',{card_id:'one'})]);
  if(turn===3)return reply('',[tool('propose_note_update',{cardId:'one',body:'Proposed'})]);
  controller.abort();return reply('Cancelled');
 },e=>events.push(e),controller.signal),{name:'AbortError'});
 assert.ok(!events.some(e=>e.type==='board_actions'));
});
