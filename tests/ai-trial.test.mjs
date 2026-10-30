import test from 'node:test';
import assert from 'node:assert/strict';
import { aiSettingsFromEnv } from '../lib/ai-providers.ts';
import { createAiService } from '../lib/ai-service.ts';
import { createPdfTranslationService } from '../lib/pdf-translation-service.ts';
import { createAiTrialStatusService, createTrialTask, loadTrialAccount, parseTrialAccount, trialGateway } from '../lib/ai-trial.ts';

const token = 'a'.repeat(43);
const settings = () => ({ usageMode: 'trial', provider: 'openai', key: 'personal-key-must-not-be-used', model: 'gpt-4.1-mini', trial: { gatewayUrl: 'https://api.lumior.work', token } });
const account = (overrides = {}) => ({ userId: 'trial-user', expiresAt: '2080-01-01T00:00:00.000Z', budgetMicros: 10_000_000, spentMicros: 20_000, reservedMicros: 0, remainingMicros: 9_980_000,
  providers: [{ id: 'deepseek', name: 'DeepSeek', model: 'deepseek-flash' }, { id: 'kimi', name: 'Kimi', model: 'kimi-k2.6' }], defaultProvider: 'kimi', status: 'active', limits: { userConcurrent: 1, globalConcurrent: 2, dailyTasks: 30, maxCalls: 6 }, ...overrides });
const local = (path = '/api/ai', body, signal) => new Request('http://localhost:3001' + path, { ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}), signal });
const answer = text => ({ reason: 'stop', message: { role: 'assistant', content: text } });
function gateway({ profile = account(), onCall = () => answer('Verified answer'), taskError, callError, startLost = false } = {}) {
  const requests = [];
  const fetcher = async (url, options) => {
    const parsed = new URL(url), body = options.body ? JSON.parse(options.body) : undefined;
    requests.push({ url, path: parsed.pathname, options, body });
    assert.equal(parsed.origin, 'https://api.lumior.work');
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    assert.equal(options.headers['X-Lumior-Trial-Catalog'], '2');
    assert.equal(options.redirect, 'error');
    assert.equal(String(JSON.stringify(body)).includes('personal-key-must-not-be-used'), false);
    if (parsed.pathname === '/v1/account') return Response.json(profile);
    if (parsed.pathname === '/v1/tasks') {
      if (startLost) throw new Error('PRIVATE token upstream diagnostic');
      if (taskError) return Response.json({ error: { code: taskError.code, message: 'PRIVATE token upstream diagnostic' } }, { status: taskError.status });
      return Response.json({ taskId: body.requestId, expiresAt: '2080-01-01T00:00:00.000Z' }, { status: 201 });
    }
    if (parsed.pathname.endsWith('/finish')) return Response.json({ finished: true });
    if (parsed.pathname.endsWith('/calls')) {
      if (callError) return Response.json({ error: { code: callError.code, message: 'PRIVATE token upstream diagnostic' } }, { status: callError.status });
      return Response.json(await Promise.resolve(onCall(body, options)));
    }
    throw new Error('Unexpected request');
  };
  return { requests, fetcher };
}

void test('trial gateway accepts only fixed production host and explicitly isolated test origin', () => {
  assert.equal(trialGateway(settings()), 'https://api.lumior.work');
  for (const url of ['https://api.lumior.work.evil.example', 'https://api.lumior.work?x=1', 'https://api.lumior.work/v1', 'https://secret@api.lumior.work', 'http://api.lumior.work', 'http://127.0.0.1:43371']) assert.equal(trialGateway({ ...settings(), trial: { token, gatewayUrl: url } }), undefined, url);
  assert.equal(trialGateway({ ...settings(), trial: { token, gatewayUrl: 'http://127.0.0.1:43371', allowLocalTest: true } }), 'http://127.0.0.1:43371');
  assert.equal(trialGateway({ ...settings(), trial: { token, gatewayUrl: 'http://127.0.0.1:43372', allowLocalTest: true } }), undefined);
  assert.equal(aiSettingsFromEnv({ LUMIOR_AI_USAGE_MODE: 'trial', LUMIOR_TRIAL_TOKEN: token }).usageMode, 'trial');
  assert.equal(aiSettingsFromEnv({ LUMIOR_DESKTOP_TEST_MODE: '1' }).trial.allowLocalTest, false);
  assert.equal(aiSettingsFromEnv({ LUMIOR_DESKTOP_TEST_MODE: '1', LUMIOR_DESKTOP_TEST_PORT: '43271', LUMIOR_DESKTOP_DATA_DIR: '/private/tmp/test' }).trial.allowLocalTest, true);
});

void test('account parser rejects unsafe amounts, malformed limits and unapproved providers without exposing response data', () => {
  assert.deepEqual(parseTrialAccount(account()), account());
  const invalid = [account({ remainingMicros: NaN }), account({ spentMicros: -1 }), account({ limits: { ...account().limits, globalConcurrent: 0 } }), account({ expiresAt: 123 }), account({ providers: [{ id: 'openai', name: 'PRIVATE', model: 'gpt-4.1-mini' }] }), account({ providers: [...account().providers, account().providers[0]] }), account({ defaultProvider: 'glm' })];
  for (const value of invalid) assert.throws(() => parseTrialAccount(value), error => { assert.equal(error.message.includes('PRIVATE'), false); return true; });
});

void test('local trial status exposes quota without invitation, credentials or own provider keys and blocks cross-origin access', async () => {
  const mock = gateway(), GET = createAiTrialStatusService(settings, mock.fetcher);
  const response = await GET(local('/api/ai/trial')), result = await response.json();
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(result.usageMode, 'trial'); assert.equal(result.serviceAvailable, true); assert.equal(result.activated, true); assert.deepEqual(result.account, account());
  assert.equal(JSON.stringify(result).includes(token), false); assert.equal(JSON.stringify(result).includes('personal-key'), false);
  assert.equal((await GET(new Request('http://localhost:3001/api/ai/trial', { headers: { Origin: 'https://evil.example' } }))).status, 403);
  assert.equal(mock.requests.length, 1);
});

void test('unconfigured or inactive trial never calls own API keys or offers private provider catalog', async () => {
  for (const trial of [undefined, { gatewayUrl: 'https://api.lumior.work' }, { gatewayUrl: 'https://evil.example', token }]) {
    let called = false;
    const state = { ...settings(), trial }, service = createAiService(() => state, async () => { called = true; throw new Error(); });
    const result = await (await service.GET(local())).json();
    assert.equal(result.usageMode, 'trial'); assert.equal(result.configured, false); assert.deepEqual(result.providers, []); assert.deepEqual(result.models, []);
    const post = await service.POST(local('/api/ai', { question: 'Question', sources: [] }));
    assert.equal(post.status, 503); assert.equal(called, false);
  }
});

void test('trial catalog and auto selection are authoritative from the invitation account', async () => {
  const mock = gateway(), service = createAiService(settings, mock.fetcher);
  const data = await (await service.GET(local())).json();
  assert.equal(data.configured, true); assert.equal(data.provider, 'kimi'); assert.equal(data.model, 'kimi-k2.6'); assert.equal(data.trialStatus, 'active');
  assert.deepEqual(data.models.map(model => model.id), ['deepseek-flash', 'kimi:kimi-k2.6']);
  assert.equal(mock.requests.some(request => request.path.includes('/models')), false);
  const refused = await service.POST(local('/api/ai', { question: 'Question', sources: [], model: 'openai:gpt-4.1-mini' }));
  assert.equal(refused.status, 400); assert.equal(mock.requests.some(request => request.path === '/v1/tasks'), false);
});

void test('multiple models share provider headings and use the authoritative concrete default', async () => {
  const profile = account({ providers: [
    { id: 'deepseek', name: 'DeepSeek', model: 'deepseek-flash', displayName: 'V4.1 Flash' },
    { id: 'deepseek', name: 'DeepSeek', model: 'deepseek-v4-pro', displayName: 'V4 Pro 0813' },
    { id: 'kimi', name: 'Kimi', model: 'kimi-k2.6', displayName: 'K2.6' },
    { id: 'kimi', name: 'Kimi', model: 'kimi-k3', displayName: 'K3' },
  ], defaultModel: 'kimi-k3' });
  assert.deepEqual(parseTrialAccount(profile), profile);
  assert.throws(() => parseTrialAccount({ ...profile, defaultModel: 'deepseek-v4-pro' }));
  assert.throws(() => parseTrialAccount({ ...profile, providers: [...profile.providers, profile.providers[0]] }));
  assert.throws(() => parseTrialAccount({ ...profile, providers: profile.providers.map(item => ({ ...item, displayName: ' ' })) }));
  const mock = gateway({ profile }), service = createAiService(settings, mock.fetcher);
  const data = await (await service.GET(local())).json();
  assert.deepEqual(data.providers.map(item => item.id), ['deepseek', 'kimi']);
  assert.deepEqual(data.models.map(item => item.name), ['V4.1 Flash', 'V4 Pro 0813', 'K2.6', 'K3']);
  assert.equal(data.model, 'kimi-k3');
  assert.equal(Object.hasOwn(data.models.find(item => item.model === 'kimi-k3'), 'reasoningEffort'), false);
  const response = await service.POST(local('/api/ai', { question: 'Synthetic check', sources: [], model: 'auto' }));
  await response.text();
  assert.ok(mock.requests.filter(item => item.path.endsWith('/calls')).every(item => item.body.model === 'kimi-k3'));
});

void test('the internal trial transport preserves its concrete model and task policy without using personal keys', async () => {
  const profile = account({ providers: [...account().providers, { id: 'kimi', name: 'Kimi', model: 'kimi-k3', displayName: 'K3' }] });
  const mock = gateway({ profile });
  const task = await createTrialTask(settings(), parseTrialAccount(profile), 'research', 'kimi', 'kimi-k3', new AbortController().signal, mock.fetcher, 'low');
  await task.call([{ role: 'user', content: 'Synthetic check' }]);
  await task.finish();
  const call = mock.requests.find(item => item.path.endsWith('/calls'));
  assert.equal(call.body.model, 'kimi-k3'); assert.equal(call.body.reasoningEffort, 'low');
  assert.equal(mock.requests.filter(item => item.path.endsWith('/calls')).length, 1);
});

void test('trial research ignores old effort settings and uses the same high policy as personal keys', async () => {
  const profile = account({ providers: [...account().providers, { id: 'kimi', name: 'Kimi', model: 'kimi-k3', displayName: 'K3' }] });
  for (const reasoningEffort of ['low', 'max', 'invalid', null]) {
    const mock = gateway({ profile, onCall: body => body.tools?.[0]?.function?.name === 'plan_research'
      ? { reason: 'tool_calls', message: { role: 'assistant', content: '', tool_calls: [{ id: 'plan-call', type: 'function', function: { name: 'plan_research', arguments: JSON.stringify({ task: 'summary', card_ids: ['card'], queries: ['Evidence'], requirements: ['Answer'] }) } }] } }
      : answer('Evidence supports this answer [Lumior:1].') });
    const service = createAiService(settings, mock.fetcher);
    const output = await service.POST(local('/api/ai', { question: 'Synthetic check', sources: [{ cardId: 'card', title: 'Reference', text: 'Evidence' }], model: 'kimi:kimi-k3', reasoningEffort }));
    assert.equal(output.status, 200);
    const text = await output.text();
    assert.match(text, /"type":"done"/);
    const calls = mock.requests.filter(item => item.path.endsWith('/calls'));
    assert.equal(calls.length, 3);
    assert.ok(calls.every(item => item.body.model === 'kimi-k3' && item.body.reasoningEffort === 'high'));
    assert.equal(mock.requests.filter(item => item.path.endsWith('/finish')).length, 1);
  }
});

void test('translation uses the concrete trial default even when another model appears first', async () => {
  const profile = account({ providers: [...account().providers, { id: 'kimi', name: 'Kimi', model: 'kimi-k3' }], defaultModel: 'kimi-k3' });
  const mock = gateway({ profile, onCall: body => {
    const payload = JSON.parse(body.messages[1].content);
    return answer(JSON.stringify({ sourceLanguage: '英语', units: payload.units.map(unit => ({ id: unit.id, text: '译文' })), glossary: [] }));
  } });
  const response = await createPdfTranslationService(settings, mock.fetcher)(local('/api/translate', { units: [{ id: '1:0', page: 1, text: 'Synthetic check' }] }));
  assert.match(await response.text(), /"type":"done"/);
  const calls = mock.requests.filter(item => item.path.endsWith('/calls'));
  assert.equal(calls.length, 1); assert.equal(calls[0].body.model, 'kimi-k3');
  assert.equal(calls[0].body.reasoningEffort, 'low');
});

void test('expired, revoked and exhausted account prevent research and translation before starting a task', async () => {
  for (const [status, http] of [['expired', 403], ['revoked', 403], ['exhausted', 402]]) {
    const mock = gateway({ profile: account({ status }) }), service = createAiService(settings, mock.fetcher), translate = createPdfTranslationService(settings, mock.fetcher);
    assert.equal((await service.POST(local('/api/ai', { question: 'Question', sources: [] }))).status, http);
    assert.equal((await translate(local('/api/translate', { units: [{ id: '1:0', page: 1, text: 'Original text' }] }))).status, http);
    assert.equal(mock.requests.some(request => request.path === '/v1/tasks'), false);
  }
});

void test('lost task start closes the known request ID with a fresh cleanup signal and sanitized error', async () => {
  const mock = gateway({ startLost: true });
  await assert.rejects(createTrialTask(settings(), account(), 'research', 'kimi', 'kimi-k2.6', new AbortController().signal, mock.fetcher), error => { assert.equal(error.message.includes('PRIVATE'), false); return true; });
  const start = mock.requests.find(request => request.path === '/v1/tasks'), finish = mock.requests.find(request => request.path.endsWith('/finish'));
  assert.equal(finish.path, `/v1/tasks/${start.body.requestId}/finish`); assert.equal(finish.options.signal.aborted, false);
});

void test('each trial call has a distinct ID, strips private response items, retains tools, and never retries an upstream failure', async () => {
  const mock = gateway(), task = await createTrialTask(settings(), account(), 'research', 'deepseek', 'deepseek-flash', new AbortController().signal, mock.fetcher, 'low');
  const messages = [{ role: 'system', content: 'Instructions', responseItems: [{ encrypted_content: 'private-replay' }] }, { role: 'user', content: 'Question' }];
  await task.call(messages); await task.call(messages, [{ type: 'function', function: { name: 'read_document', parameters: { type: 'object' } } }], 'auto');
  const calls = mock.requests.filter(request => request.path.endsWith('/calls'));
  assert.notEqual(calls[0].body.callId, calls[1].body.callId); assert.equal(calls[0].body.reasoningEffort, 'low'); assert.equal(calls[0].body.messages[0].responseItems, undefined); assert.equal(calls[1].body.toolChoice, 'auto');
  await task.finish(); await task.finish(); assert.equal(mock.requests.filter(request => request.path.endsWith('/finish')).length, 1);
  await assert.rejects(task.call(messages), /已结束/);
  const failed = gateway({ callError: { status: 502, code: 'upstream_unavailable' } }), failedTask = await createTrialTask(settings(), account(), 'research', 'kimi', 'kimi-k2.6', new AbortController().signal, failed.fetcher);
  await assert.rejects(failedTask.call(messages), error => { assert.equal(error.message.includes('PRIVATE'), false); return true; });
  assert.equal(failed.requests.filter(request => request.path.endsWith('/calls')).length, 1); await failedTask.finish();
});

void test('large trial context fails explicitly before outbound model call and still closes its task', async () => {
  const mock = gateway(), task = await createTrialTask(settings(), account(), 'research', 'kimi', 'kimi-k2.6', new AbortController().signal, mock.fetcher);
  await assert.rejects(task.call([{ role: 'user', content: '中'.repeat(11_000) }]), /容量/);
  assert.equal(mock.requests.filter(request => request.path.endsWith('/calls')).length, 0); await task.finish();
  assert.equal(mock.requests.filter(request => request.path.endsWith('/finish')).length, 1);
});

void test('cancelling an in-flight trial call preserves an independent task finish request', async () => {
  const controller = new AbortController(), mock = gateway({ onCall: (_body, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('PRIVATE abort')), { once: true })) });
  const task = await createTrialTask(settings(), account(), 'research', 'kimi', 'kimi-k2.6', controller.signal, mock.fetcher);
  const result = task.call([{ role: 'user', content: 'Question' }]); controller.abort(); await assert.rejects(result); await task.finish();
  assert.equal(mock.requests.at(-1).path.endsWith('/finish'), true); assert.equal(mock.requests.at(-1).options.signal.aborted, false);
});

void test('trial research plan, answer and review all use one remote task and finish after completion', async () => {
  const mock = gateway({ onCall: body => body.tools?.[0]?.function?.name === 'plan_research'
    ? { reason: 'tool_calls', message: { role: 'assistant', content: '', reasoning_content: 'private thought', tool_calls: [{ id: 'plan-call', type: 'function', function: { name: 'plan_research', arguments: JSON.stringify({ task: 'summary', card_ids: ['card'], queries: ['Evidence'], requirements: ['Answer'] }) } }] } }
    : answer('Evidence supports this answer [Lumior:1].') });
  const service = createAiService(settings, mock.fetcher);
  const response = await service.POST(local('/api/ai', { question: 'Summarize', sources: [{ cardId: 'card', title: 'Reference', text: 'Evidence' }] }));
  const stream = await response.text();
  assert.equal(response.status, 200); assert.match(stream, /"type":"done"/); assert.match(stream, /Evidence supports/); assert.equal(stream.includes('private thought'), false);
  const calls = mock.requests.filter(request => request.path.endsWith('/calls'));
  assert.equal(calls.length, 3); assert.ok(calls.every(request => request.body.provider === 'kimi' && request.body.model === 'kimi-k2.6'));
  assert.equal(new Set(calls.map(request => request.path)).size, 1); assert.equal(mock.requests.filter(request => request.path.endsWith('/finish')).length, 1);
});

void test('multi-batch PDF translation uses one quota task and closes it once', async () => {
  const mock = gateway({ onCall: body => {
    const payload = JSON.parse(body.messages[1].content);
    return answer(JSON.stringify({ sourceLanguage: '英语', units: payload.units.map(unit => ({ id: unit.id, text: '完整译文' })), glossary: [] }));
  } });
  const translate = createPdfTranslationService(settings, mock.fetcher);
  const response = await translate(local('/api/translate', { units: [{ id: '1:0', page: 1, text: 'A'.repeat(4000) }, { id: '2:0', page: 2, text: 'B'.repeat(4000) }] }));
  const stream = await response.text(); assert.match(stream, /"type":"done"/); assert.equal((stream.match(/"type":"translated"/g) || []).length, 2);
  assert.equal(mock.requests.filter(request => request.path === '/v1/tasks').length, 1); assert.equal(mock.requests.find(request => request.path === '/v1/tasks').body.kind, 'translation');
  assert.equal(mock.requests.filter(request => request.path.endsWith('/calls')).length, 4); assert.equal(mock.requests.filter(request => request.path.endsWith('/finish')).length, 1);
});

void test('global concurrency rejection is a visible stream error and never falls back to personal key', async () => {
  const mock = gateway({ taskError: { status: 429, code: 'global_concurrency' } }), service = createAiService(settings, mock.fetcher);
  const response = await service.POST(local('/api/ai', { question: 'Question', sources: [] }));
  assert.match(await response.text(), /体验服务正在处理其他请求/);
  assert.equal(mock.requests.filter(request => request.path.endsWith('/calls')).length, 0);
});

void test('PDF cancelled while waiting for quota preflight never starts a billed task', async () => {
  let complete, requested;
  const pending = new Promise(resolve => { complete = resolve; });
  const called = new Promise(resolve => { requested = resolve; });
  const mock = gateway();
  const translate = createPdfTranslationService(settings, async (url, options) => {
    if (new URL(url).pathname === '/v1/account') { requested(); await pending; }
    return mock.fetcher(url, options);
  });
  const job = translate(local('/api/translate', { jobId: 'cancel-preflight', units: [{ id: '1:0', page: 1, text: 'Original text' }] }));
  await called;
  assert.equal((await translate(local('/api/translate', { action: 'cancel', jobId: 'cancel-preflight' }))).status, 200);
  complete(); assert.equal((await job).status, 409);
  assert.equal(mock.requests.some(request => request.path === '/v1/tasks'), false);
});

void test('quota status errors and malformed response bodies expose no upstream diagnostic', async () => {
  const response = await createAiTrialStatusService(settings, async () => new Response('PRIVATE diagnostic contains token', { status: 502 }))(local('/api/ai/trial'));
  const result = await response.json(); assert.equal(result.error.includes('PRIVATE'), false); assert.equal(JSON.stringify(result).includes(token), false);
  await assert.rejects(loadTrialAccount(settings(), async () => Response.json(account({ remainingMicros: -1 }))), /暂不可用/);
});
