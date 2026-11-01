import test from 'node:test';
import assert from 'node:assert/strict';
import { runResearch } from '../lib/ai-research-run.ts';
import { readAiStream, encodeAiEvent } from '../lib/ai-stream.ts';
import { readAiQuestion } from '../lib/ai-question.ts';
import { restoredAiHistory, aiConversationHistory } from '../app/ai-chat-store.ts';
import { aiMessageQuestions } from '../app/ai-question-state.ts';
import { createAiService } from '../lib/ai-service.ts';
const question={id:'q',question:'你希望先处理哪一部分？',options:['总结资料','整理卡片']};
const tool=(name,args)=>({id:name,type:'function',function:{name,arguments:JSON.stringify(args)}});
const input={question:'帮我处理一下',sources:[],history:[],readingNotes:[]};
const response=events=>new Response(new ReadableStream({start(c){events.forEach(e=>c.enqueue(encodeAiEvent(e)));c.close();}}),{headers:{"Content-Type":"text/event-stream"}});
void test('clarification ends the existing planning call without research or board writes',async()=>{
 const events=[];let calls=0;
 await runResearch(input,async(messages,tools)=>{calls++;assert.ok(tools.some(t=>t.function.name==='ask_user_question'));return {message:{role:'assistant',content:'private planning text',tool_calls:[tool('ask_user_question',question),tool('plan_research',{task:'summary'})]}};},e=>events.push(e),new AbortController().signal);
 assert.equal(calls,1);assert.equal(events.at(-1).reason,'question');assert.equal(events.find(e=>e.type==='question').question.question,question.question);
 assert.equal(events.some(e=>['board_actions','board_generation','coverage'].includes(e.type)),false);
 assert.equal(events.find(e=>e.type==='delta').text,question.question);
 const decoded=[];await readAiStream(response([{type:"start",model:"test"},...events]),e=>decoded.push(e));assert.equal(decoded.at(-1).reason,'question');
});
void test('malformed or cancelled questions cannot become actionable options',async()=>{
 assert.equal(readAiQuestion({...question,options:['Same','Same']}),undefined);
 await assert.rejects(readAiStream(response([{type:'question',question:{...question,options:['Only']}}]),()=>assert.fail('event')),/格式/);
 const controller=new AbortController();const events=[];
 await assert.rejects(runResearch(input,async()=>{controller.abort();return {message:{role:'assistant',content:'',tool_calls:[tool('ask_user_question',question)]}};},e=>events.push(e),controller.signal),{name:'AbortError'});
 assert.equal(events.some(e=>e.type==='question'),false);
});
void test('saved questions keep choices in model history; answered, superseded and interrupted buttons disable',()=>{
 const user={id:'u',role:'user',text:'Help',live:true};const reply={id:'a',replyTo:'u',role:'assistant',text:question.question,question,live:true,status:'complete',reason:'question'};
 const history=restoredAiHistory({version:1,boardId:'b',activeId:'c',chats:[{id:'c',boardId:'b',title:'Chat',messages:[user,reply]}]},'b');const chat=history.chats[0];
 assert.deepEqual(chat.messages[1].question,question);assert.ok(aiConversationHistory(chat).at(-1).content.includes('整理卡片'));
 assert.equal(aiMessageQuestions(chat.messages).get('a').disabled,false);
 const messages=[...chat.messages,{id:'answer',role:'user',text:'我想先比较',live:true}];
 assert.equal(aiMessageQuestions(messages).get('a').answer,'我想先比较');assert.equal(aiMessageQuestions(messages).get('a').disabled,true);
 assert.equal(aiMessageQuestions([...chat.messages,{...reply,id:'new'}]).get('a').disabled,true);
 assert.equal(aiMessageQuestions([user,{...reply,status:'interrupted'}]).get('a').disabled,true);
 const duringPresentation=restoredAiHistory({...history,chats:[{...chat,messages:[user,{...reply,status:'streaming'}]}]},'b');
 assert.equal(duringPresentation.chats[0].messages[1].status,'complete');
 assert.equal(aiMessageQuestions(duringPresentation.chats[0].messages).get('a').disabled,false);
});
void test('personal-key requests expose the same question event without a second model request',async()=>{
 let calls=0;
 const service=createAiService(()=>({key:'synthetic-personal-key',model:'deepseek-flash'}),async(_url,options)=>{
  calls++;assert.equal(options.headers.Authorization,'Bearer synthetic-personal-key');
  const body=JSON.parse(options.body);assert.ok(body.tools.some(t=>t.function.name==='ask_user_question'));
  const data=value=>`data: ${JSON.stringify(value)}\n\n`;
  return new Response(data({choices:[{delta:{tool_calls:[{index:0,...tool('ask_user_question',question)}]},finish_reason:null}]})+data({choices:[{delta:{},finish_reason:'tool_calls'}]})+'data: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
 });
 const result=await service.POST(new Request('http://localhost:3001/api/ai',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:'帮我处理资料',sources:[]})}));
 const events=[];await readAiStream(result,e=>events.push(e));assert.equal(calls,1);assert.equal(events.at(-1).reason,'question');assert.ok(events.some(e=>e.type==='question'));
});
