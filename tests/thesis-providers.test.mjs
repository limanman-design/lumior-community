import test from 'node:test';
import assert from 'node:assert/strict';
import { base } from './thesis-fixtures.mjs';
import { newThesisSession } from '../lib/thesis/model.ts';
import { createThesisService } from '../lib/thesis/service.ts';
import { thesisModelCall } from '../lib/thesis/model-call.ts';
import { thesisInstructionRevision } from '../lib/thesis/run.ts';
import { hasThesisConsent, updateThesisConsent, defaultThesisModel } from '../lib/thesis/providers.ts';

const completion=()=>new Response('data: '+JSON.stringify({choices:[{delta:{content:'Q1 — 哪个结论需要核对？',reasoning_content:'本轮思考'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
const settings={model:'deepseek-flash',providers:{deepseek:{key:'deepseek-test-secret',model:'deepseek-flash'},kimi:{key:'kimi-test-secret',model:'kimi-k2.6'}}};
const request=patch=>new Request('http://localhost:43825/api/thesis',{method:'POST',headers:{origin:'http://localhost:43825','content-type':'application/json'},body:JSON.stringify({snapshot:base(),session:newThesisSession('mba-review'),question:'继续核对文献',consent:true,consentProvider:'kimi',...patch})});

test('MBA exposes only fixed Kimi K3.1 Pro regardless of global model settings',async()=>{
 const body=await(await createThesisService(()=>settings).GET(new Request('http://localhost:43825/api/thesis'))).json();
 assert.equal(defaultThesisModel.id,'kimi:kimi-k3.1-pro');assert.equal(body.model,'kimi:kimi-k3.1-pro');assert.equal(body.provider,'kimi');
 assert.deepEqual(body.models.map(m=>m.id),['kimi:kimi-k3.1-pro']);assert.deepEqual(body.providers.map(p=>p.id),['kimi']);
 assert.doesNotMatch(JSON.stringify(body),/test-secret|apiKey/);
});
test('omitted and explicit default use Kimi key, native high thinking and completion limit',async()=>{
 const captures=[];const service=createThesisService(()=>settings,async(url,init)=>{captures.push({url,key:init.headers.Authorization,body:JSON.parse(init.body)});return completion();});
 for(const patch of [{},{model:'kimi:kimi-k3.1-pro'}]){const r=await service.POST(request(patch));assert.equal(r.status,200);assert.match(await r.text(),/Kimi K3.1 Pro/);}
 for(const c of captures){assert.equal(c.url,'https://api.moonshot.cn/v1/chat/completions');assert.equal(c.key,'Bearer kimi-test-secret');assert.equal(c.body.model,'kimi-k3.1-pro');assert.equal(c.body.thinking,undefined);assert.equal(c.body.reasoning_effort,'high');assert.equal(c.body.max_completion_tokens,32768);assert.equal(c.body.max_tokens,undefined);}
});
test('all academic and tool requests use high thinking',async()=>{
 const bodies=[];const call=thesisModelCall('fake','kimi-k3.1-pro',new AbortController().signal,async(_u,init)=>{bodies.push(JSON.parse(init.body));return completion();},'kimi');
 await call([{role:'user',content:'开始'}]);await call([{role:'user',content:'指导'}],[{type:'function',function:{name:'Read'}}]);
 assert.deepEqual(bodies.map(b=>b.reasoning_effort),['high','high']);
});
test('unsupported overrides and stale DeepSeek consent cannot dispatch; missing Kimi never falls back',async()=>{
 let calls=0;const service=createThesisService(()=>({providers:{deepseek:settings.providers.deepseek}}),async()=>{calls++;return completion();});
 for(const patch of [{model:'deepseek-flash'},{model:'kimi:kimi-k3'},{model:'openai:gpt-4.1'},{model:{provider:'kimi'}},{consentProvider:'deepseek'},{consentProvider:undefined},{consent:false}])assert.equal((await service.POST(request(patch))).status,400);
 const missing=await service.POST(request({}));assert.equal(missing.status,503);assert.match(await missing.text(),/Kimi API Key/);assert.equal(calls,0);
});
test('legacy DeepSeek consent never grants Kimi permission and changing consent retains files',()=>{
 const old={consentAt:123,files:{keep:'unchanged'}};assert.equal(hasThesisConsent(old,'deepseek'),true);assert.equal(hasThesisConsent(old,'kimi'),false);
 const both=updateThesisConsent(old,'kimi',true);assert.equal(hasThesisConsent(both,'kimi'),true);assert.deepEqual(both.files,old.files);assert.equal(hasThesisConsent(updateThesisConsent(both,'kimi',false),'kimi'),false);
});
test('model or instruction changes retain visible context but clear former hidden reasoning',async()=>{
 for(const previousModel of ['deepseek-v4-pro','deepseek-flash',undefined,'kimi:kimi-k3.1-pro'])for(const currentRevision of [false,true]){
  let body;const service=createThesisService(()=>settings,async(_u,init)=>{body=JSON.parse(init.body);return completion();});
  const session=newThesisSession('mba-review');session.model=previousModel;if(currentRevision)session.instructionRevision=thesisInstructionRevision;
  session.modelMessages=[{role:'assistant',content:'已有综述范围',reasoning_content:'上一模型的思考'}];
  const r=await service.POST(request({session}));assert.match(await r.text(),/"model":"kimi:kimi-k3.1-pro"/);
  const previous=body.messages.find(m=>m.content==='已有综述范围');assert.ok(previous);assert.equal(previous.reasoning_content,previousModel==='kimi:kimi-k3.1-pro'&&currentRevision?'上一模型的思考':undefined);
  assert.equal(session.modelMessages[0].reasoning_content,'上一模型的思考');
 }
});
test('an old pending choice resumes with options and without orphaned tool replies',async()=>{
 let body;const service=createThesisService(()=>settings,async(_u,init)=>{body=JSON.parse(init.body);return completion();});
 const session=newThesisSession('mba-review');session.model='deepseek-flash';session.pending={id:'old-choice',question:'优先哪类证据？',options:['访谈','问卷']};session.turns=[{id:'a',role:'assistant',text:'优先哪类证据？',createdAt:1}];session.modelMessages=[{role:'assistant',content:'',reasoning_content:'旧推理',tool_calls:[{id:'old-choice',type:'function',function:{name:'AskUserQuestion',arguments:'{}'}}]}];
 const response=await service.POST(request({session,question:'访谈'}));await response.text();assert.ok(body.messages.some(m=>m.role==='assistant'&&m.content.includes('问卷')));assert.equal(body.messages.at(-1).content,'访谈');assert.ok(body.messages.every(m=>m.role!=='tool'&&!m.tool_calls&&!m.reasoning_content));assert.equal(session.pending.id,'old-choice');
});
