import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createAiModelCatalog } from '../lib/ai-model-catalog.ts';

const key = 'private-test-key';
const fallback = 'gpt-4.1-mini';
const list = (...ids) => Response.json({ data: ids.map(id => ({ id })) });
const read = (catalog, options = {}) => catalog.get('openai', key, fallback, options);

void test('new OpenAI models survive filtering and missing saved defaults remain explicitly unverified', async () => {
  const catalog = createAiModelCatalog(async () => list('gpt-6.1-sol', 'gpt-6-luna', 'gpt-6.1-sol', 'gpt-image-2.5', 'gpt-5-codex'));
  const result = await read(catalog);
  assert.deepEqual(result.models.map(item => item.model), [fallback, 'gpt-6.1-sol', 'gpt-6-luna']);
  assert.deepEqual(result.models.map(item => item.listed), [false, true, true]);
  assert.equal(result.catalog.source, 'live');
  assert.ok(result.catalog.lastSuccessfulAt > 0);
});

void test('catalog failures expose only fixed classifications, never keys or provider diagnostics', async () => {
  const cases = [
    ['authentication', () => new Response('private-test-key upstream body', { status: 401 })],
    ['permission', () => new Response('private-test-key upstream body', { status: 403 })],
    ['rate_limited', () => new Response('private-test-key upstream body', { status: 429 })],
    ['upstream', () => new Response('private-test-key upstream body', { status: 503 })],
    ['invalid_response', () => new Response('private-test-key invalid json')],
    ['invalid_response', () => Response.json({ private: key })],
    ['empty', () => list('gpt-image-2.5')],
    ['network', () => { throw new TypeError('private-test-key network detail'); }],
  ];
  for (const [error, respond] of cases) {
    const result = await read(createAiModelCatalog(async () => respond()));
    assert.deepEqual(result.catalog, { source: 'fallback', error });
    assert.deepEqual(result.models.map(item => item.model), [fallback]);
    assert.doesNotMatch(JSON.stringify(result), /private-test-key|upstream body|network detail/);
  }
});

void test('explicit refresh bypasses cached success and failure while failed refresh keeps the last successful list', async () => {
  let clock = 1000, count = 0, failed = false;
  const catalog = createAiModelCatalog(async () => { count++; return failed ? new Response('', { status: 503 }) : list('gpt-6.1-sol'); }, { now: () => clock });
  await read(catalog);
  assert.equal((await read(catalog)).catalog.source, 'cached');
  assert.equal(count, 1);
  failed = true;
  const stale = await read(catalog, { refresh: true });
  assert.deepEqual(stale.catalog, { source: 'stale', error: 'upstream', lastSuccessfulAt: 1000 });
  assert.ok(stale.models.some(model => model.model === 'gpt-6.1-sol'));
  assert.deepEqual(await read(catalog), stale);
  assert.equal(count, 2);
  clock += 30_001;
  await read(catalog);
  assert.equal(count, 3);
  failed = false;
  assert.equal((await read(catalog, { refresh: true })).catalog.source, 'live');
  assert.equal(count, 4);
});

void test('successful cache expires after five minutes without requiring an explicit refresh', async () => {
  let clock = 1000, count = 0;
  const catalog = createAiModelCatalog(async () => { count++; return list(fallback); }, { now: () => clock });
  await read(catalog);
  clock += 299_999;
  await read(catalog);
  assert.equal(count, 1);
  clock += 2;
  await read(catalog);
  assert.equal(count, 2);
});

void test('old lists never cross key changes, default changes, key removal, or providers', async () => {
  let failed = false;
  const catalog = createAiModelCatalog(async () => failed ? new Response('', { status: 401 }) : list('gpt-6.1-sol'));
  await read(catalog);
  failed = true;
  for (const [nextKey, nextDefault] of [['rotated-private-key', fallback], [key, 'gpt-6-luna']]) {
    const result = await catalog.get('openai', nextKey, nextDefault);
    assert.equal(result.catalog.source, 'fallback');
    assert.deepEqual(result.models.map(item => item.model), [nextDefault]);
  }
  failed = false;
  await read(catalog);
  catalog.clear('openai');
  failed = true;
  assert.equal((await read(catalog)).catalog.source, 'fallback');
  assert.equal((await catalog.get('kimi', key, 'kimi-k3')).catalog.source, 'fallback');
});

void test('simultaneous manual refreshes share one request and cancelling one does not cancel the other', async () => {
  let requests = 0, upstreamSignal, resolve;
  const catalog = createAiModelCatalog(async (_url, options) => {
    requests++; upstreamSignal = options.signal;
    return new Promise(done => { resolve = done; });
  });
  const first = new AbortController();
  const a = read(catalog, { refresh: true, signal: first.signal });
  const b = read(catalog, { refresh: true });
  first.abort();
  await assert.rejects(a, { name: 'AbortError' });
  assert.equal(upstreamSignal.aborted, false);
  resolve(list('gpt-6.1-sol'));
  assert.equal((await b).catalog.source, 'live');
  assert.equal(requests, 1);
});

void test('cancelling all readers aborts the request without poisoning either success or failure caches', async () => {
  let requests = 0, upstreamSignal;
  const catalog = createAiModelCatalog(async (_url, options) => {
    requests++;
    if (requests !== 2) return list('gpt-6.1-sol');
    upstreamSignal = options.signal;
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
  });
  await read(catalog);
  const abort = new AbortController();
  const pending = read(catalog, { refresh: true, signal: abort.signal });
  abort.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(upstreamSignal.aborted, true);
  assert.equal((await read(catalog)).catalog.source, 'cached');
  assert.equal(requests, 2);
  assert.equal((await read(catalog, { refresh: true })).catalog.source, 'live');
  assert.equal(requests, 3);
  const preCancelled = new AbortController(); preCancelled.abort();
  await assert.rejects(read(catalog, { refresh: true, signal: preCancelled.signal }), { name: 'AbortError' });
  assert.equal(requests, 3);
});

void test('timeout has its own safe status and becomes retryable without a poisoned in-flight request', async () => {
  let count = 0;
  const catalog = createAiModelCatalog(async (_url, { signal }) => {
    count++;
    if (count > 1) return list('gpt-6.1-sol');
    await delay(100, undefined, { signal });
    return list('gpt-6.1-sol');
  }, { timeoutMs: 5 });
  assert.deepEqual((await read(catalog)).catalog, { source: 'fallback', error: 'timeout' });
  assert.equal((await read(catalog, { refresh: true })).catalog.source, 'live');
});

void test('a key change aborts an in-flight old account and late responses cannot overwrite the new catalog', async () => {
  let oldSignal, resolveOld;
  const catalog = createAiModelCatalog(async (_url, { signal, headers }) => {
    if (headers.Authorization.endsWith(key)) {
      oldSignal = signal;
      return new Promise(resolve => { resolveOld = resolve; });
    }
    return list('gpt-6-luna');
  });
  const old = read(catalog);
  const next = await catalog.get('openai', 'new-key', fallback);
  assert.equal(oldSignal.aborted, true);
  resolveOld(list('gpt-6.1-sol'));
  await assert.rejects(old, { name: 'AbortError' });
  assert.deepEqual((await catalog.get('openai', 'new-key', fallback)).models, next.models);
  assert.ok(!next.models.some(model => model.model === 'gpt-6.1-sol'));
});
