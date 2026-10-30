import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createThesisService } from '../lib/thesis/service.ts';
import { createAiService } from '../lib/ai-service.ts';
import { createPdfTranslationService } from '../lib/pdf-translation-service.ts';
import { resolveAiAccess, createAiTask } from '../lib/ai-runtime.ts';
import { newThesisSession } from '../lib/thesis/model.ts';
import { base } from './thesis-fixtures.mjs';

// Public wire-contract fixtures, deliberately independent of the private ledger.
// They verify client behavior, not server-side accounting or concurrent locking.
const token = 'a'.repeat(43);
const settings = { usageMode: 'trial', model: 'deepseek-flash', key: 'synthetic-personal-key-must-not-be-used', trial: { token, gatewayUrl: 'https://api.lumior.work' } };
const profile = overrides => ({ userId: 'existing-activation', expiresAt: '2080-01-01T00:00:00.000Z', budgetMicros: 10_000_000, spentMicros: 0, reservedMicros: 0, remainingMicros: 10_000_000,
  providers: [{ id: 'deepseek', name: 'DeepSeek', model: 'deepseek-flash' }, { id: 'kimi', name: 'Kimi', model: 'kimi-k3.1-pro' }], defaultProvider: 'deepseek', defaultModel: 'deepseek-flash', status: 'active',
  limits: { userConcurrent: 1, globalConcurrent: 2, dailyTasks: 30, maxCalls: 6, maxRequestBytes: 240_000, maxMessages: 256 }, ...overrides });
const local = (route, body, signal) => new Request(`http://localhost:3001${route}`, { ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}), signal });
const answer = content => ({ reason: 'stop', message: { role: 'assistant', content } });
const tool = (name, args) => ({ reason: 'tool_calls', message: { role: 'assistant', content: '', tool_calls: [{ id: crypto.randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } }] } });
const thesisBody = skill => ({ consent: true, consentProvider: 'kimi', snapshot: base(), session: { ...newThesisSession(skill), model: 'deepseek-flash' }, question: skill === 'mba-topic' ? '论文方向是运营管理。我想研究原料入库检验流程。' : '请继续' });

function protocol(onCall = () => answer('Q1 — 最近发生了什么具体问题？'), overrides = {}) {
  const requests = [], calls = [], finished = [];
  const fetcher = async (url, init) => {
    const parsed = new URL(url), body = init.body && JSON.parse(init.body);
    assert.equal(parsed.origin, 'https://api.lumior.work');
    assert.equal(init.headers.Authorization, `Bearer ${token}`);
    assert.equal(init.headers['X-Lumior-Trial-Catalog'], '2');
    assert.equal(init.redirect, 'error');
    assert.ok(!JSON.stringify(body || {}).includes(settings.key));
    requests.push({ path: parsed.pathname, body, signal: init.signal });
    if (parsed.pathname === '/v1/account') return Response.json(profile(overrides));
    if (parsed.pathname === '/v1/tasks') return Response.json({ taskId: body.requestId, expiresAt: '2080-01-01T00:00:00.000Z' }, { status: 201 });
    if (/^\/v1\/tasks\/[^/]+\/finish$/.test(parsed.pathname)) { finished.push(parsed.pathname); return Response.json({ finished: true }); }
    if (/^\/v1\/tasks\/[^/]+\/calls$/.test(parsed.pathname)) { calls.push(body); return Response.json(await Promise.resolve(onCall(body, init, calls.length))); }
    throw new Error(`Unexpected protocol path: ${parsed.pathname}`);
  };
  const waitForFinishes = async expected => {
    // Services finish cleanup asynchronously after closing SSE. Yield event-loop
    // turns for that concrete completion, never advance a synthetic server clock.
    const deadline = Date.now() + 5000;
    while (finished.length < expected) {
      if (Date.now() >= deadline) throw new Error(`Expected ${expected} task finishes; saw ${finished.length}`);
      await new Promise(resolve => setImmediate(resolve));
    }
    assert.equal(finished.length, expected);
  };
  return { fetcher, requests, calls, finished, waitForFinishes };
}

void test('public protocol: one existing activation runs research, translation and four MBA skills without a personal-key call', async () => {
  const mock = protocol(body => {
    if (body.tools?.[0]?.function.name === 'plan_research') return tool('plan_research', { task: 'summary', card_ids: ['card'], queries: ['Evidence'], requirements: ['Answer'] });
    if (body.messages[0].content.includes('学术文献翻译')) {
      const input = JSON.parse(body.messages[1].content);
      return answer(JSON.stringify({ sourceLanguage: '英语', units: input.units.map(unit => ({ id: unit.id, text: '测试译文' })), glossary: [] }));
    }
    return answer(body.tools?.some(item => item.function.name === 'Read') ? 'Q1 — 最近发生了什么具体问题？' : 'Evidence supports this answer [Lumior:1].');
  });
  const config = await (await createThesisService(() => settings, mock.fetcher).GET(local('/api/thesis'))).json();
  assert.equal(config.configured, true); assert.equal(config.usageMode, 'trial'); assert.ok(!JSON.stringify(config).includes(token));
  const research = await createAiService(() => settings, mock.fetcher).POST(local('/api/ai', { question: 'Summarize', sources: [{ cardId: 'card', title: 'Reference', text: 'Evidence' }] }));
  assert.match(await research.text(), /"type":"done"/); await mock.waitForFinishes(1);
  const translation = await createPdfTranslationService(() => settings, mock.fetcher)(local('/api/translate', { units: [{ id: '1:0', page: 1, text: 'Synthetic sentence' }] }));
  assert.match(await translation.text(), /"type":"done"/); await mock.waitForFinishes(2);
  let finishes = 2;
  for (const skill of ['mba-topic', 'mba-lit', 'mba-review', 'mba-proposal']) {
    const response = await createThesisService(() => settings, mock.fetcher).POST(local('/api/thesis', thesisBody(skill)));
    const events = (await response.text()).split('\n\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
    assert.equal(response.status, 200); assert.ok(events.some(event => event.type === 'result'));
    assert.equal(events.find(event => event.type === 'result').result.error, undefined);
    await mock.waitForFinishes(++finishes);
    assert.ok(mock.calls.some(body => body.messages[0].content.includes(`name: ${skill}`) && body.tools?.some(item => item.function.name === 'Read')));
  }
  const starts = mock.requests.filter(item => item.path === '/v1/tasks');
  assert.equal(starts.length, 6); assert.equal(new Set(starts.map(item => item.body.requestId)).size, 6);
  assert.deepEqual(starts.map(item => item.body.kind), ['research', 'translation', 'research', 'research', 'research', 'research']);
  assert.deepEqual(new Set(mock.finished.map(route => route.split('/')[3])), new Set(starts.map(item => item.body.requestId)));
  assert.ok(mock.calls.some(body => Buffer.byteLength(JSON.stringify(body)) > 30_000), 'complete MBA prompts use the advertised expanded capacity');
  const mbaCalls = mock.calls.filter(body => body.model === 'kimi-k3.1-pro');
  assert.equal(mbaCalls.length, 4); assert.ok(mbaCalls.every(body => body.reasoningEffort === 'high'));
  assert.ok(mock.requests.every(item => !item.path.includes('redeem')), 'existing activation is reused without feature activation');
});

void test('public protocol: expired, revoked and exhausted MBA access rejects before creating a task despite an available personal key', async () => {
  for (const overrides of [{ expiresAt: '2000-01-01T00:00:00.000Z' }, { status: 'revoked' }, { status: 'exhausted', remainingMicros: 0 }]) {
    const mock = protocol(undefined, overrides);
    const response = await createThesisService(() => settings, mock.fetcher).POST(local('/api/thesis', thesisBody('mba-review')));
    assert.ok([402, 403].includes(response.status)); assert.equal(mock.calls.length, 0);
    assert.ok(mock.requests.every(item => item.path === '/v1/account'));
  }
});

void test('public protocol: effort changes share one task and full contexts are preserved; finish is idempotent', async () => {
  const mock = protocol(() => answer('Complete answer'));
  const access = await resolveAiAccess(settings, undefined, mock.fetcher);
  const task = await createAiTask(access, new AbortController().signal, mock.fetcher, tools => tools ? 'low' : 'high');
  const full = '完整资料'.repeat(8000);
  await task.call([{ role: 'user', content: full }]);
  await task.call([{ role: 'user', content: 'Plan' }], [{ type: 'function', function: { name: 'Read', parameters: { type: 'object', properties: {} } } }]);
  assert.equal(mock.calls[0].messages[0].content, full);
  assert.deepEqual(mock.calls.map(call => call.reasoningEffort), ['high', 'low']);
  await assert.rejects(task.call([{ role: 'user', content: '中'.repeat(90_000) }]), /容量/);
  assert.equal(mock.calls.length, 2);
  await task.finish(); await task.finish();
  assert.equal(mock.requests.filter(item => item.path === '/v1/tasks').length, 1); assert.equal(mock.finished.length, 1);
  await assert.rejects(task.call([{ role: 'user', content: 'After finish' }]), /结束/);
});

void test('public application features cannot bypass the shared AI runtime with direct provider calls', async () => {
  for (const dir of ['lib', 'app']) {
    for (const name of await readdir(new URL(`../${dir}/`, import.meta.url), { recursive: true })) {
      if (!/\.tsx?$/.test(name) || ['ai-provider.ts', 'ai-runtime.ts'].includes(name)) continue;
      const source = await readFile(new URL(`../${dir}/${name}`, import.meta.url), 'utf8');
      assert.doesNotMatch(source, /import\s*\{[^}]*\b(?:providerResearchCall|deepseekResearchCall)\b[^}]*\}\s*from/, `${dir}/${name} must use ai-runtime`);
    }
  }
});
