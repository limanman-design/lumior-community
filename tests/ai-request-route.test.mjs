import test from 'node:test';
import assert from 'node:assert/strict';
import {isModelIdentityQuestion} from '../lib/ai-request-route.ts';
import {createAiService} from '../lib/ai-service.ts';
import {readAiStream} from '../lib/ai-stream.ts';
import {runResearch} from '../lib/ai-research-run.ts';
test('only unambiguous model identity questions use the configuration shortcut',()=>{
 for(const question of ['你现在用的模型是deepseek4.1吗？','你是什么模型？','你用的是什么模型','What model are you using?','Are you DeepSeek 4.1?']) assert.equal(isModelIdentityQuestion(question),true,question);
 for(const question of ['资料里的模型是deepseek4.1吗？','你用的模型是deepseek吗？顺便总结论文','介绍 deepseek4.1 的能力','这篇论文用了哪个模型','What model does this paper use?']) assert.equal(isModelIdentityQuestion(question),false,question);
});
test('model identity answers use resolved configuration without provider calls or evidence retrieval',async()=>{
 let calls=0;const service=createAiService(()=>({key:'test-key',model:'deepseek-flash'}),async()=>{calls++;throw new Error('Provider must not be used');});
 const response=await service.POST(new Request('http://localhost/api/ai',{method:'POST',body:JSON.stringify({question:'你现在用的模型是deepseek4.1吗？',model:'auto',sources:[{cardId:'s',title:'Private source',kind:'note',text:'This source is unrelated'}]})}));
 const events=[];await readAiStream(response,event=>events.push(event));assert.equal(calls,0);assert.match(events.find(event=>event.type==='delta').text,/deepseek-flash/);assert.ok(!events.some(event=>['coverage','evidence','board_actions'].includes(event.type)));assert.equal(events.at(-1).type,'done');
});
test('ordinary questions can finish after routing without search, semantic scans or review loops',async()=>{
 let calls=0;const events=[];
 await runResearch({question:'解释一下什么是归纳推理',sources:[{cardId:'s',title:'Unrelated',kind:'note',text:'PRIVATE_UNRELATED_SOURCE'}],history:[],readingNotes:[]},async(messages,tools)=>{
  calls++;if(calls===1)return {message:{role:'assistant',content:'',tool_calls:[{id:'plan',type:'function',function:{name:'plan_research',arguments:JSON.stringify({task:'question',card_ids:[],queries:[],requirements:[],research_required:false})}}]}};
  assert.equal(tools,undefined);assert.ok(!JSON.stringify(messages).includes('PRIVATE_UNRELATED_SOURCE'));return {message:{role:'assistant',content:'归纳推理从具体观察归纳一般规律。'}};
 },event=>events.push(event),new AbortController().signal);
 assert.equal(calls,2);assert.ok(!events.some(event=>event.type==='evidence'));assert.equal(events.at(-1).type,'done');
});
