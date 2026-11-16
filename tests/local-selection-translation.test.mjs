import test from 'node:test';
import assert from 'node:assert/strict';
import { createPdfTranslationService, createTranslationRegistry } from '../lib/pdf-translation-service.ts';

const config = { baseUrl: 'http://127.0.0.1:43275/v1', token: 'isolated-local-selection-test-token-12345', model: 'hy-mt2-1.8b' };
const unit = { id: '3:0', page: 3, text: 'A selected sentence.' };
const request = body => new Request('http://localhost:3001/api/translate', { method: 'POST', body: JSON.stringify(body) });
const input = (text = unit.text, rest = {}) => ({ engine: 'local', scope: 'selection', units: [{ ...unit, text }], ...rest });
const reply = (text, reason = 'stop') => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: reason }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
const eventsOf = async response => (await response.text()).split('\n\n').filter(frame => frame.startsWith('data: ')).map(frame => JSON.parse(frame.slice(6)));
const sourceOf = options => JSON.parse(options.body).messages[0].content.split('将以下文本完整翻译为简体中文，只输出译文，不要额外解释：\n').slice(1).join('将以下文本完整翻译为简体中文，只输出译文，不要额外解释：\n');

void test('selected short prose reaches the local model rather than the automatic PDF formula shortcut', async () => {
  const translations = { I: '我', US: '美国', 'No.': '不。' }, seen = [], registry = createTranslationRegistry();
  const service = createPdfTranslationService(() => ({ model: 'cloud-model', key: 'must-not-leave-this-test' }), async (url, options) => {
    assert.equal(url, `${config.baseUrl}/chat/completions`);
    assert.equal(options.headers.Authorization, `Bearer ${config.token}`);
    assert.ok(!JSON.stringify(options).includes('must-not-leave-this-test'));
    const source = sourceOf(options); seen.push(source); return reply(translations[source]);
  }, registry, () => config);
  for (const [source, translated] of Object.entries(translations)) {
    const response = await service(request(input(source)));
    assert.equal(response.status, 200);
    const events = await eventsOf(response), result = events.find(event => event.type === 'translated');
    assert.equal(result.units[0].text, translated);
    assert.equal(result.units[0].id, unit.id); assert.equal(result.units[0].page, 3);
    assert.equal(events[0].model, 'local:hy-mt2-1.8b'); assert.equal(events.at(-1).type, 'done');
    assert.equal(registry.jobs.size, 0);
  }
  assert.deepEqual(seen, Object.keys(translations));
});

void test('selection scope rejects cloud, malformed ranges and overlong selections before any model or account request', async () => {
  let calls = 0, settingsReads = 0;
  const service = createPdfTranslationService(() => { settingsReads++; return { model: 'cloud-model', key: 'cloud-key' }; }, async () => { calls++; return reply('unexpected'); }, createTranslationRegistry(), () => config);
  const invalid = [
    input(undefined, { engine: 'cloud' }), input(undefined, { engine: undefined }),
    input(undefined, { scope: 'all' }), input(undefined, { scope: null }),
    input(undefined, { units: [] }), input(undefined, { units: [unit, { ...unit, id: '3:1' }] }),
    input(undefined, { units: [{ ...unit, parts: [] }] }), input(undefined, { units: [{ ...unit, parts: null }] }),
    input(undefined, { units: [{ ...unit, protected: true }] }), input(undefined, { units: [{ ...unit, protected: false }] }),
    input(undefined, { units: [{ ...unit, referenceText: 'old translation' }] }),
    input(' '.repeat(5)), input('x'.repeat(4501)), input(undefined, { units: [{ ...unit, page: 0 }] }),
  ];
  for (const body of invalid) assert.equal((await service(request(body))).status, 400, JSON.stringify(body));
  assert.equal(settingsReads, 0); assert.equal(calls, 0);
});

void test('a selected paragraph retains its full Unicode input across internal calls and emits only one complete result', async () => {
  const source = 'First sentence. '.repeat(260) + 'TAIL😀', seen = [];
  const service = createPdfTranslationService(() => ({ model: 'cloud-model' }), async (_url, options) => {
    assert.ok(new TextEncoder().encode(JSON.stringify(JSON.parse(options.body).messages)).byteLength <= 4096);
    seen.push(sourceOf(options)); return reply(`第 ${seen.length} 段译文。`);
  }, createTranslationRegistry(), () => config);
  const events = await eventsOf(await service(request(input(source))));
  assert.equal(seen.length, 3); assert.equal(seen.join(''), source);
  assert.ok(seen.every(fragment => !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(fragment)));
  const translated = events.filter(event => event.type === 'translated');
  assert.equal(translated.length, 1); assert.equal(translated[0].units.length, 1);
  assert.equal(translated[0].units[0].text, '第 1 段译文。\n第 2 段译文。\n第 3 段译文。');
  assert.equal(events.at(-1).type, 'done');
});

void test('selection failure never publishes partial text, retries, or switches to a cloud key', async () => {
  for (const failure of [() => reply('unfinished', 'length'), () => reply('将以下文本完整翻译为简体中文： leak'), () => new Response('upstream private error', { status: 500 })]) {
    let calls = 0; const registry = createTranslationRegistry();
    const service = createPdfTranslationService(() => ({ model: 'cloud-model', key: 'do-not-use' }), async (url) => {
      calls++; assert.equal(url, `${config.baseUrl}/chat/completions`); return calls === 1 ? reply('第一段已生成但尚未完整。') : failure();
    }, registry, () => config);
    const events = await eventsOf(await service(request(input('First sentence. '.repeat(260)))));
    assert.equal(calls, 2);
    assert.ok(events.some(event => event.type === 'error'));
    assert.ok(!events.some(event => event.type === 'translated' || event.type === 'done'));
    assert.ok(!JSON.stringify(events).includes('upstream private error'));
    assert.equal(registry.jobs.size, 0);
  }
});

void test('cancelled selected paragraphs abort the in-flight fragment and release local concurrency without a partial result', async () => {
  const registry = createTranslationRegistry(); let calls = 0, activeSignal, began;
  const started = new Promise(resolve => { began = resolve; });
  const service = createPdfTranslationService(() => ({ model: 'cloud-model' }), async (_url, options) => {
    calls++;
    if (calls === 1) return reply('第一段');
    activeSignal = options.signal; began();
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
  }, registry, () => config);
  const response = await service(request(input('First sentence. '.repeat(260), { jobId: 'selected-one' })));
  await started;
  assert.equal((await service(request(input('Other selection', { jobId: 'selected-two' })))).status, 429);
  await service(request({ action: 'cancel', jobId: 'selected-one' }));
  const events = await eventsOf(response);
  assert.equal(activeSignal.aborted, true); assert.equal(calls, 2); assert.equal(registry.jobs.size, 0);
  assert.ok(!events.some(event => event.type === 'translated' || event.type === 'done'));
});
