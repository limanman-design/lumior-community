import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { aiProviders, aiSettingsFromEnv, isProviderModel, isResearchModel, parseModelSelection, qualifiedModelId } from '../lib/ai-providers.ts';
import { providerResearchCall } from '../lib/ai-provider.ts';
import { modelRequestTimeoutMs } from '../lib/ai-request-limits.ts';
import { createAiService } from '../lib/ai-service.ts';
import { readAiStream, sseData } from '../lib/ai-stream.ts';
import { createPdfTranslationService } from '../lib/pdf-translation-service.ts';

const require = createRequire(import.meta.url);
const desktopValidation = require('../desktop/runtime/ai-settings.cjs');
const event = value => `data: ${JSON.stringify(value)}\n\n`;
const completion = (text = 'Answer [Lumior:1]', reasoning = 'private reasoning') => new Response(event({ choices: [{ delta: { content: text, reasoning_content: reasoning }, finish_reason: 'stop' }] }) + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
const openaiCompletion = (output, status = 'completed') => Response.json({ status, output });
const outputText = (text, id = 'message-1') => ({ id, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] });
const messages = [{ role: 'system', content: 'Use evidence.' }, { role: 'user', content: 'Question' }];
const functionTool = { type: 'function', function: { name: 'read_document', description: 'Read source', parameters: { type: 'object', properties: { card_id: { type: 'string' } }, required: ['card_id'] } } };
const plan = JSON.stringify({ task: 'summary', card_ids: [], queries: ['Evidence'], requirements: ['Answer the question'] });
const request = body => new Request('http://localhost:3001/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'Test question', sources: [{ cardId: 'card', title: 'Reference', text: 'Evidence' }], ...body }) });
const allSettings = () => ({ provider: 'deepseek', model: 'deepseek-flash', key: 'private-deepseek-key', providers: Object.fromEntries(aiProviders.map(provider => [provider.id, { key: `private-${provider.id}-key`, model: provider.defaultModel }])) });
function researchResponse(payload) {
  if (payload.tools?.[0]?.function?.name === 'plan_research') return new Response(event({ choices: [{ delta: { reasoning_content: 'private research reasoning', tool_calls: [{ index: 0, id: 'plan-call', type: 'function', function: { name: 'plan_research', arguments: plan } }] }, finish_reason: 'tool_calls' }] }), { headers: { 'Content-Type': 'text/event-stream' } });
  return completion();
}

void test('renderer and desktop validators preserve old DeepSeek selections and reject endpoint or provider injection', () => {
  const candidates = ['deepseek-flash', 'deepseek-', 'glm-4.7', 'glm-', 'kimi-k2.6', 'moonshot-v1-8k', 'kimi-', 'gpt-4.1-mini', 'gpt-', 'o3', 'o3-mini', 'o0', 'https://evil.example/gpt-4.1', 'gpt-4.1\nAuthorization', 'gpt-' + 'x'.repeat(130)];
  for (const { id } of aiProviders) for (const model of candidates) assert.equal(isProviderModel(id, model), desktopValidation.isProviderModel(id, model), `${id}: ${JSON.stringify(model)}`);
  assert.equal(qualifiedModelId('deepseek', 'deepseek-flash'), 'deepseek-flash');
  assert.deepEqual(parseModelSelection('deepseek-flash', 'kimi'), { provider: 'deepseek', model: 'deepseek-flash' });
  assert.deepEqual(parseModelSelection('kimi:kimi-k2.6', 'deepseek'), { provider: 'kimi', model: 'kimi-k2.6' });
  for (const model of ['unknown:gpt-4.1', 'https://evil.example:gpt-4.1', 'openai:https://evil.example', 'kimi:glm-4.7', 'openai:gpt-4.1:extra', 'glm:glm-']) assert.equal(parseModelSelection(model, 'deepseek'), null, model);
  for (const model of ['gpt-4o-audio-preview', 'gpt-4.1-search', 'gpt-5-codex', 'o1-mini', 'o1-mini-2024-09-12', 'o1-preview', 'o1-preview-2024-09-12']) assert.equal(isResearchModel('openai', model), false, model);
  for (const model of ['glm-4.5v', 'glm-4.5v-flash', 'glm-4.6v', 'glm-4.6v-flash']) assert.equal(isResearchModel('glm', model), false, model);
  for (const model of ['moonshot-v1-8k', 'moonshot-v1-8k-vision-preview', 'moonshot-v1-32k']) assert.equal(isResearchModel('kimi', model), false, model);
});

void test('environment defaults and legacy Moonshot alias select only the configured provider key', () => {
  const settings = aiSettingsFromEnv({ LUMIOR_AI_PROVIDER: 'kimi', MOONSHOT_API_KEY: ' legacy-kimi-secret ', DEEPSEEK_API_KEY: 'other-secret', GLM_MODEL: 'glm-5.2', LUMIOR_DESKTOP: '1' });
  assert.equal(settings.provider, 'kimi'); assert.equal(settings.key, 'legacy-kimi-secret'); assert.equal(settings.model, 'kimi-k2.6');
  assert.equal(settings.providers.deepseek.key, 'other-secret'); assert.equal(settings.providers.glm.model, 'glm-5.2');
  assert.match(settings.missingKeyMessage, /所选服务/);
  assert.equal(aiSettingsFromEnv({ LUMIOR_AI_PROVIDER: 'https://evil.example' }).provider, 'deepseek');
});

void test('GLM and Kimi send the correct credentials to fixed official hosts without unsupported effort controls', async () => {
  const cases = [
    { provider: 'glm', model: 'glm-4.7', url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', thinking: true, toolStream: true },
    { provider: 'glm', model: 'glm-4.5', url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', thinking: true, toolStream: false },
    { provider: 'glm', model: 'glm-4', url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', thinking: false, toolStream: false },
    { provider: 'kimi', model: 'kimi-k2.6', url: 'https://api.moonshot.cn/v1/chat/completions', thinking: false, toolStream: false },
    { provider: 'kimi', model: 'moonshot-v1-8k', url: 'https://api.moonshot.cn/v1/chat/completions', thinking: false, toolStream: false },
  ];
  for (const item of cases) {
    const captures = [];
    const call = providerResearchCall(item.provider, `secret-${item.provider}`, item.model, new AbortController().signal, async (url, options) => { captures.push({ url, options, payload: JSON.parse(options.body) }); return completion('Complete answer'); }, 'max');
    const result = await call([{ ...messages[0], responseItems: [{ encrypted_content: 'do-not-forward' }] }, messages[1]], [functionTool], 'auto');
    const { url, options, payload } = captures[0];
    assert.equal(url, item.url); assert.equal(options.headers.Authorization, `Bearer secret-${item.provider}`);
    assert.equal(payload.model, item.model); assert.equal(payload.stream, true); assert.equal(payload.reasoning_effort, undefined); assert.equal(payload.temperature, undefined);
    assert.equal(payload.thinking?.type, item.thinking ? 'enabled' : undefined); assert.equal(payload.tool_stream, item.toolStream ? true : undefined);
    assert.equal(payload.tool_choice, 'auto'); assert.deepEqual(payload.tools, [functionTool]); assert.equal(payload.messages[0].responseItems, undefined);
    assert.equal(result.reason, 'stop'); assert.equal(result.message.content, 'Complete answer');
  }
});

void test('reasoning effort applies to supported GLM models and tool streaming requires actual tools', async () => {
  const payloads = [];
  const fetcher = async (_url, options) => { payloads.push(JSON.parse(options.body)); return completion(); };
  await providerResearchCall('glm', 'glm-secret', 'glm-5.2', new AbortController().signal, fetcher, 'low')(messages, [functionTool]);
  await providerResearchCall('glm', 'glm-secret', 'glm-5.2', new AbortController().signal, fetcher, 'max')(messages);
  assert.equal(payloads[0].reasoning_effort, 'low'); assert.equal(payloads[0].tool_stream, true);
  assert.equal(payloads[1].reasoning_effort, 'max'); assert.equal(payloads[1].tool_stream, undefined);
});

void test('Kimi K3 sends supported effort while K2.7 Code omits it and neither receives a thinking override', async () => {
  for (const [model, effort] of [['kimi-k3', 'max'], ['kimi-k3.1-pro', 'max'], ['kimi-k3.1-pro-highspeed', 'max'], ['kimi-k2.7-code', undefined]]) {
    let payload;
    const call = providerResearchCall('kimi', 'kimi-secret', model, new AbortController().signal, async (url, options) => {
      assert.equal(url, 'https://api.moonshot.cn/v1/chat/completions');
      payload = JSON.parse(options.body); return completion();
    }, 'max');
    await call(messages, [functionTool], 'auto');
    assert.equal(Object.hasOwn(payload, 'thinking'), false, model);
    assert.equal(payload.reasoning_effort, effort, model);
    assert.equal(Object.hasOwn(payload, 'reasoning_effort'), effort !== undefined, model);
    if (model.startsWith('kimi-k3')) { assert.equal(payload.max_completion_tokens, 32768); assert.equal(Object.hasOwn(payload, 'max_tokens'), false); }
    assert.equal(payload.tool_choice, 'auto');
  }
});

void test('only Kimi K3 receives a ten-minute individual call deadline', () => {
  for (const model of ['kimi-k3', 'kimi-k3-preview', 'kimi-k3.1']) assert.equal(modelRequestTimeoutMs('kimi', model), 600_000);
  for (const [provider, model] of [['kimi', 'kimi-k2.6'], ['kimi', 'kimi-k30'], ['deepseek', 'deepseek-flash'], ['glm', 'glm-5.2'], ['openai', 'gpt-4.1-mini']]) assert.equal(modelRequestTimeoutMs(provider, model), 180_000);
});

void test('Kimi K3 can finish after three minutes of streamed reasoning and disposes its deadline on success', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let upstream, requestSignal;
  const body = new ReadableStream({ start(controller) { upstream = controller; controller.enqueue(new TextEncoder().encode(event({ choices: [{ delta: { reasoning_content: 'private ongoing reasoning' }, finish_reason: null }] }))); } });
  const call = providerResearchCall('kimi', 'dummy-key', 'kimi-k3', new AbortController().signal, async (_url, options) => { requestSignal = options.signal; return new Response(body); }, 'high');
  const pending = call(messages);
  await Promise.resolve(); await Promise.resolve();
  t.mock.timers.tick(180_001);
  assert.equal(requestSignal.aborted, false);
  upstream.enqueue(new TextEncoder().encode(event({ choices: [{ delta: { content: 'Verified final answer' }, finish_reason: 'stop' }] }) + 'data: [DONE]\n\n'));
  upstream.close();
  const result = await pending;
  assert.equal(result.message.content, 'Verified final answer');
  assert.equal(result.message.reasoning_content, 'private ongoing reasoning');
  t.mock.timers.tick(600_000);
  assert.equal(requestSignal.aborted, false, 'successful calls leave no live deadline');
});

void test('the same K3 deadline cancels a stalled response reader even when the fetch stub ignores abort', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let requestSignal, cancelled = 0;
  const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(event({ choices: [{ delta: { reasoning_content: 'private unfinished reasoning' }, finish_reason: null }] }))); }, cancel() { cancelled++; } });
  const call = providerResearchCall('kimi', 'dummy-key', 'kimi-k3', new AbortController().signal, async (_url, options) => { requestSignal = options.signal; return new Response(body); });
  const pending = call(messages);
  const rejected = assert.rejects(pending, { message: 'Kimi K3 本次响应超过 10 分钟，尚未完成；请拆分问题或缩小资料范围后重试。' });
  await Promise.resolve(); await Promise.resolve();
  t.mock.timers.tick(599_999);
  assert.equal(requestSignal.aborted, false);
  t.mock.timers.tick(1);
  await rejected;
  assert.equal(requestSignal.aborted, true);
  assert.equal(cancelled, 1);
});

void test('other providers retain three-minute connection limits with a clear timeout notice', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const [provider, model] of [['kimi', 'kimi-k2.6'], ['deepseek', 'deepseek-flash'], ['glm', 'glm-5.2'], ['openai', 'gpt-4.1-mini']]) {
    let requestSignal;
    const call = providerResearchCall(provider, 'dummy-key', model, new AbortController().signal, async (_url, options) => new Promise((_resolve, reject) => { requestSignal = options.signal; options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }); }));
    const pending = call(messages), rejected = assert.rejects(pending, /模型本次响应超过 3 分钟/);
    t.mock.timers.tick(179_999);
    assert.equal(requestSignal.aborted, false, provider);
    t.mock.timers.tick(1);
    await rejected;
    assert.equal(requestSignal.aborted, true, provider);
  }
});

void test('user cancellation during streamed reasoning remains cancellation rather than a timeout', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const parent = new AbortController(), stopped = new DOMException('User stopped this request', 'AbortError');
  let requestSignal, cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  const call = providerResearchCall('kimi', 'dummy-key', 'kimi-k3', parent.signal, async (_url, options) => { requestSignal = options.signal; return new Response(body); });
  const pending = call(messages), rejected = assert.rejects(pending, error => error === stopped);
  await Promise.resolve(); await Promise.resolve();
  parent.abort(stopped);
  await rejected;
  assert.equal(cancelled, true);
  assert.equal(requestSignal.reason, stopped);
  t.mock.timers.tick(600_000);
  assert.equal(requestSignal.reason, stopped);
});

void test('empty or reasoning-only stopped responses are rejected and failed calls release their timers', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const response of [completion('', 'private reasoning only'), completion('  ', ''), new Response('data: invalid JSON\n\n'), new Response('', { status: 401 })]) {
    let requestSignal;
    const call = providerResearchCall('kimi', 'dummy-key', 'kimi-k3', new AbortController().signal, async (_url, options) => { requestSignal = options.signal; return response; });
    await assert.rejects(call(messages));
    t.mock.timers.tick(600_000);
    assert.equal(requestSignal.aborted, false, 'rejected calls leave no live deadline');
  }
  const call = providerResearchCall('kimi', 'dummy-key', 'kimi-k3', new AbortController().signal, async () => completion('', 'private reasoning only'));
  await assert.rejects(call(messages), /模型没有返回正文或工具请求/);
});

void test('a pre-cancelled request never connects to a provider', async () => {
  const parent = new AbortController(), stopped = new DOMException('Stopped before connection', 'AbortError');
  parent.abort(stopped);
  let called = false;
  const call = providerResearchCall('kimi', 'dummy-key', 'kimi-k3', parent.signal, async () => { called = true; return completion(); });
  await assert.rejects(call(messages), error => error === stopped);
  assert.equal(called, false);
});

void test('selectable models use compatible output limits instead of an unsupported universal 32K request', async () => {
  const cases = [
    ['openai', 'gpt-4o-mini', 16384],
    ['openai', 'gpt-4o', 16384],
    ['openai', 'gpt-4o-2024-05-13', 4096],
    ['openai', 'gpt-5-chat-latest', 16384],
    ['openai', 'gpt-4.1-mini', 32768],
    ['kimi', 'moonshot-v1-128k', 4096],
    ['kimi', 'kimi-k2.6', 32768],
    ['kimi', 'kimi-k3', 32768],
    ['glm', 'glm-4-flash', 4096],
    ['glm', 'glm-4.7', 32768],
    ['deepseek', 'deepseek-flash', 32768],
  ];
  for (const [provider, model, expected] of cases) {
    let payload;
    const call = providerResearchCall(provider, 'test-secret', model, new AbortController().signal, async (_url, options) => {
      payload = JSON.parse(options.body);
      return provider === 'openai' ? openaiCompletion([outputText('Complete answer')]) : completion('Complete answer');
    });
    assert.equal(isResearchModel(provider, model), true, `${provider}:${model} should remain selectable`);
    const result = await call(messages);
    const outputField = provider === 'openai' ? 'max_output_tokens' : model === 'kimi-k3' ? 'max_completion_tokens' : 'max_tokens';
    assert.equal(payload[outputField], expected, `${provider}:${model}`);
    assert.equal(result.reason, 'stop');
  }
});

void test('streamed tool fragments retain call IDs and internal reasoning for the next GLM or Kimi tool round', async () => {
  for (const provider of ['glm', 'kimi']) {
    const payloads = [];
    const first = event({ choices: [{ delta: { reasoning_content: 'Private ', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'read_document', arguments: '{"card_' } }] }, finish_reason: null }] });
    const second = event({ choices: [{ delta: { reasoning_content: 'thought', tool_calls: [{ function: { arguments: 'id":"card"}' } }] }, finish_reason: 'tool_calls' }] });
    const call = providerResearchCall(provider, 'secret', provider === 'glm' ? 'glm-4.7' : 'kimi-k2.6', new AbortController().signal, async (_url, options) => { payloads.push(JSON.parse(options.body)); return payloads.length === 1 ? new Response(first + second + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } }) : completion(); });
    const toolResult = await call(messages, [functionTool]);
    assert.equal(toolResult.reason, 'tool_calls');
    assert.deepEqual(toolResult.message.tool_calls, [{ id: 'call-1', type: 'function', function: { name: 'read_document', arguments: '{"card_id":"card"}' } }]);
    await call([...messages, toolResult.message, { role: 'tool', tool_call_id: 'call-1', content: '{"evidence":"Passage"}' }], [functionTool]);
    assert.equal(payloads[1].messages[2].reasoning_content, 'Private thought');
    assert.equal(payloads[1].messages[3].tool_call_id, 'call-1');
  }
});

void test('OpenAI Responses replay encrypted reasoning and function results without storing server-side responses', async () => {
  const captures = [], reasoning = { id: 'reasoning-item', type: 'reasoning', summary: [], encrypted_content: 'opaque-private-reasoning' };
  const functionCall = { id: 'function-item', type: 'function_call', call_id: 'call-123', name: 'read_document', arguments: '{"card_id":"card"}', status: 'completed' };
  const call = providerResearchCall('openai', 'private-openai-secret', 'gpt-4.1-mini', new AbortController().signal, async (url, options) => {
    captures.push({ url, options, payload: JSON.parse(options.body) });
    return openaiCompletion(captures.length === 1 ? [reasoning, functionCall] : [outputText('Verified answer')]);
  }, 'max');
  const first = await call(messages, [functionTool], 'auto');
  assert.equal(captures[0].url, 'https://api.openai.com/v1/responses'); assert.equal(captures[0].options.headers.Authorization, 'Bearer private-openai-secret');
  const payload = captures[0].payload;
  assert.equal(payload.store, false); assert.deepEqual(payload.include, ['reasoning.encrypted_content']);
  assert.equal(payload.reasoning_effort, undefined); assert.equal(payload.thinking, undefined); assert.equal(payload.messages, undefined);
  assert.equal(payload.input[0].role, 'developer'); assert.equal(payload.tools[0].name, 'read_document'); assert.equal(payload.tools[0].strict, false); assert.equal(payload.tools[0].function, undefined);
  assert.equal(first.reason, 'tool_calls'); assert.deepEqual(first.message.tool_calls, [{ id: 'call-123', type: 'function', function: { name: 'read_document', arguments: '{"card_id":"card"}' } }]);
  const second = await call([...messages, first.message, { role: 'tool', tool_call_id: 'call-123', content: '{"evidence":"original passage"}' }], [functionTool]);
  assert.deepEqual(captures[1].payload.input.slice(2), [reasoning, functionCall, { type: 'function_call_output', call_id: 'call-123', output: '{"evidence":"original passage"}' }]);
  assert.equal(second.reason, 'stop'); assert.equal(second.message.content, 'Verified answer');
});

void test('legacy assistant function history becomes Responses call items without duplicate empty messages', async () => {
  let sent;
  const call = providerResearchCall('openai', 'secret', 'gpt-4.1-mini', new AbortController().signal, async (_url, options) => { sent = JSON.parse(options.body); return openaiCompletion([outputText('Done')]); });
  await call([{ role: 'assistant', content: '', tool_calls: [{ id: 'legacy-call', type: 'function', function: { name: 'read_document', arguments: '{}' } }] }, { role: 'tool', tool_call_id: 'legacy-call', content: 'Result' }]);
  assert.deepEqual(sent.input, [{ type: 'function_call', call_id: 'legacy-call', name: 'read_document', arguments: '{}' }, { type: 'function_call_output', call_id: 'legacy-call', output: 'Result' }]);
});

void test('OpenAI refusals, incomplete output, malformed JSON and private HTTP errors cannot become answers', async () => {
  const responses = [
    { response: openaiCompletion([outputText('Partial')], 'incomplete'), message: /尚未完成/ },
    { response: openaiCompletion([{ type: 'message', content: [{ type: 'refusal', refusal: 'private refusal text' }] }]), message: /未能完成/ },
    { response: new Response('private-key-not-json'), message: /格式不正确/ },
    { response: new Response('provider diagnostic contains private-key-secret', { status: 401 }), message: /API Key 无效/ },
    { response: openaiCompletion([{ type: 'function_call', call_id: '', name: 'read_document', arguments: '{}' }]), message: /不完整/ },
  ];
  for (const { response, message } of responses) {
    const call = providerResearchCall('openai', 'private-key-secret', 'gpt-4.1-mini', new AbortController().signal, async () => response);
    await assert.rejects(call(messages), error => { assert.match(error.message, message); assert.ok(!error.message.includes('private-key')); assert.ok(!error.message.includes('private refusal')); return true; });
  }
});

void test('catalogs combine four providers, filter nonresearch models, and isolate caches when a key rotates', async () => {
  const settings = allSettings(), calls = [];
  const service = createAiService(() => settings, async (url, options) => {
    calls.push({ url, authorization: options.headers.Authorization });
    const provider = aiProviders.find(item => url === `${item.baseUrl}/models`);
    assert.ok(provider);
    return Response.json({ data: [{ id: provider.defaultModel, display_name: `${provider.name} model` }, ...['gpt-4o-audio-preview', 'https://evil.example/model', 'o1-mini', 'o1-mini-2024-09-12', 'o1-preview', 'o1-preview-2024-09-12', 'glm-4.5v', 'glm-4.6v', 'glm-4.6v-flash'].map(id => ({ id }))] });
  });
  const get = () => service.GET(new Request('http://localhost:3001/api/ai')).then(response => response.json());
  const first = await get();
  assert.equal(first.configured, true); assert.deepEqual(first.providers.map(item => item.id), ['deepseek', 'glm', 'kimi', 'openai']); assert.ok(first.providers.every(item => item.configured));
  assert.deepEqual(first.models.map(item => item.id), ['deepseek-flash', 'glm:glm-4.7', 'kimi:kimi-k2.6', 'openai:gpt-4.1-mini']);
  assert.equal(calls.length, 4); assert.ok(!JSON.stringify(first).includes('private-'));
  for (const provider of aiProviders) assert.equal(calls.find(call => call.url === `${provider.baseUrl}/models`).authorization, `Bearer private-${provider.id}-key`);
  await get(); assert.equal(calls.length, 4);
  settings.providers.kimi.key = 'rotated-kimi-secret';
  await get(); assert.equal(calls.length, 5); assert.equal(calls.at(-1).url, 'https://api.moonshot.cn/v1/models'); assert.equal(calls.at(-1).authorization, 'Bearer rotated-kimi-secret');
  settings.providers.glm.model = 'glm-5.2';
  const changed = await get(); assert.equal(calls.length, 6); assert.ok(changed.models.some(item => item.id === 'glm:glm-5.2'));
});

void test('catalog failures retain only that provider fallback without exposing response bodies or keys', async () => {
  const settings = allSettings(); settings.providers.deepseek.key = ''; settings.providers.glm.key = ''; settings.providers.openai.key = '';
  const service = createAiService(() => settings, async () => new Response('private-kimi-key diagnostic', { status: 403 }));
  const output = await (await service.GET(new Request('http://localhost:3001/api/ai'))).json();
  assert.equal(output.configured, false); assert.deepEqual(output.models.map(model => model.id), ['kimi:kimi-k2.6']);
  assert.deepEqual(output.providers.find(item => item.id === 'kimi').catalog, { source: 'fallback', error: 'permission' });
  assert.ok(!JSON.stringify(output).includes('private-kimi-key'));
});

void test('provider-specific refresh bypasses only the requested catalog cache and preserves the saved default', async () => {
  const settings = allSettings(), calls = [];
  let failOpenai = false;
  const service = createAiService(() => settings, async url => {
    calls.push(url);
    const provider = aiProviders.find(item => url === `${item.baseUrl}/models`);
    if (provider.id === 'openai' && failOpenai) return new Response('private-openai-key diagnostic', { status: 401 });
    return Response.json({ data: [{ id: provider.id === 'openai' ? 'gpt-6.1-sol' : provider.defaultModel }] });
  });
  const get = path => service.GET(new Request(`http://localhost:3001/api/ai${path || ''}`));
  const first = await (await get()).json();
  assert.equal(first.providers.find(item => item.id === 'openai').model, 'gpt-4.1-mini');
  assert.ok(first.models.some(item => item.id === 'openai:gpt-6.1-sol'));
  await get(); assert.equal(calls.length, 4);
  failOpenai = true;
  const refreshed = await (await get('?refreshModels=openai')).json();
  assert.equal(calls.length, 5);
  assert.equal(calls.at(-1), 'https://api.openai.com/v1/models');
  assert.equal(refreshed.providers.find(item => item.id === 'openai').catalog.source, 'stale');
  assert.equal(refreshed.providers.find(item => item.id === 'openai').catalog.error, 'authentication');
  assert.ok(refreshed.models.some(item => item.id === 'openai:gpt-6.1-sol'));
  assert.doesNotMatch(JSON.stringify(refreshed), /private-openai-key|diagnostic/);
  assert.equal((await get('?refreshModels=https://example.com')).status, 400);
  assert.equal((await service.GET(new Request('http://localhost:3001/api/ai?refreshModels=openai', { headers: { origin: 'https://example.com' } }))).status, 403);
  assert.equal(calls.length, 5);
});

void test('cancelling a model-list request forwards cancellation and a later read can retry', async () => {
  const settings = { provider: 'openai', key: 'dummy-key', model: 'gpt-4.1-mini' };
  let signal, calls = 0;
  const service = createAiService(() => settings, async (_url, options) => {
    calls++;
    signal = options.signal;
    if (calls > 1) return Response.json({ data: [{ id: 'gpt-6.1-sol' }] });
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  });
  const abort = new AbortController();
  const pending = service.GET(new Request('http://localhost:3001/api/ai', { signal: abort.signal }));
  abort.abort();
  assert.equal((await pending).status, 499);
  assert.equal(signal.aborted, true);
  const next = await (await service.GET(new Request('http://localhost:3001/api/ai'))).json();
  assert.equal(next.providers.find(item => item.id === 'openai').catalog.source, 'live');
  assert.equal(calls, 2);
});

void test('an explicit configured Kimi selection runs even when the active DeepSeek service is unconfigured', async () => {
  const settings = allSettings(); settings.key = ''; settings.providers.deepseek.key = '';
  const captures = [], service = createAiService(() => settings, async (url, options) => { captures.push({ url, authorization: options.headers.Authorization, payload: JSON.parse(options.body) }); return researchResponse(JSON.parse(options.body)); });
  const output = await service.POST(request({ model: 'kimi:kimi-k2.6', reasoningEffort: 'max' }));
  assert.equal(output.status, 200);
  const events = []; await readAiStream(output, item => events.push(item));
  assert.equal(captures.length, 3); assert.ok(captures.every(call => call.url === 'https://api.moonshot.cn/v1/chat/completions' && call.authorization === 'Bearer private-kimi-key'));
  assert.ok(captures.every(call => call.payload.reasoning_effort === undefined));
  assert.equal(events.at(-1).type, 'done'); assert.equal(events.find(item => item.type === 'delta').text, 'Answer [Lumior:1]');
  assert.ok(!JSON.stringify(events).includes('private-')); assert.ok(!JSON.stringify(events).includes('private research reasoning'));
});

void test('Kimi K3 question answering uses program high even with a legacy max preference', async () => {
  const captures=[],settings={provider:'kimi',model:'kimi-k3',key:'dummy-private-key'};
  const service=createAiService(()=>settings,async(_url,options)=>{const payload=JSON.parse(options.body);captures.push(payload);return researchResponse(payload);});
  const events=[];
  await readAiStream(await service.POST(request({model:'kimi:kimi-k3',reasoningEffort:'max'})),item=>events.push(item));
  assert.equal(events.at(-1).type,'done');
  assert.equal(captures.length,3);
  assert.ok(captures.every(payload=>payload.reasoning_effort==='high'));
});

void test('missing selected providers never fall back to another key and malicious selections never start a request', async () => {
  const settings = allSettings(); settings.providers.glm.key = ''; settings.missingKeyMessage = '请配置所选服务。';
  let called = false;
  const service = createAiService(() => settings, async () => { called = true; throw new Error('must not call'); });
  const absent = await service.POST(request({ model: 'glm:glm-4.7' })); assert.equal(absent.status, 503); assert.deepEqual(await absent.json(), { error: '请配置所选服务。' });
  for (const model of ['evil:kimi-k2.6', 'kimi:https://evil.example/model', 'openai:gpt-4o-audio-preview', 'openai:gpt-4.1:injected', null, { provider: 'kimi' }]) assert.equal((await service.POST(request({ model }))).status, 400, JSON.stringify(model));
  assert.equal(called, false);
});

void test('OpenAI research uses Responses while public events exclude opaque reasoning and credentials', async () => {
  const settings = allSettings(); settings.provider = 'openai';
  const calls = [], service = createAiService(() => settings, async (url, options) => {
    const payload = JSON.parse(options.body); calls.push({ url, payload });
    const privateItem = { type: 'reasoning', id: `private-item-${calls.length}`, encrypted_content: 'secret-encrypted-reasoning', summary: [] };
    return openaiCompletion([privateItem, payload.tools?.[0]?.name === 'plan_research'
      ? { type: 'function_call', id: 'plan-item', call_id: 'plan-call', name: 'plan_research', arguments: plan }
      : outputText('Answer [Lumior:1]')]);
  });
  const events = []; await readAiStream(await service.POST(request({ model: 'auto' })), item => events.push(item));
  assert.equal(calls.length, 3); assert.ok(calls.every(call => call.url === 'https://api.openai.com/v1/responses' && call.payload.store === false));
  assert.equal(events.at(-1).type, 'done'); assert.ok(events.some(item => item.type === 'delta' && item.text === 'Answer [Lumior:1]'));
  const publicText = JSON.stringify(events); for (const secret of ['secret-encrypted-reasoning', 'private-item', 'private-openai-key', 'responseItems']) assert.ok(!publicText.includes(secret), secret);
});

void test('PDF translation follows the selected default GLM, Kimi or OpenAI provider with complete output', async () => {
  const units = [{ id: '1:0', page: 1, text: 'Research improves understanding.' }];
  const translated = JSON.stringify({ sourceLanguage: '英语', units: [{ id: '1:0', text: '研究有助于理解。' }], glossary: [] });
  for (const provider of ['glm', 'kimi', 'openai']) {
    const settings = allSettings(); settings.provider = provider;
    const captures = [], service = createPdfTranslationService(() => settings, async (url, options) => { captures.push({ url, options, payload: JSON.parse(options.body) }); return provider === 'openai' ? openaiCompletion([outputText(translated)]) : completion(translated); });
    const output = await service(new Request('http://localhost:3001/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ units }) }));
    assert.equal(output.status, 200); const events = []; for await (const data of sseData(output.body)) events.push(JSON.parse(data));
    assert.equal(captures.length, 1); assert.equal(captures[0].options.headers.Authorization, `Bearer private-${provider}-key`);
    assert.equal(captures[0].payload.model, settings.providers[provider].model);
    assert.equal(captures[0].url, provider === 'openai' ? 'https://api.openai.com/v1/responses' : `${aiProviders.find(item => item.id === provider).baseUrl}/chat/completions`);
    assert.equal(events.find(item => item.type === 'translated').units[0].text, '研究有助于理解。'); assert.equal(events.at(-1).type, 'done');
    assert.ok(!JSON.stringify(events).includes('private-')); assert.ok(!JSON.stringify(events).includes('private reasoning'));
  }
});
