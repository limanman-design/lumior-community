import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { normalizeCustomAiUrl, validateCustomAiConfig } from '../lib/custom-ai-config.ts';
import { publicAiAddress, secureCustomAiFetch } from '../lib/custom-ai-transport.ts';
import { isProviderModel, aiSettingsFromEnv } from '../lib/ai-providers.ts';
import { createAiTask, resolveAiAccess } from '../lib/ai-runtime.ts';
import { createAiModelCatalog } from '../lib/ai-model-catalog.ts';
import { dailyDeleteShortcut } from '../app/daily-input.ts';
import { createPdfTranslationService } from '../lib/pdf-translation-service.ts';
import { sseData } from '../lib/ai-stream.ts';
const require = createRequire(import.meta.url);
const desktop = require('../desktop/runtime/custom-ai-config.cjs');
const { createCredentialStore } = require('../desktop/runtime/credentials.cjs');
const { applyBackendAiSettings } = require('../desktop/runtime/ai-settings.cjs');
const config = { name: 'Aizex', baseUrl: 'https://ca.memofun.net/v1', protocol: 'responses' };
const chatConfig = { name: 'SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1', protocol: 'chat-completions' };
const sse = value => `data: ${JSON.stringify(value)}\n\n`;
const message = text => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
const response = output => new Response(sse({ type: 'response.completed', response: { status: 'completed', output } }), { headers: { 'Content-Type': 'text/event-stream' } });
const chat = delta => new Response(sse({ choices: [{ delta, finish_reason: delta.tool_calls ? 'tool_calls' : 'stop' }] }) + 'data: [DONE]\n\n');
const settings = custom => ({ provider: 'custom', usageMode: 'personal', model: 'vendor/model-name', key: 'synthetic-custom-secret', custom });
const tools = [{ type: 'function', function: { name: 'read_card', description: 'Read', parameters: { type: 'object', properties: {} } } }];

test('renderer and desktop reject unsafe addresses and accept only clean public HTTPS base URLs', () => {
  for (const url of ['http://ca.memofun.net/v1', 'https://127.0.0.1/v1', 'https://2130706433/v1', 'https://[::1]/v1', 'https://localhost/v1', 'https://relay.local/v1', 'https://user:secret@ca.memofun.net/v1', 'https://ca.memofun.net/v1?key=secret', 'https://ca.memofun.net/v1#secret', 'https://ca.memofun.net:8443/v1', 'https://ca.memofun.net/v1/responses', 'https://ca.memofun.net/v1/chat/completions', 'https://ca.memofun.net/%2e%2e/v1', 'https://ca.memofun.net/../v1', 'https://ca.memofun.net\\@evil.com/v1']) {
    assert.throws(() => normalizeCustomAiUrl(url), undefined, url); assert.throws(() => desktop.normalizeCustomAiUrl(url), undefined, url);
  }
  for (const item of [config, chatConfig, { ...config, baseUrl: config.baseUrl+'/' }]) assert.deepEqual(validateCustomAiConfig(item), desktop.validateCustomAiConfig(item));
  assert.equal(isProviderModel('custom', 'Pro/zai-org/GLM-5.1'), true);
  for (const model of ['a\nAuthorization', 'https://evil.com/model', '../model', 'a:b', 'a//b']) assert.equal(isProviderModel('custom', model), false);
});

test('DNS guard rejects private, link-local, mapped, transition and reserved addresses', () => {
  for (const ip of ['127.0.0.1','10.1.2.3','100.64.0.1','169.254.169.254','172.16.0.1','192.168.1.1','0.0.0.0','224.0.0.1','198.18.0.1','192.0.2.1','203.0.113.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','64:ff9b::7f00:1','2002:7f00::1','2001:0::1','2001:db8::1','3fff::1']) assert.equal(publicAiAddress(ip), false, ip);
  for (const ip of ['1.1.1.1','8.8.8.8','2606:4700:4700::1111','2001:4860:4860::8888']) assert.equal(publicAiAddress(ip), true, ip);
});

test('custom transport validates before any network connection and observes cancellation', async () => {
  await assert.rejects(secureCustomAiFetch('http://127.0.0.1/v1/responses', { method: 'POST', body: 'fixture' }), /HTTPS/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(secureCustomAiFetch(config.baseUrl+'/responses', { signal: controller.signal }), { name: 'AbortError' });
});

test('transport pins the checked DNS answer, rejects mixed private DNS and never follows redirects', async () => {
  const https = require('node:https'), dns = require('node:dns/promises');
  const originalRequest = https.request, originalLookup = dns.lookup;
  let addresses = [{address:'1.1.1.1',family:4}], status = 200, resolutions = 0, connections = 0;
  try {
    dns.lookup = async hostname => { assert.equal(hostname,'ca.memofun.net'); resolutions++; return addresses; };
    https.request = (url, options, callback) => {
      assert.equal(url.origin, 'https://ca.memofun.net'); assert.equal(options.rejectUnauthorized,true); assert.equal(options.agent,false);
      const req = new EventEmitter();
      req.end = () => options.lookup(url.hostname, {all:true}, (error, checked) => {
        if(error) { req.emit('error',error); return; }
        assert.deepEqual(checked,addresses); connections++;
        const res = Readable.from([Buffer.from('fixture')]); res.statusCode = status;
        res.headers = status === 302 ? {location:'https://other.invalid/steal-key'} : {};
        callback(res);
      });
      return req;
    };
    syncBuiltinESMExports();
    assert.equal(await (await secureCustomAiFetch(config.baseUrl+'/models')).text(),'fixture');
    assert.equal(resolutions,1); assert.equal(connections,1);
    addresses = [...addresses,{address:'127.0.0.1',family:4}];
    await assert.rejects(secureCustomAiFetch(config.baseUrl+'/models'),/connection failed/);
    assert.equal(connections,1);
    addresses = [{address:'1.1.1.1',family:4}]; status=302;
    await assert.rejects(secureCustomAiFetch(config.baseUrl+'/models'),/redirects/);
    assert.equal(connections,2); assert.equal(resolutions,3);
  } finally { https.request=originalRequest; dns.lookup=originalLookup; syncBuiltinESMExports(); }
});

test('encrypted custom key never returns to the renderer, migrations retain old credentials, and a destination change requires a new key', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lumior-custom-'));
  const encryption = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from('cipher:'+value), decryptString: value => value.toString().slice(7) };
  try {
    const store = createCredentialStore(dir, encryption);
    await store.save({ provider: 'deepseek', model: 'deepseek-flash', apiKey: 'old-key' });
    // Reproduce v2 files written before the custom slot existed.
    const filename = path.join(dir, 'ai-settings.json'), old = JSON.parse(await readFile(filename, 'utf8')); delete old.providers.custom;
    await writeFile(filename, JSON.stringify(old));
    await store.save({ provider:'custom', model:'gpt-6.1-sol', apiKey:'custom-secret', custom:config });
    assert.ok(!(await readFile(filename,'utf8')).includes('custom-secret'));
    assert.ok(!JSON.stringify(await store.get()).includes('custom-secret'));
    assert.equal((await store.config()).providers.deepseek.key, 'old-key');
    await assert.rejects(store.save({provider:'custom',model:'vendor/model',custom:chatConfig}), /new key/);
    assert.deepEqual((await store.get()).providers.custom.custom, config);
    await store.save({provider:'custom',model:'vendor/model',apiKey:'new-secret',custom:chatConfig});
    const env = {}; applyBackendAiSettings(env, await store.config());
    const runtime = aiSettingsFromEnv(env); assert.deepEqual(runtime.providers.custom.custom, chatConfig); assert.equal(runtime.providers.custom.key,'new-secret');
    const before = { ...env }; assert.throws(()=>applyBackendAiSettings(env,{...awaitConfig(runtime),providers:{custom:{key:'bad',model:'x',custom:{...config,baseUrl:'https://localhost'}}}})); assert.deepEqual(env,before);
    await store.save({provider:'custom',model:'vendor/model',apiKey:''}); assert.equal((await store.get()).providers.custom.configured,false);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
function awaitConfig(runtime) { return { provider:runtime.provider,providers:runtime.providers,usageMode:'personal' }; }

for (const protocol of ['responses', 'chat-completions']) test(`${protocol}: one unified task retains tool IDs and results across calls without replay or provider fallback`, async () => {
  const custom = protocol === 'responses' ? config : chatConfig, sent=[];
  const mock = async (url, init) => {
    sent.push({url,init,body:JSON.parse(init.body)});
    assert.equal(init.redirect,'error'); assert.equal(init.headers.Authorization,'Bearer synthetic-custom-secret');
    if (sent.length === 1) return protocol === 'responses'
      ? response([{type:'function_call',call_id:'call-1',name:'read_card',arguments:'{}'}])
      : chat({tool_calls:[{index:0,id:'call-1',type:'function',function:{name:'read_card',arguments:'{}'}}]});
    return protocol === 'responses' ? response([message('Answer from evidence')]) : chat({content:'Answer from evidence'});
  };
  const access = await resolveAiAccess(settings(custom)); const task = await createAiTask(access,new AbortController().signal,mock);
  try {
    const history=[{role:'user',content:'Read the card'}]; const first=await task.call(history,tools,'auto');
    const second=await task.call([...history,first.message,{role:'tool',tool_call_id:'call-1',content:'Evidence'}],tools);
    assert.equal(second.message.content,'Answer from evidence'); assert.equal(sent.length,2);
    assert.equal(sent[0].url, custom.baseUrl+(protocol==='responses'?'/responses':'/chat/completions'));
    assert.equal(sent[0].body.stream,true);
    if(protocol==='responses') assert.ok(sent[1].body.input.some(item=>item.type==='function_call_output'&&item.call_id==='call-1'&&item.output==='Evidence'));
    else assert.ok(sent[1].body.messages.some(item=>item.role==='tool'&&item.tool_call_id==='call-1'));
  } finally { await task.finish(); }
});

test('Responses truncation and private diagnostics fail safely; abort propagates without retry', async () => {
  const access=await resolveAiAccess(settings(config));
  for (const raw of [sse({type:'response.output_text.delta',delta:'partial'}),sse({type:'error',message:'synthetic-custom-secret'}),'private-response-diagnostic']) {
    let count=0;
    const task=await createAiTask(access,new AbortController().signal,async()=>{count++;return new Response(raw,{headers:{'Content-Type':'text/event-stream'}});});
    await assert.rejects(task.call([{role:'user',content:'hello'}]), error=>!String(error).includes('secret')&&!String(error).includes('private-response'));
    await task.finish();assert.equal(count,1);
  }
  const controller=new AbortController(); let count=0;
  const task=await createAiTask(access,controller.signal,async(_url,init)=>{count++;controller.abort();init.signal.throwIfAborted();});
  await assert.rejects(task.call([{role:'user',content:'hi'}]),{name:'AbortError'});await task.finish();assert.equal(count,1);
});

test('model catalog separates destination caches and supports namespaced IDs without leaking keys',async()=>{
  const calls=[]; const catalog=createAiModelCatalog(async(url,init)=>{calls.push(url);assert.equal(init.redirect,'error');return Response.json({data:[{id:'org/model'}]});});
  const first=await catalog.get('custom','fixture','org/model',{custom:config}); assert.equal(first.models[0].id,'custom:org/model');
  await catalog.get('custom','fixture','org/model',{custom:config}); assert.equal(calls.length,1);
  await catalog.get('custom','fixture','org/model',{custom:chatConfig}); assert.equal(calls.length,2);assert.ok(!JSON.stringify(first).includes('fixture'));
});

test('daily delete only handles bare keys outside text editing and IME composition',()=>{
  for(const key of ['Delete','Backspace']) { assert.equal(dailyDeleteShortcut({key},false),true);assert.equal(dailyDeleteShortcut({key},true),false);
    for(const modifier of ['isComposing','metaKey','ctrlKey','altKey','shiftKey','repeat','defaultPrevented']) assert.equal(dailyDeleteShortcut({key,[modifier]:true},false),false);
    assert.equal(dailyDeleteShortcut({key,keyCode:229},false),false);
  }
  assert.equal(dailyDeleteShortcut({key:'Enter'},false),false);
});

for(const custom of [config,chatConfig]) test(`${custom.protocol}: PDF translation uses the same custom configuration and releases its job`,async()=>{
  const units=[{id:'1:0',page:1,text:'Research improves understanding.'}]; let calls=0;
  const service=createPdfTranslationService(()=>settings(custom),async(url,init)=>{
    calls++;assert.ok(url.startsWith(custom.baseUrl+'/'));assert.equal(init.headers.Authorization,'Bearer synthetic-custom-secret');
    const text=JSON.stringify({sourceLanguage:'英语',units:[{id:'1:0',text:'研究增进理解。'}],glossary:[]});
    return custom.protocol==='responses'?response([message(text)]):chat({content:text});
  });
  const res=await service(new Request('http://localhost:3001/api/translate',{method:'POST',body:JSON.stringify({units})}));
  assert.equal(res.status,200);const output=await res.text();assert.ok(output.includes('研究增进理解。'));assert.ok(!output.includes('"type":"error"'));assert.equal(calls,1);
});

test('failed trial credentials never fall back to an available custom key',async()=>{
  let calls=0;
  await assert.rejects(resolveAiAccess({...settings(config),usageMode:'trial',trial:{token:'a'.repeat(43),gatewayUrl:'https://api.lumior.work'}},undefined,async(url,init)=>{
    calls++; assert.equal(new URL(url).origin,'https://api.lumior.work'); assert.equal(init.headers.Authorization,'Bearer '+'a'.repeat(43));
    return Response.json({error:'revoked'},{status:403});
  }));assert.equal(calls,1);
});

test('failed HTTP responses cancel their body without reading private diagnostics',async()=>{
  for(const custom of [config,chatConfig]) {
    let cancelled=false;
    const body=new ReadableStream({cancel(){cancelled=true;}});
    const access=await resolveAiAccess(settings(custom));
    const task=await createAiTask(access,new AbortController().signal,async()=>new Response(body,{status:401}));
    try { await assert.rejects(task.call([{role:'user',content:'hi'}]));assert.equal(cancelled,true); }
    finally { await task.finish(); }
  }
});

test('unterminated SSE events cannot grow indefinitely across small data lines',async()=>{
  let reads=0,cancelled=false;
  const chunk=new TextEncoder().encode('data: '+'x'.repeat(6000)+'\n');
  const body=new ReadableStream({pull(controller){reads++;controller.enqueue(chunk);},cancel(){cancelled=true;}});
  await assert.rejects(async()=>{for await(const ignored of sseData(body)) void ignored;},/格式异常/);
  assert.ok(reads<180);assert.equal(cancelled,true);
});
