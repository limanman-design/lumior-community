import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import * as aiRuntime from '../lib/ai-runtime.ts';
import { parseTranslationInput, translationComplete, translationResult, validateInlineTranslationPart } from '../lib/pdf-translation.ts';
import { localTranslationFragments, localTranslationMessages, translateLocalPdfUnits } from '../lib/local-translation.ts';
import { createPdfTranslationService, createTranslationRegistry } from '../lib/pdf-translation-service.ts';

const sourceHash='a'.repeat(64);
const formula={marker:'{v10001}',text:'nᵢ',rect:{x:20,y:30,width:5,height:2},baseline:31.5,fontSize:10};
const part=(index,text,inlineFormulas)=>({id:`1:0:${index}`,text,rects:[{x:10,y:20+index*5,width:80,height:2}],sourceHash,...(inlineFormulas?{inlineFormulas}:{})});
const unit=(parts)=>({id:'1:0',page:1,text:parts.map(value=>value.text).join(''),parts,inlineMathVersion:1});
const input=()=>unit([part(0,'The occupation {v10001} is fixed. ',[structuredClone(formula)]),part(1,'The conclusion is unchanged.')]);
const translated=source=>({...source,parts:source.parts.map(({reuseText:_reuse,...value})=>({...value,text:value.text.replace('The occupation','占据数').replace('is fixed.','固定。')}))});
const sourceOf=messages=>messages[0].content.split('将以下文本完整翻译为简体中文，只输出译文，不要额外解释：\n').at(-1);
const result=content=>({message:{role:'assistant',content},reason:'stop'});

test('inline request parsing retains source-bound formula metadata and validated reusable paragraphs',()=>{
 const source=input();source.parts[1].reuseText='原有结论保持不变。';const before=structuredClone(source);
 const [parsed]=parseTranslationInput([source]);assert.deepEqual(parsed,source);assert.deepEqual(source,before);
 for(const mutate of [
  value=>{value.inlineMathVersion=2;},value=>{delete value.inlineMathVersion;},value=>{value.protected=true;},
  value=>{delete value.parts[0].sourceHash;},value=>{value.parts[0].sourceHash='bad';},
  value=>{value.parts[0].inlineFormulas[0].marker='{vbad}';},value=>{value.parts[0].inlineFormulas.push(formula);},
  value=>{value.parts[0].inlineFormulas[0].rect.x=99;},value=>{value.parts[0].inlineFormulas[0].baseline=29;},
  value=>{value.parts[0].inlineFormulas[0].fontSize=Infinity;},value=>{value.parts[0].reuseText='误丢公式';},
  value=>{value.parts[0].reuseText='{v10001}重复{v10001}';},value=>{value.parts[0].reuseText='';},
 ]){const bad=structuredClone(source);mutate(bad);assert.throws(()=>parseTranslationInput([bad]));}
 const duplicated=input();duplicated.parts[0].text+=' {v10001}';duplicated.text=duplicated.parts.map(value=>value.text).join('');assert.throws(()=>parseTranslationInput([duplicated]));
 const missing=input();missing.parts[0].text='Missing placeholder.';missing.text=missing.parts.map(value=>value.text).join('');assert.throws(()=>parseTranslationInput([missing]));
});

test('UTF-8 fragmentation never splits a formula placeholder or drops source characters',()=>{
 for(const prefix of ['a'.repeat(1797),'中'.repeat(599),'a'.repeat(1799)]){
  const source=prefix+'{v10001} followed by '+ '中文。'.repeat(300)+'{v10002} tail';
  const fragments=localTranslationFragments(source);assert.equal(fragments.join(''),source);
  for(const fragment of fragments){assert.ok(new TextEncoder().encode(fragment).length<=1800);assert.equal((fragment.match(/\{v/g)||[]).length,(fragment.match(/\{v\d+\}/g)||[]).length);}
  assert.equal(fragments.filter(fragment=>fragment.includes('{v10001}')).length,1);
 }
 assert.throws(()=>localTranslationFragments('{v'+'1'.repeat(1800)+'}'),/未截断/);
 const messages=localTranslationMessages('The occupation {v10001} is fixed.',[]);
 assert.ok(messages[0].content.includes('对应的语义位置'));assert.equal(sourceOf(messages),'The occupation {v10001} is fixed.');
 assert.ok(messages[0].content.includes('半角花括号'));assert.ok(messages[0].content.includes('不能改成方括号[]'));
 const caption='Ramp-down times {v40013} of 400 ms; ramp-down times {v40014} of 0.1 ms.';
 const captionPrompt=localTranslationMessages(caption,[])[0].content;
 assert.ok(captionPrompt.includes('本段必须保留的公式标记：{v40013},{v40014}。'));
 assert.ok(captionPrompt.includes('即使重复表达也不可省略，不可挪到句尾。'));
 assert.ok(captionPrompt.indexOf('本段必须保留的公式标记：')<captionPrompt.indexOf('将以下文本完整翻译为简体中文'));
 assert.equal(sourceOf([{content:captionPrompt}]),caption);
 const dense='Formula '+Array.from({length:198},(_,index)=>`{v${10000+index}}`).join(' ');
 assert.ok(new TextEncoder().encode(dense).length<=1800);
 assert.throws(()=>localTranslationMessages(dense,[]),/超过本地模型容量/);
});

test('only known inline delimiters normalize; damaged markers are never saved and selection stays literal',async()=>{
 for(const spelling of ['[v10001]','｛v10001｝']){
  const source=unit([input().parts[0]]),events=[];let calls=0;
  await translateLocalPdfUnits([source],[],async()=>{calls++;return result(`占据数 ${spelling} 固定。`);},event=>events.push(event),new AbortController().signal);
  const receipt=events.find(event=>event.type==='translated').units[0];
  assert.equal(calls,1);assert.equal(receipt.parts[0].text,'占据数 {v10001} 固定。');assert.ok(translationComplete([source],[receipt]));
 }
 for(const text of ['无标记。','占据数 [v99999] 固定。','占据数 {v10001} [v10001]。','占据数 [v10001] ｛v10001｝。','占据数 {v10001} [v99999]。']){
  const events=[],calls=[];
  await assert.rejects(translateLocalPdfUnits([unit([input().parts[0]])],[],async messages=>{calls.push(sourceOf(messages));return result(calls.length===1?text:'错误 {v99999}');},event=>events.push(event),new AbortController().signal),/标记/);
  assert.deepEqual(calls,['The occupation `{v10001}` is fixed. ','The occupation ']);assert.ok(!events.some(event=>event.type==='translated'||event.type==='done'));
 }
 const literal=unit([part(0,'The notation [v10001] accompanies {v10001}.',[structuredClone(formula)])]),events=[];
 await translateLocalPdfUnits([literal],[],async()=>result('符号 [v10001] 与 {v10001}。'),event=>events.push(event),new AbortController().signal);
 assert.equal(events.find(event=>event.type==='translated').units[0].text,'符号 [v10001] 与 {v10001}。');
 let collisionCalls=0;
 await assert.rejects(translateLocalPdfUnits([literal],[],async()=>result(++collisionCalls===1?'符号 [v10001] 与 [v10001]。':'错误 {v99999}'),()=>{},new AbortController().signal),/标记/);
 assert.equal(collisionCalls,2);
 const selectionEvents=[],selectionText='读取 [v10001] 与 ｛v10002｝。';
 await translateLocalPdfUnits([{id:'1:0',page:1,text:'Read [v10001] and ｛v10002｝.'}],[],async()=>result(selectionText),event=>selectionEvents.push(event),new AbortController().signal,{scope:'selection'});
 assert.equal(selectionEvents.find(event=>event.type==='translated').units[0].text,selectionText);
});

test('inline transport quotes only source-bound markers and removes only the wrappers it introduced',async()=>{
 const source=unit([part(0,'Read `literal` and {v10001}, plus `{v10002}`.',[structuredClone(formula),{...structuredClone(formula),marker:'{v10002}'}])]);
 const before=structuredClone(source),events=[],sent=[];
 await translateLocalPdfUnits([source],[],async messages=>{sent.push(sourceOf(messages));return result('读取 `literal` 和 `[v10001]`，以及 `{v10002}`。');},event=>events.push(event),new AbortController().signal);
 assert.deepEqual(sent,['Read `literal` and `{v10001}`, plus `{v10002}`.']);
 const received=events.find(event=>event.type==='translated').units[0];
 assert.equal(received.parts[0].text,'读取 `literal` 和 {v10001}，以及 `{v10002}`。');
 assert.equal(received.parts[0].sourceHash,sourceHash);assert.deepEqual(source,before);assert.ok(translationComplete([source],[received]));
 const adjacent=unit([part(0,'Read {v10001}{v10002}.',[structuredClone(formula),{...structuredClone(formula),marker:'{v10002}'}])]),adjacentEvents=[];
 await translateLocalPdfUnits([adjacent],[],async messages=>{assert.equal(sourceOf(messages),'Read `{v10001}``{v10002}`.');return result('读取 `{v10001}``{v10002}`。');},event=>adjacentEvents.push(event),new AbortController().signal);
 assert.equal(adjacentEvents.find(event=>event.type==='translated').units[0].text,'读取 {v10001}{v10002}。');
 for(const response of ['读取 ``{v10001}``。','读取 `{v10001}。']){
  let calls=0;const rejected=[];
  await assert.rejects(translateLocalPdfUnits([unit([input().parts[0]])],[],async()=>{calls++;return result(calls===1?response:'错误 {v99999}');},event=>rejected.push(event),new AbortController().signal),/标记/);
  assert.equal(calls,2);assert.ok(!rejected.some(event=>event.type==='translated'||event.type==='done'));
 }
 const plainSource='Read `{v10001}` and [v10002].',plainTarget='读取 `{v10001}` 与 [v10002]。';
 for(const options of [{},{scope:'selection'}]){
  const events=[];
  await translateLocalPdfUnits([{id:'1:0',page:1,text:plainSource}],[],async messages=>{assert.equal(sourceOf(messages),plainSource);return result(plainTarget);},event=>events.push(event),new AbortController().signal,options);
  assert.equal(events.find(event=>event.type==='translated').units[0].text,plainTarget);
 }
 const markers=Array.from({length:175},(_,index)=>`{v${10000+index}}`),dense='Formula '+markers.join(' ');
 assert.ok(new TextEncoder().encode(JSON.stringify(localTranslationMessages(dense,[]))).length<=4096,'unwrapped prompt fits');
 let calls=0;
 await assert.rejects(translateLocalPdfUnits([unit([part(0,dense,markers.map(marker=>({...structuredClone(formula),marker})))])],[],async()=>{calls++;return result('unexpected');},()=>{},new AbortController().signal),/超过本地模型容量/);
 assert.equal(calls,0,'actual wrapped request is checked before calling the model');
});

test('local inline upgrade skips verified reused text and saves each newly translated paragraph',async()=>{
 const source=input();source.parts.unshift({...part(0,'Previous introduction. '),reuseText:'已保存的引言。'});
 source.parts.forEach((value,index)=>{value.id=`1:0:${index}`;});source.text=source.parts.map(value=>value.text).join('');
 source.parts.at(-1).reuseText='已保存的结论。';const before=structuredClone(source),calls=[],events=[];
 await translateLocalPdfUnits([source],[],async messages=>{calls.push(sourceOf(messages));return result('占据数 {v10001} 固定。');},event=>events.push(event),new AbortController().signal);
 assert.deepEqual(calls,['The occupation `{v10001}` is fixed. ']);
 const received=events.filter(event=>event.type==='translated').map(event=>event.units[0]);
 assert.deepEqual(received.map(value=>value.parts.length),[2,3]);
 assert.equal(received[0].parts.length,2,'previous receipts are immutable after later parts complete');
 assert.deepEqual(received.at(-1).parts.map(value=>value.text),['已保存的引言。','占据数 {v10001} 固定。','已保存的结论。']);
 assert.ok(received.every(value=>value.parts.every(part=>part.reuseText===undefined)));
 assert.ok(translationComplete([source],[received.at(-1)]));assert.equal(events.at(-1).type,'done');assert.deepEqual(source,before);
});

test('failed marker repair retains earlier completed paragraphs without saving any partial repair',async()=>{
 const source=input(),events=[];let calls=0;
 source.parts.reverse();source.parts.forEach((value,index)=>{value.id=`1:0:${index}`;});source.text=source.parts.map(value=>value.text).join('');
 await assert.rejects(translateLocalPdfUnits([source],[],async()=>{calls++;return result(calls===1?'已完成的结论。':calls===2?'公式标记丢失。':'未知 {v99999}');},event=>events.push(event),new AbortController().signal),/标记/);
 assert.equal(calls,3);const receipts=events.filter(event=>event.type==='translated');assert.equal(receipts.length,1);assert.equal(receipts[0].units[0].parts.length,1);
 assert.equal(translationComplete([source],[receipts[0].units[0]]),false);assert.ok(!events.some(event=>event.type==='done'));
});

test('pausing after an inline paragraph receipt prevents later calls and keeps its validated result',async()=>{
 const source=input(),events=[],controller=new AbortController();let calls=0;
 await assert.rejects(translateLocalPdfUnits([source],[],async()=>{calls++;return result('占据数 {v10001} 固定。');},event=>{events.push(event);if(event.type==='translated')controller.abort();},controller.signal),{name:'AbortError'});
 assert.equal(calls,1);assert.equal(events.filter(event=>event.type==='translated').length,1);assert.ok(!events.some(event=>event.type==='done'));
});

test('one controlled repair translates only surrounding spans and restores every source formula in order',async()=>{
 const source=unit([part(0,'Before {v10001} after {v10002}.\n',[structuredClone(formula),{...structuredClone(formula),marker:'{v10002}'}])]);
 const before=structuredClone(source),calls=[],events=[];
 await translateLocalPdfUnits([source],[],async messages=>{calls.push(sourceOf(messages));return result(['漏掉公式。','之前','之后'][calls.length-1]);},event=>events.push(event),new AbortController().signal);
 assert.deepEqual(calls,['Before `{v10001}` after `{v10002}`.\n','Before ',' after ']);
 const receipt=events.find(event=>event.type==='translated').units[0];
 assert.equal(receipt.text,'之前 {v10001} 之后 {v10002}.\n');assert.ok(translationComplete([source],[receipt]));assert.deepEqual(source,before);
 assert.equal(events.filter(event=>event.type==='progress'&&event.message.includes('周围文字')).length,1);
 assert.equal(events.at(-1).type,'done');
});

test('repair cancellation, failed spans and non-integrity failures cannot save a partial paragraph or trigger another repair',async()=>{
 const source=unit([input().parts[0]]);
 for(const cancel of [false,true]){
  const controller=new AbortController(),events=[],calls=[];
  await assert.rejects(translateLocalPdfUnits([source],[],async messages=>{
   calls.push(sourceOf(messages));if(calls.length===1)return result('漏掉公式。');
   if(calls.length===2){if(cancel)controller.abort();return result('占据数');}
   return result('错误 {v99999}');
  },event=>events.push(event),controller.signal),cancel?{name:'AbortError'}:/标记/);
  assert.equal(calls.length,cancel?2:3);assert.ok(!events.some(event=>event.type==='translated'||event.type==='done'));
 }
 for(const unknown of ['[v99999]','｛v99999｝']){
  let calls=0;const events=[];
  await assert.rejects(translateLocalPdfUnits([source],[],async()=>result(++calls===1?'漏掉公式。':`错误 ${unknown}`),event=>events.push(event),new AbortController().signal),/标记/);
  assert.equal(calls,2);assert.ok(!events.some(event=>event.type==='translated'||event.type==='done'));
 }
 for(const outcome of [new Error('Network failure'),new Error('Timeout'),new DOMException('Stopped','AbortError'),{message:{role:'assistant',content:'不完整'},reason:'length'},result('将以下文本完整翻译为简体中文 [v99999]')]){
  let calls=0;const events=[];
  await assert.rejects(translateLocalPdfUnits([source],[],async()=>{calls++;if(outcome instanceof Error)throw outcome;return outcome;},event=>events.push(event),new AbortController().signal));
  assert.equal(calls,1);assert.ok(!events.some(event=>event.type==='translated'||event.type==='done'||event.type==='progress'&&event.message.includes('周围文字')));
 }
 let selectionCalls=0;
 await assert.rejects(translateLocalPdfUnits([{id:'1:0',page:1,text:'The value {v10001}.'}],[],async()=>{selectionCalls++;return result('漏掉公式。');},()=>{},new AbortController().signal,{scope:'selection'}),/标记/);
 assert.equal(selectionCalls,1);
});

test('service repair shares one AI task and finishes it once after all surrounding-text calls',async()=>{
 const require=createRequire(import.meta.url),compiledModule={exports:{}},config={baseUrl:'http://127.0.0.1:43275/v1',token:'isolated-inline-runner-test-token-12345',model:'hy-mt2-1.8b'};
 let tasks=0,finishes=0;const calls=[],registry=createTranslationRegistry(),owners=[];
 const code=ts.transpileModule(readFileSync(new URL('../lib/pdf-translation-service.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports:compiledModule.exports,require:name=>name==='./ai-runtime.ts'?{...aiRuntime,createAiTask:async(...args)=>{tasks++;const task=await aiRuntime.createAiTask(...args);return {...task,finish:async()=>{finishes++;await task.finish();}};}}:require(new URL('../lib/'+name,import.meta.url).pathname),URL,AbortController,AbortSignal,DOMException,ReadableStream,Response,TextEncoder,setInterval,clearInterval,crypto:globalThis.crypto});
 const service=compiledModule.exports.createPdfTranslationService(()=>({model:'deepseek-flash'}),async(url,options)=>{
  assert.equal(url,config.baseUrl+'/chat/completions');assert.equal(registry.jobs.size,1);owners.push([...registry.jobs.values()][0]);calls.push(sourceOf(JSON.parse(options.body).messages));
  const content=['漏掉公式。','占据数','保持固定。'][calls.length-1];
  return new Response(`data: ${JSON.stringify({choices:[{delta:{content},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
 },registry,()=>config);
 const response=await service(new Request('http://localhost:3001/api/translate',{method:'POST',body:JSON.stringify({engine:'local',units:[unit([input().parts[0]])]})}));
 assert.equal(response.status,200);const events=(await response.text()).split('\n\n').filter(value=>value.startsWith('data: ')).map(value=>JSON.parse(value.slice(6)));
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(tasks,1);assert.equal(finishes,1);assert.equal(registry.jobs.size,0);assert.equal(new Set(owners).size,1);
 assert.deepEqual(calls,['The occupation `{v10001}` is fixed. ','The occupation ',' is fixed. ']);assert.equal(events.filter(event=>event.type==='start').length,1);assert.equal(events.at(-1).type,'done');
 assert.equal(events.find(event=>event.type==='translated').units[0].text,'占据数 {v10001} 保持固定。 ');
});

test('completion refuses stale versions, source signatures, altered crops and missing or duplicate markers',()=>{
 const source=input(),output=translated(source);assert.equal(translationComplete([source],[output]),true);
 assert.equal(translationComplete([source],[output,output]),false);
 for(const mutate of [value=>{delete value.inlineMathVersion;},value=>{value.parts[0].sourceHash='b'.repeat(64);},value=>{value.parts[0].inlineFormulas[0].baseline=31;},value=>{value.parts[0].text='丢失';},value=>{value.parts[0].text+='{v10001}';},value=>{value.parts[0].reuseText='旧';},value=>{value.parts.push(value.parts[0]);}]){
  const bad=structuredClone(output);mutate(bad);assert.equal(translationComplete([source],[bad]),false);
 }
 const fromJson=translationResult(JSON.stringify({sourceLanguage:'英语',units:[{id:source.id,parts:output.parts.map(({id,text})=>({id,text}))}]}),[source]).units;
 assert.ok(translationComplete([source],fromJson));assert.deepEqual(fromJson[0].parts[0].inlineFormulas,source.parts[0].inlineFormulas);
 assert.throws(()=>validateInlineTranslationPart(source.parts[0],'占据数 {v10002} 固定。'));
});

test('inline API remains one local task with no cloud key, rejects cloud and selection upgrades, and cleans ownership',async()=>{
 const config={baseUrl:'http://127.0.0.1:43275/v1',token:'isolated-inline-runner-test-token-12345',model:'hy-mt2-1.8b'};
 const registry=createTranslationRegistry(),calls=[];
 const reply=content=>new Response(`data: ${JSON.stringify({choices:[{delta:{content},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
 const service=createPdfTranslationService(()=>({model:'deepseek-flash'}),async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return reply('占据数 {v10001} 固定。');},registry,()=>config);
 const request=body=>new Request('http://localhost:3001/api/translate',{method:'POST',body:JSON.stringify(body)});
 const source=input();source.parts[1].reuseText='已保存结论。';
 const response=await service(request({engine:'local',units:[source]}));assert.equal(response.status,200);
 const events=(await response.text()).split('\n\n').filter(value=>value.startsWith('data: ')).map(value=>JSON.parse(value.slice(6)));
 assert.equal(events.at(-1).type,'done');assert.equal(calls.length,1);assert.equal(calls[0].url,config.baseUrl+'/chat/completions');assert.equal(registry.jobs.size,0);
 assert.ok(!JSON.stringify(events).includes(config.token));assert.ok(translationComplete([source],events.filter(value=>value.type==='translated').at(-1).units));
 for(const body of [{engine:'cloud',units:[source]},{engine:'local',scope:'selection',units:[source]},{engine:'local',units:[{...source,protected:true}]}])assert.equal((await service(request(body))).status,400);
 for(const extra of [{inlineMathVersion:1},{sourceHash},{reuseText:'不应调用'},{inlineFormulas:[formula]}])assert.equal((await service(request({engine:'local',scope:'selection',units:[{id:'1:0',page:1,text:'Actual selection.',...extra}]}))).status,400);
 assert.equal(calls.length,1);
});
