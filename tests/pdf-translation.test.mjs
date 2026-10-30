import test from 'node:test';
import assert from 'node:assert/strict';
import {translationUnits,parseTranslationInput,translationResult,translationComplete} from '../lib/pdf-translation.ts';
import {translatePdfUnits,createPdfTranslationService,createTranslationRegistry} from '../lib/pdf-translation-service.ts';

const sample=[{id:'1:0',page:1,text:'Research improves understanding.'},{id:'2:0',page:2,text:'Results and limitations.'}];
const result=(units)=>JSON.stringify({sourceLanguage:'英语',units:units.map(unit=>({id:unit.id,text:`中文译文 ${unit.text}`})),glossary:[{source:'Research',target:'研究'}]});
const completedProviderResponse=()=>new Response(`data: ${JSON.stringify({choices:[{delta:{content:result(sample)},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});

test('unconfigured translation directs desktop users to AI settings while preserving the web notice',async()=>{
 let called=false;
 const fetcher=async()=>{called=true;throw new Error('must not call');};
 const message='请先打开设置中的 AI 服务，填写自己的 DeepSeek API Key。';
 for(const [missingKeyMessage,expected] of [[message,message],[undefined,'AI 尚未配置，请先接通模型。']]){
  const service=createPdfTranslationService(()=>({model:'deepseek-flash',missingKeyMessage}),fetcher);
  const response=await service(new Request('http://localhost:3001/api/translate',{method:'POST',body:JSON.stringify({units:sample})}));
  assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:expected});
 }
 assert.equal(called,false);
});
function deferredTranslationService(registry=createTranslationRegistry(),onProviderSignal=()=>{}){
 const pending=[],responses=[];
 const fetcher=async(_url,init)=>new Promise(resolve=>{pending.push({resolve,signal:init.signal});onProviderSignal(init.signal);});
 const createService=()=>createPdfTranslationService(()=>({key:'test-private-key',model:'deepseek-test'}),fetcher,registry);
 const requestFor=(service)=>async(body)=>{
  const response=await service(new Request('http://localhost:3001/api/translate',{method:'POST',headers:{origin:'http://localhost:3001'},body:JSON.stringify(body)}));
  if(response.headers.get('content-type')?.includes('text/event-stream'))responses.push(response);
  return response;
 };
 const request=requestFor(createService());
 const finish=async()=>{
  for(const job of registry.jobs.values())job.cancel();
  for(const call of pending)call.resolve(completedProviderResponse());
  await Promise.all(responses.filter(response=>!response.bodyUsed).map(response=>response.text()));
 };
 return {registry,pending,request,createService,requestFor,finish};
}

test('translation covers raw pages exactly once without overlapping or losing tail text',()=>{
 const pages=[{page:1,text:'Paragraph. '.repeat(1500)+'FINAL'},{page:2,text:'第二页。'.repeat(1300)}];
 const units=translationUnits(pages);
 for(const page of pages)assert.equal(units.filter(unit=>unit.page===page.page).map(unit=>unit.text).join(''),page.text);
 assert.ok(units.every(unit=>unit.text.length<=4500));
 assert.deepEqual(parseTranslationInput(units),units);
});
test('line and sentence boundaries around character 4500 never exceed the translation input limit',()=>{
 const pages=[];
 for(const separator of ['\n','. ','。'])for(const offset of [4499,4500,4501]){
  const text='A'.repeat(offset)+separator+'B'.repeat(5000)+'TAIL';
  pages.push({page:pages.length+1,text,paragraphs:[{start:0,end:text.length,rects:[{x:10,y:15,width:75,height:2}]}]});
 }
 const units=translationUnits(pages);
 assert.ok(units.every(unit=>unit.text.length<=4500));
 for(const page of pages)assert.equal(units.filter(unit=>unit.page===page.page).map(unit=>unit.text).join(''),page.text);
 assert.deepEqual(parseTranslationInput(units),units);
});
test('a sentence or line boundary at a later chunk limit preserves every character and remains parseable',()=>{
 const pages=['\n','. ','。'].map((separator,index)=>({page:index+1,text:'A'.repeat(4500)+separator+'B'.repeat(4500-separator.length)+separator+'FINAL'}));
 const units=translationUnits(pages);
 assert.ok(units.every(unit=>unit.text.length<=4500));
 for(const page of pages)assert.equal(units.filter(unit=>unit.page===page.page).map(unit=>unit.text).join(''),page.text);
 assert.deepEqual(parseTranslationInput(units),units);
});
test('missing, duplicate and invented paragraph IDs prevent claiming complete translation',()=>{
 assert.throws(()=>translationResult(result(sample.slice(0,1)),sample),/覆盖/);
 assert.throws(()=>translationResult(result([sample[0],sample[0]]),sample),/重复/);
 assert.throws(()=>translationResult(result([sample[0],{...sample[1],id:'3:0'}]),sample),/缺少/);
 assert.equal(translationComplete(sample,[sample[0]]),false);
 assert.equal(translationComplete(sample,sample),true);
 assert.throws(()=>parseTranslationInput([sample[0],sample[0]]));
});
test('batching preserves all pages, passes relevant consistent terminology and emits completion after all batches',async()=>{
 const input=Array.from({length:4},(_,i)=>({id:`${i+1}:0`,page:i+1,text:'Research '.repeat(488)}));
 const events=[],calls=[];
 await translatePdfUnits(input,[],async messages=>{const body=JSON.parse(messages[1].content);calls.push(body);return {message:{role:'assistant',content:result(body.units)},reason:'stop'};},event=>events.push(event),new AbortController().signal);
 assert.equal(calls.length,8);assert.ok(calls[1].glossary.some(term=>term.target==='研究'));
 for(const unit of input)assert.equal(calls.flatMap(call=>call.units).filter(value=>value.id===unit.id).map(value=>value.text).join(''),unit.text);
 assert.deepEqual(events.filter(event=>event.type==='translated').flatMap(event=>event.units).map(unit=>unit.id),input.map(unit=>unit.id));
 assert.equal(events.at(-1).type,'done');
});
test('smaller reflow batches preserve every paragraph ID and source rectangle while protected batching stays unchanged',async()=>{
 const input=[2400,1800,2400].map((length,index)=>({id:`${index+1}:0`,page:index+1,text:'A'.repeat(length),parts:[{id:`${index+1}:0:0`,text:'A'.repeat(length),rects:[{x:1,y:2,width:80,height:10}]}]}));
 const calls=[],events=[];
 await translatePdfUnits(input,[],async messages=>{
  const body=JSON.parse(messages[1].content);calls.push(body.units);
  return {message:{role:'assistant',content:JSON.stringify({sourceLanguage:'英语',units:body.units.map(unit=>({id:unit.id,parts:unit.parts.map(part=>({id:part.id,text:'完整译文'}))})),glossary:[]})},reason:'stop'};
 },event=>events.push(event),new AbortController().signal);
 assert.deepEqual(calls.map(batch=>batch.map(unit=>unit.id)),[['1:0'],['1:0','2:0'],['3:0'],['3:0']]);
 for(const unit of input)assert.equal(calls.flat().filter(value=>value.id===unit.id).flatMap(value=>value.parts).map(value=>value.text).join(''),unit.text);
 const translated=events.filter(event=>event.type==='translated').flatMap(event=>event.units);
 assert.deepEqual(translated.map(unit=>unit.id),input.map(unit=>unit.id));
 for(let i=0;i<input.length;i++)assert.deepEqual(translated[i].parts[0].rects,input[i].parts[0].rects);
 assert.equal(events.at(-1).type,'done');
 const protectedInput=input.map(({parts:_parts,...unit})=>({...unit,protected:true})),protectedCalls=[];
 await translatePdfUnits(protectedInput,[],async messages=>{const body=JSON.parse(messages[1].content);protectedCalls.push(body.units);return {message:{role:'assistant',content:result(body.units)},reason:'stop'};},()=>{},new AbortController().signal);
 assert.equal(protectedCalls.length,1);
 assert.deepEqual(protectedCalls[0].map(unit=>unit.id),protectedInput.map(unit=>unit.id));
});
test('Kimi K3 ordinary translation uses low effort and saves each verified batch before a later failure',async()=>{
 const captured=[];
 const settings={provider:'kimi',model:'kimi-k3',key:'dummy-private-key'};
 const input=[{id:'1:0',page:1,text:'A'.repeat(4400)},{id:'2:0',page:2,text:'B'.repeat(4400)}];
 const service=createPdfTranslationService(()=>settings,async(_url,options)=>{
  const payload=JSON.parse(options.body);captured.push(payload);
  if(captured.length===3)throw new Error('provider unavailable');
  const units=JSON.parse(payload.messages[1].content).units;
  return new Response(`data: ${JSON.stringify({choices:[{delta:{content:result(units)},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
 });
 const response=await service(new Request('http://localhost:3001/api/translate',{method:'POST',body:JSON.stringify({units:input})}));
 const text=await response.text(),events=text.split('\n\n').filter(frame=>frame.startsWith('data: ')).map(frame=>JSON.parse(frame.slice(6)));
 assert.equal(captured.length,3);
 assert.ok(captured.every(payload=>payload.reasoning_effort==='low'&&payload.max_completion_tokens===32768&&!Object.hasOwn(payload,'thinking')));
 assert.deepEqual(events.filter(event=>event.type==='translated').flatMap(event=>event.units).map(unit=>unit.id),['1:0']);
 assert.equal(events.at(-1).type,'error');assert.equal(events.some(event=>event.type==='done'),false);
 assert.ok(!text.includes('dummy-private-key'));
});
test('truncated model output and cancellation cannot emit successful completion',async()=>{
 const events=[];
 await assert.rejects(translatePdfUnits(sample,[],async()=>({message:{role:'assistant',content:result(sample)},reason:'length'}),event=>events.push(event),new AbortController().signal),/长度限制/);
 assert.ok(!events.some(event=>event.type==='done'));
 const stop=new AbortController();stop.abort();let called=false;
 await assert.rejects(translatePdfUnits(sample,[],async()=>{called=true;},()=>{},stop.signal));assert.equal(called,false);
});
test('translation API keeps credentials server-side and rejects foreign origins and invalid payloads',async()=>{
 const service=createPdfTranslationService(()=>({key:'test-private-key',model:'deepseek-test-model'}),async()=>{throw new Error('must not call');});
 assert.equal((await service(new Request('https://example.com/api/translate',{method:'POST',body:'{}'}))).status,403);
 assert.equal((await service(new Request('http://localhost:3001/api/translate',{method:'POST',headers:{origin:'https://example.com'},body:'{}'}))).status,403);
 const invalid=await service(new Request('http://localhost:3001/api/translate',{method:'POST',body:JSON.stringify({units:[]})}));assert.equal(invalid.status,400);assert.ok(!(await invalid.text()).includes('test-private-key'));
});

test('closing a task explicitly releases capacity before an unresponsive provider finishes',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:0});
 const pending=[];
 const service=createPdfTranslationService(()=>({key:'test-private-key',model:'deepseek-test'}),async(_url,init)=>new Promise(resolve=>pending.push({resolve,signal:init.signal})));
 const request=(body)=>service(new Request('http://localhost:3001/api/translate',{method:'POST',headers:{origin:'http://localhost:3001'},body:JSON.stringify(body)}));
 const first=await request({jobId:'first',units:sample}),second=await request({jobId:'second',units:sample});
 assert.equal(first.status,200);assert.equal(second.status,200);
 assert.equal((await request({jobId:'blocked',units:sample})).status,429);
 assert.equal((await request({action:'cancel',jobId:'first'})).status,200);
 assert.equal(pending[0].signal.aborted,false);
 const resumed=await request({jobId:'resumed',units:sample});assert.equal(resumed.status,200);
 t.mock.timers.tick(250);
 assert.equal(pending[0].signal.aborted,true);
 await request({action:'cancel',jobId:'second'});await request({action:'cancel',jobId:'resumed'});
 // Provider deliberately ignores abort until now, reproducing stale slots.
 for(const value of pending)value.resolve(new Response('data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}}));
 for(const response of [first,second,resumed])assert.ok(!(await response.text()).includes('"type":"done"'));
});

test('aligned translation validates each paragraph and preserves source geometry without sending it to the model',async()=>{
 const units=translationUnits([{page:1,text:'First paragraph. Second paragraph.',paragraphs:[{start:0,end:17,rects:[{x:10,y:15,width:75,height:2}]},{start:17,end:34,rects:[{x:10,y:25,width:75,height:2}]}]}]);
 assert.equal(units[0].parts.map(part=>part.text).join(''),units[0].text);
 assert.deepEqual(parseTranslationInput(units),units);
 assert.throws(()=>parseTranslationInput([{...units[0],parts:units[0].parts.slice(0,1)}]),/完整原文/);
 const json=JSON.stringify({sourceLanguage:'英语',units:[{id:'1:0',parts:[{id:'1:0:0',text:'第一段。'},{id:'1:0:1',text:'第二段。'}]}]});
 const translated=translationResult(json,units).units;
 assert.equal(translated[0].text,'第一段。\n\n第二段。');assert.deepEqual(translated[0].parts[1].rects,units[0].parts[1].rects);
 assert.equal(translationComplete(units,translated),true);assert.equal(translationComplete(units,[{...translated[0],parts:translated[0].parts.slice(0,1)}]),false);
 assert.throws(()=>translationResult(json.replace('1:0:1','missing'),units),/对应段落/);
 const events=[];await translatePdfUnits([{...units[0],referenceText:'已有中文译文'}],[],async messages=>{
  const sent=JSON.parse(messages[1].content).units[0];assert.equal(sent.referenceText,'已有中文译文');assert.equal(sent.parts[0].rects,undefined);
  return {message:{role:'assistant',content:json},reason:'stop'};
 },event=>events.push(event),new AbortController().signal);
 assert.equal(events.at(-1).type,'done');
});

const fragmentResult=units=>JSON.stringify({sourceLanguage:'英语',units:units.map(unit=>unit.parts?{id:unit.id,parts:unit.parts.map(part=>({id:part.id,text:`译文 ${part.text}`}))}:{id:unit.id,text:`译文 ${unit.text}`}),glossary:[]});
const translationEvents=text=>text.split('\n\n').filter(frame=>frame.startsWith('data: ')).map(frame=>JSON.parse(frame.slice(6)));
function trialTranslationHarness({maxCalls=6,onCall}={}){
 const requests=[],profile={userId:'translation-test-user',expiresAt:'2080-01-01T00:00:00.000Z',budgetMicros:10_000_000,spentMicros:0,reservedMicros:0,remainingMicros:10_000_000,
  providers:[{id:'deepseek',name:'DeepSeek',model:'deepseek-flash'}],defaultProvider:'deepseek',status:'active',limits:{userConcurrent:1,globalConcurrent:2,dailyTasks:30,maxCalls}};
 const service=createPdfTranslationService(()=>({usageMode:'trial',provider:'deepseek',model:'deepseek-flash',key:'never-use-personal-key',trial:{gatewayUrl:'https://api.lumior.work',token:'t'.repeat(43)}}),async(url,options)=>{
  const path=new URL(url).pathname,body=options.body?JSON.parse(options.body):undefined;requests.push({path,body,options});
  if(path==='/v1/account')return Response.json(profile);
  if(path==='/v1/tasks')return Response.json({taskId:body.requestId,expiresAt:profile.expiresAt});
  if(path.endsWith('/finish'))return Response.json({finished:true});
  assert.ok(path.endsWith('/calls'));
  assert.ok(new TextEncoder().encode(options.body).byteLength<30_000);
  const payload=JSON.parse(body.messages[1].content);
  if(onCall)return onCall(body,payload);
  return Response.json({reason:'stop',message:{role:'assistant',content:fragmentResult(payload.units)}});
 });
 return {requests,service,request:body=>service(new Request('http://localhost:3001/api/translate',{method:'POST',body:JSON.stringify(body)}))};
}

test('long paragraphs and dense metadata use bounded fragments without losing characters, IDs or source rectangles',async()=>{
 const long='A'.repeat(2199)+'😀'+'B'.repeat(2299),rect={x:2,y:10,width:75,height:4};
 const metadata=Array.from({length:100},(_,index)=>({id:`2:0:${index}`,text:`Metadata ${index}. `,rects:[{...rect,y:index}]}));
 const input=[{id:'1:0',page:1,text:long,parts:[{id:'1:0:0',text:long,rects:[rect]}]},{id:'2:0',page:2,text:metadata.map(part=>part.text).join(''),parts:metadata}],calls=[],events=[];
 await translatePdfUnits(input,[],async messages=>{
  const payload=JSON.parse(messages[1].content);calls.push(payload);
  assert.ok(payload.units.reduce((total,unit)=>total+unit.parts.reduce((length,part)=>length+part.text.length,0),0)<=2200);
  assert.ok(payload.units.reduce((total,unit)=>total+unit.parts.length,0)<=24);
  assert.equal(new Set(payload.units.map(unit=>unit.id)).size,payload.units.length);
  assert.ok(new TextEncoder().encode(JSON.stringify(messages)).byteLength<=24_000);
  for(const unit of payload.units)for(const part of unit.parts){assert.equal(part.rects,undefined);assert.ok(!/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(part.text));}
  return {reason:'stop',message:{role:'assistant',content:fragmentResult(payload.units)}};
 },event=>events.push(event),new AbortController().signal);
 const output=events.filter(event=>event.type==='translated').flatMap(event=>event.units);
 assert.deepEqual(output.map(unit=>unit.id),input.map(unit=>unit.id));
 for(let index=0;index<input.length;index++)for(const part of input[index].parts){
  const sent=calls.flatMap(call=>call.units).filter(unit=>unit.id===input[index].id).flatMap(unit=>unit.parts).filter(value=>value.id===part.id);
  assert.equal(sent.map(value=>value.text).join(''),part.text);
  assert.deepEqual(output[index].parts.find(value=>value.id===part.id).rects,part.rects);
 }
 assert.ok(calls.length>2);assert.equal(translationComplete(input,output),true);assert.equal(events.at(-1).type,'done');
});

test('large glossary and reference translations cannot grow ordinary requests past the trial payload cap',async()=>{
 const glossary=Array.from({length:100},(_,index)=>({source:`${'A'.repeat(115)}${String(index).padStart(3,'0')}`,target:'术'.repeat(120)}));
 const text=glossary.slice(0,15).map(term=>term.source).join(' '),unit={id:'1:0',page:1,text,referenceText:'旧译文'.repeat(6000),parts:[{id:'1:0:0',text,rects:[]}]};
 const harness=trialTranslationHarness(),response=await harness.request({units:[unit],glossary});
 const events=translationEvents(await response.text()),calls=harness.requests.filter(request=>request.path.endsWith('/calls'));
 assert.equal(calls.length,1);assert.equal(calls[0].body.reasoningEffort,'low');
 const sent=JSON.parse(calls[0].body.messages[1].content);
 assert.equal(sent.units[0].referenceText,undefined);assert.equal(sent.units[0].parts[0].text,text);
 assert.equal(sent.glossary.length,15);assert.equal(events.find(event=>event.type==='translated').glossary.length,100);
 assert.equal(events.at(-1).type,'done');
 const overlappingTerms=Array.from({length:100},(_,index)=>({source:'A'.repeat(index+1),target:'术'.repeat(120)})),second=trialTranslationHarness();
 const bounded=translationEvents(await (await second.request({units:[{id:'1:0',page:1,text:'A'.repeat(2200)}],glossary:overlappingTerms})).text());
 const requestedTerms=JSON.parse(second.requests.find(request=>request.path.endsWith('/calls')).body.messages[1].content).glossary;
 assert.ok(requestedTerms.length>0&&requestedTerms.length<100);
 assert.equal(bounded.find(event=>event.type==='translated').glossary.length,100);assert.equal(bounded.at(-1).type,'done');
});

test('ordinary translation selects low effort while protected layout retains its provider effort policy',async()=>{
 for(const [provider,model] of [['deepseek','deepseek-flash'],['glm','glm-5.2'],['kimi','kimi-k3']])for(const protectedInput of [false,true]){
  let captured;
  const units=[{id:'1:0',page:1,text:'A brief paragraph.',...(protectedInput?{protected:true}:{})}];
  const service=createPdfTranslationService(()=>({provider,model,key:'synthetic-private-key'}),async(_url,options)=>{
   captured=JSON.parse(options.body);const payload=JSON.parse(captured.messages[1].content);
   return new Response(`data: ${JSON.stringify({choices:[{delta:{content:fragmentResult(payload.units)},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);
  });
  assert.equal(translationEvents(await (await service(new Request('http://localhost:3001/api/translate',{method:'POST',body:JSON.stringify({units})}))).text()).at(-1).type,'done');
  assert.equal(captured.reasoning_effort,protectedInput&&provider!=='kimi'?'high':'low');
 }
});

test('a later invalid fragment saves earlier original units but never publishes or completes the unfinished unit',async()=>{
 const input=[{id:'1:0',page:1,text:'A'.repeat(2200)},{id:'2:0',page:2,text:'B'.repeat(4400)}],events=[];let calls=0;
 await assert.rejects(translatePdfUnits(input,[],async messages=>{
  calls++;const payload=JSON.parse(messages[1].content);
  return {reason:'stop',message:{role:'assistant',content:calls===3?JSON.stringify({sourceLanguage:'英语',units:[]}):fragmentResult(payload.units)}};
 },event=>events.push(event),new AbortController().signal),/覆盖/);
 assert.equal(calls,3);assert.deepEqual(events.filter(event=>event.type==='translated').flatMap(event=>event.units).map(unit=>unit.id),['1:0']);
 assert.equal(events.some(event=>event.type==='done'),false);
});

test('cancellation between fragments prevents any incomplete original unit or further model call',async()=>{
 const signal=new AbortController(),events=[];let calls=0;
 await assert.rejects(translatePdfUnits([{id:'1:0',page:1,text:'A'.repeat(4400)}],[],async messages=>{
  calls++;signal.abort(new DOMException('Stopped','AbortError'));return {reason:'stop',message:{role:'assistant',content:fragmentResult(JSON.parse(messages[1].content).units)}};
 },event=>events.push(event),signal.signal),/Stopped/);
 assert.equal(calls,1);assert.equal(events.some(event=>event.type==='translated'||event.type==='done'),false);
 for(const stage of ['progress','translated']){
  const stop=new AbortController(),notifications=[];let called=0;
  await assert.rejects(translatePdfUnits(sample,[],async messages=>{called++;return {reason:'stop',message:{role:'assistant',content:fragmentResult(JSON.parse(messages[1].content).units)}};},event=>{notifications.push(event);if(event.type===stage)stop.abort(new DOMException('Stopped','AbortError'));},stop.signal),/Stopped/);
  assert.equal(called,stage==='progress'?0:1);assert.equal(notifications.some(event=>event.type==='done'),false);
 }
});

test('trial translation stops at its six-call limit and only an explicit continuation creates another quota task',async()=>{
 const input=Array.from({length:7},(_,index)=>({id:`${index+1}:0`,page:index+1,text:'A'.repeat(2200)})),harness=trialTranslationHarness();
 const first=translationEvents(await (await harness.request({units:input})).text());
 assert.equal(harness.requests.filter(request=>request.path.endsWith('/calls')).length,6);
 assert.equal(harness.requests.filter(request=>request.path==='/v1/tasks').length,1);
 assert.equal(harness.requests.filter(request=>request.path.endsWith('/finish')).length,1);
 assert.deepEqual(first.filter(event=>event.type==='translated').flatMap(event=>event.units).map(unit=>unit.id),input.slice(0,6).map(unit=>unit.id));
 assert.match(first.at(-1).message,/已保留完成的译文；点击继续翻译/);assert.equal(first.some(event=>event.type==='done'),false);
 const continued=translationEvents(await (await harness.request({units:input.slice(6)})).text());
 assert.equal(harness.requests.filter(request=>request.path.endsWith('/calls')).length,7);
 assert.equal(harness.requests.filter(request=>request.path==='/v1/tasks').length,2);
 assert.equal(continued.at(-1).type,'done');
});

test('trial translation stops before beginning an original unit that cannot fit the remaining calls',async()=>{
 const input=[...Array.from({length:5},(_,index)=>({id:`${index+1}:0`,page:index+1,text:'A'.repeat(2200)})),{id:'6:0',page:6,text:'B'.repeat(4400)}],harness=trialTranslationHarness();
 const events=translationEvents(await (await harness.request({units:input})).text());
 assert.equal(harness.requests.filter(request=>request.path.endsWith('/calls')).length,5);
 assert.equal(events.filter(event=>event.type==='translated').flatMap(event=>event.units).length,5);
 assert.match(events.at(-1).message,/已保留完成的译文/);assert.equal(events.some(event=>event.type==='done'),false);
});

test('a trial unit requiring more than six fragments is rejected before starting or charging a quota task',async()=>{
 const parts=Array.from({length:145},(_,index)=>({id:`1:0:${index}`,text:`Label ${index}. `,rects:[]})),harness=trialTranslationHarness();
 const response=await harness.request({units:[{id:'1:0',page:1,text:parts.map(part=>part.text).join(''),parts}]});
 assert.equal(response.status,413);assert.match((await response.json()).error,/本页需要对照的段落过多/);
 assert.deepEqual(harness.requests.map(request=>request.path),['/v1/account']);
});

test('remote trial call limits are actionable translation errors and never cause automatic retries or new tasks',async()=>{
 const harness=trialTranslationHarness({onCall:()=>Response.json({error:{code:'call_limit'}},{status:429})});
 const events=translationEvents(await (await harness.request({units:sample})).text());
 assert.equal(harness.requests.filter(request=>request.path.endsWith('/calls')).length,1);
 assert.equal(harness.requests.filter(request=>request.path==='/v1/tasks').length,1);
 assert.equal(harness.requests.filter(request=>request.path.endsWith('/finish')).length,1);
 assert.match(events.at(-1).message,/本轮体验翻译.*点击继续翻译/);assert.equal(events.some(event=>event.type==='done'),false);
});

test('ordinary provider timeouts retain earlier original units and direct the reader to continue translation',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});let calls=0;
 const input=[{id:'1:0',page:1,text:'A'.repeat(2200)},{id:'2:0',page:2,text:'B'.repeat(2200)}];
 const service=createPdfTranslationService(()=>({provider:'deepseek',model:'deepseek-flash',key:'synthetic-private-key'}),async(_url,options)=>{
  calls++;
  if(calls===1){const units=JSON.parse(JSON.parse(options.body).messages[1].content).units;return new Response(`data: ${JSON.stringify({choices:[{delta:{content:fragmentResult(units)},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);}
  return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
 });
 const response=await service(new Request('http://localhost:3001/api/translate',{method:'POST',body:JSON.stringify({units:input})}));
 const output=response.text();for(let tick=0;tick<40&&calls<2;tick++)await Promise.resolve();
 assert.equal(calls,2);t.mock.timers.tick(180_000);
 const events=translationEvents(await output);
 assert.deepEqual(events.filter(event=>event.type==='translated').flatMap(event=>event.units).map(unit=>unit.id),['1:0']);
 assert.match(events.at(-1).message,/本批翻译响应超时.*点击继续翻译/);assert.equal(events.some(event=>event.type==='done'),false);
});

test('a tool-call finish with translation-shaped text cannot be accepted as a completed translation',async()=>{
 const events=[];
 await assert.rejects(translatePdfUnits(sample,[],async()=>({reason:'tool_calls',message:{role:'assistant',content:result(sample)}}),event=>events.push(event),new AbortController().signal),/未完整返回/);
 assert.equal(events.some(event=>event.type==='translated'||event.type==='done'),false);
});

test('a close arriving before its delayed start request cannot leave a hidden running job',async()=>{
 let called=false;
 const service=createPdfTranslationService(()=>({key:'test-private-key',model:'deepseek-test'}),async()=>{called=true;throw new Error('unexpected');});
 const request=(body)=>service(new Request('http://localhost:3001/api/translate',{method:'POST',body:JSON.stringify(body)}));
 assert.equal((await request({action:'cancel',jobId:'delayed-start'})).status,200);
 assert.equal((await request({jobId:'delayed-start',units:sample})).status,409);
 assert.equal(called,false);
});

test('reopening the same reader replaces an orphan when its cancel request was lost',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:0});
 const harness=deferredTranslationService(),{request,registry,pending}=harness;
 try{
  const orphan=await request({jobId:'orphan',ownerId:'reader-a',units:sample});
  assert.equal(orphan.status,200);
  assert.equal((await request({jobId:'other-reader',ownerId:'reader-b',units:sample})).status,200);
  assert.equal((await request({jobId:'blocked',ownerId:'reader-c',units:sample})).status,429);
  // No cancel reaches the server before this reader opens a new translation.
  const replacement=await request({jobId:'replacement',ownerId:'reader-a',units:sample});
  assert.equal(replacement.status,200);assert.equal(pending[0].signal.aborted,false);
  assert.deepEqual([...registry.jobs.keys()],['other-reader','replacement']);
  t.mock.timers.tick(250);assert.equal(pending[0].signal.aborted,true);
  assert.deepEqual(await (await request({action:'heartbeat',jobId:'orphan',ownerId:'reader-a'})).json(),{active:false});
  assert.equal((await request({jobId:'orphan',ownerId:'reader-a',units:sample})).status,409);
  // Even a valid late provider result cannot finish the cancelled task or release its replacement.
  pending[0].resolve(completedProviderResponse());
  const oldOutput=await orphan.text();
  assert.ok(!oldOutput.includes('"type":"translated"'));assert.ok(!oldOutput.includes('"type":"done"'));
  assert.deepEqual([...registry.jobs.keys()],['other-reader','replacement']);
  assert.equal((await request({jobId:'still-blocked',ownerId:'reader-c',units:sample})).status,429);
  assert.equal((await request({action:'cancel',jobId:'other-reader',ownerId:'reader-b'})).status,200);
  assert.equal((await request({jobId:'resumed',ownerId:'reader-c',units:sample})).status,200);
 }finally{await harness.finish();}
});

test('reader leases release capacity after 90 seconds without a heartbeat',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:0});
 const harness=deferredTranslationService(),{request,registry,pending}=harness;
 try{
  const expired=await request({jobId:'expired',ownerId:'reader-a',units:sample});
  assert.equal(expired.status,200);
  assert.equal((await request({jobId:'also-expired',ownerId:'reader-b',units:sample})).status,200);
  t.mock.timers.tick(89999);assert.equal(registry.jobs.size,2);
  assert.ok(pending.every(call=>!call.signal.aborted));
  t.mock.timers.tick(1);assert.equal(registry.jobs.size,0);
  assert.ok(pending.every(call=>call.signal.aborted));
  assert.deepEqual(await (await request({action:'heartbeat',jobId:'expired',ownerId:'reader-a'})).json(),{active:false});
  assert.equal((await request({jobId:'after-expiry',ownerId:'reader-a',units:sample})).status,200);
  assert.equal((await request({jobId:'after-expiry-other',ownerId:'reader-b',units:sample})).status,200);
  pending[0].resolve(completedProviderResponse());
  const oldOutput=await expired.text();assert.ok(!oldOutput.includes('"type":"done"'));
  assert.equal(registry.jobs.size,2);
 }finally{await harness.finish();}
});

test('a heartbeat renews only its reader lease and a foreign owner cannot cancel or extend it',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:0});
 const harness=deferredTranslationService(),{request,registry,pending}=harness;
 try{
  assert.equal((await request({jobId:'renewed',ownerId:'reader-a',units:sample})).status,200);
  assert.equal((await request({jobId:'unrenewed',ownerId:'reader-b',units:sample})).status,200);
  t.mock.timers.tick(60000);
  assert.deepEqual(await (await request({action:'heartbeat',jobId:'renewed',ownerId:'reader-a'})).json(),{active:true});
  t.mock.timers.tick(30001);
  assert.deepEqual([...registry.jobs.keys()],['renewed']);
  assert.equal(pending[0].signal.aborted,false);assert.equal(pending[1].signal.aborted,true);
  assert.equal((await request({action:'cancel',jobId:'renewed',ownerId:'reader-b'})).status,403);
  assert.equal((await request({action:'heartbeat',jobId:'renewed',ownerId:'reader-b'})).status,403);
  assert.equal((await request({action:'cancel',jobId:'renewed'})).status,403);
  t.mock.timers.tick(59998);assert.equal(registry.jobs.has('renewed'),true);
  t.mock.timers.tick(1);assert.equal(registry.jobs.has('renewed'),false);
  assert.equal(pending[0].signal.aborted,true);
  assert.equal((await request({jobId:'resumed-a',ownerId:'reader-a',units:sample})).status,200);
  assert.equal((await request({jobId:'resumed-b',ownerId:'reader-b',units:sample})).status,200);
 }finally{await harness.finish();}
});

test('recreated service handlers share active tasks and release capacity through the same registry',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:0});
 const harness=deferredTranslationService(),{request,registry,pending}=harness;
 const reloaded=harness.requestFor(harness.createService());
 try{
  assert.equal((await request({jobId:'before-reload',ownerId:'reader-a',units:sample})).status,200);
  assert.equal((await reloaded({jobId:'after-reload',ownerId:'reader-b',units:sample})).status,200);
  assert.equal((await reloaded({jobId:'blocked-after-reload',ownerId:'reader-c',units:sample})).status,429);
  assert.equal((await reloaded({action:'cancel',jobId:'before-reload',ownerId:'reader-a'})).status,200);
  assert.equal(pending[0].signal.aborted,false);assert.equal(registry.jobs.size,1);
  t.mock.timers.tick(250);assert.equal(pending[0].signal.aborted,true);
  assert.equal((await request({jobId:'resumed-before-handler',ownerId:'reader-c',units:sample})).status,200);
 }finally{await harness.finish();}
});

test('a delayed older start cannot cancel a newer generation from the same reader',async()=>{
 const harness=deferredTranslationService(),{request,registry,pending}=harness;
 let deliverOldBody;
 const oldBody=new Promise(resolve=>{deliverOldBody=resolve;});
 const oldRequest=new Request('http://localhost:3001/api/translate',{method:'POST',body:'{}'});
 Object.defineProperty(oldRequest,'text',{value:()=>oldBody});
 // Both requests reach the handler, but the older request's body arrives last.
 const oldStart=harness.createService()(oldRequest);
 try{
  assert.equal((await request({jobId:'new-start',ownerId:'reader-a',ownerGeneration:2,units:sample})).status,200);
  deliverOldBody(JSON.stringify({jobId:'delayed-old-start',ownerId:'reader-a',ownerGeneration:1,units:sample}));
  const stale=await oldStart;
  assert.equal(stale.status,409);
  assert.equal(pending.length,1);assert.equal(pending[0].signal.aborted,false);
  assert.deepEqual([...registry.jobs.keys()],['new-start']);
 }finally{
  deliverOldBody(JSON.stringify({jobId:'delayed-old-start',ownerId:'reader-a',ownerGeneration:1,units:sample}));
  await oldStart;await harness.finish();
 }
});

test('an early cancel retires its reader generation before the delayed start arrives',async()=>{
 const harness=deferredTranslationService(),{request,registry,pending}=harness;
 try{
  assert.equal((await request({action:'cancel',jobId:'cancel-before-start',ownerId:'reader-a',ownerGeneration:1})).status,200);
  assert.equal((await request({jobId:'cancel-before-start',ownerId:'reader-a',ownerGeneration:1,units:sample})).status,409);
  // The owner generation also prevents a delayed old attempt with a different job ID.
  assert.equal((await request({jobId:'old-generation-other-id',ownerId:'reader-a',ownerGeneration:1,units:sample})).status,409);
  assert.equal(pending.length,0);assert.equal(registry.jobs.size,0);
  assert.equal((await request({jobId:'next-generation',ownerId:'reader-a',ownerGeneration:2,units:sample})).status,200);
  assert.equal(pending.length,1);
 }finally{await harness.finish();}
});

test('a completed newer generation still rejects a delayed older start',async()=>{
 const harness=deferredTranslationService(),{request,registry,pending}=harness;
 try{
  const current=await request({jobId:'completed-new-generation',ownerId:'reader-a',ownerGeneration:2,units:sample});
  assert.equal(current.status,200);
  pending[0].resolve(completedProviderResponse());
  assert.ok((await current.text()).includes('"type":"done"'));
  assert.equal(registry.jobs.size,0);
  assert.equal((await request({jobId:'late-old-generation',ownerId:'reader-a',ownerGeneration:1,units:sample})).status,409);
  assert.equal((await request({jobId:'duplicate-completed-generation',ownerId:'reader-a',ownerGeneration:2,units:sample})).status,409);
  assert.equal(pending.length,1);assert.equal(registry.jobs.size,0);
  assert.equal((await request({jobId:'fresh-generation',ownerId:'reader-a',ownerGeneration:3,units:sample})).status,200);
 }finally{await harness.finish();}
});

test('stale cancels and legacy starts preserve a newer task while heartbeats do not advance its generation',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:0});
 const harness=deferredTranslationService(),{request,registry,pending}=harness;
 try{
  assert.equal((await request({jobId:'active-old-generation',ownerId:'reader-a',ownerGeneration:1,units:sample})).status,200);
  assert.equal((await request({jobId:'active-new-generation',ownerId:'reader-a',ownerGeneration:2,units:sample})).status,200);
  assert.equal(pending[0].signal.aborted,false);assert.equal(pending[1].signal.aborted,false);
  t.mock.timers.tick(250);assert.equal(pending[0].signal.aborted,true);
  assert.equal((await request({action:'cancel',jobId:'active-old-generation',ownerId:'reader-a',ownerGeneration:1})).status,200);
  assert.equal(pending[1].signal.aborted,false);
  assert.equal((await request({jobId:'legacy-delayed-start',ownerId:'reader-a',units:sample})).status,409);
  assert.equal(pending[1].signal.aborted,false);
  assert.deepEqual(await (await request({action:'heartbeat',jobId:'active-new-generation',ownerId:'reader-a',ownerGeneration:999})).json(),{active:true});
  assert.equal((await request({jobId:'valid-next-generation',ownerId:'reader-a',ownerGeneration:3,units:sample})).status,200);
  assert.equal(pending[1].signal.aborted,false);assert.equal(pending[2].signal.aborted,false);
  assert.deepEqual([...registry.jobs.keys()],['valid-next-generation']);
  t.mock.timers.tick(250);assert.equal(pending[1].signal.aborted,true);
 }finally{await harness.finish();}
});

test('cancel and replacement release capacity without touching another request’s provider I/O',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:0});
 let context='start-request',forbiddenAborts=0,providerAborts=0;
 const abortGuards=[];
 const originalAbort=Reflect.get(AbortController.prototype,'abort');
 t.mock.method(AbortController.prototype,'abort',function(...args){
  // Workers surface an abort listener's cross-request I/O error synchronously.
  // Preflight the same guards here to avoid Node deferring listener errors to an uncaught exception.
  for(const guard of abortGuards)guard();
  return Reflect.apply(originalAbort,this,args);
 });
 const harness=deferredTranslationService(createTranslationRegistry(),signal=>{
  const guard=()=>{if(context!=='original-request'){forbiddenAborts++;throw new Error('Cannot perform I/O on behalf of a different request');}};
  abortGuards.push(guard);signal.addEventListener('abort',guard,{once:true});
  signal.addEventListener('abort',()=>{providerAborts++;},{once:true});
 });
 const {request,registry,pending}=harness;
 try{
  const cancelled=await request({jobId:'context-cancelled',ownerId:'reader-a',ownerGeneration:1,units:sample});
  const replaced=await request({jobId:'context-replaced',ownerId:'reader-b',ownerGeneration:1,units:sample});
  assert.equal(cancelled.status,200);assert.equal(replaced.status,200);
  context='cancel-request';
  assert.equal((await request({action:'cancel',jobId:'context-cancelled',ownerId:'reader-a',ownerGeneration:1})).status,200);
  assert.equal(registry.jobs.size,1);assert.equal(pending[0].signal.aborted,false);
  context='replacement-request';
  assert.equal((await request({jobId:'context-replacement',ownerId:'reader-b',ownerGeneration:2,units:sample})).status,200);
  assert.deepEqual([...registry.jobs.keys()],['context-replacement']);
  assert.equal(pending[1].signal.aborted,false);
  assert.equal((await request({jobId:'context-resumed',ownerId:'reader-c',ownerGeneration:1,units:sample})).status,200);
  assert.equal(registry.jobs.size,2);assert.equal(forbiddenAborts,0);assert.equal(providerAborts,0);
  context='original-request';
  t.mock.timers.tick(249);assert.equal(providerAborts,0);
  t.mock.timers.tick(1);assert.equal(providerAborts,2);
  assert.ok(pending.slice(0,2).every(call=>call.signal.aborted));
  assert.ok(pending.slice(2).every(call=>!call.signal.aborted));
  for(const call of pending.slice(0,2))call.resolve(completedProviderResponse());
  for(const response of [cancelled,replaced])assert.ok(!(await response.text()).includes('"type":"done"'));
  assert.equal(registry.jobs.size,2);assert.equal(forbiddenAborts,0);
 }finally{context='original-request';await harness.finish();}
});

test('a retired task cannot finish when its provider returns before the ownership timer',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:0});
 const harness=deferredTranslationService(),{request,registry,pending}=harness;
 try{
  const retired=await request({jobId:'retired-before-timer',ownerId:'reader-a',ownerGeneration:1,units:sample});
  assert.equal(retired.status,200);
  assert.equal((await request({jobId:'replacement-before-timer',ownerId:'reader-a',ownerGeneration:2,units:sample})).status,200);
  assert.equal(pending[0].signal.aborted,false);
  pending[0].resolve(completedProviderResponse());
  const oldOutput=await retired.text();
  assert.ok(!oldOutput.includes('"type":"translated"'));assert.ok(!oldOutput.includes('"type":"done"'));
  assert.deepEqual([...registry.jobs.keys()],['replacement-before-timer']);
  assert.equal(pending[1].signal.aborted,false);
 }finally{await harness.finish();}
});
