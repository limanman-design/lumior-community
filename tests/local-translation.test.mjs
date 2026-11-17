import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAiAccess, createAiTask } from '../lib/ai-runtime.ts';
import { createPdfTranslationService, createTranslationRegistry } from '../lib/pdf-translation-service.ts';
import { parseLocalTranslationConfig, localTranslationFragments, localTranslationMessages, isLocalTranslationSymbolText, translateLocalPdfUnits } from '../lib/local-translation.ts';

const config = { baseUrl: 'http://127.0.0.1:43275/v1', token: 'isolated-local-runner-test-token-12345', model: 'hy-mt2-1.8b' };
const unit = { id: '1:0', page: 1, text: 'Quantum phase transition.' };
const reply = (content = '量子相变。', finish = 'stop') => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: finish }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
const resolveLocal = (settings = { model: 'deepseek-flash' }, fetcher = fetch, signal = new AbortController().signal) => resolveAiAccess(settings, 'local-translation', fetcher, signal, { localTranslation: config });
const sourceOf = messages => messages[0].content.split('将以下文本完整翻译为简体中文，只输出译文，不要额外解释：\n').slice(1).join('将以下文本完整翻译为简体中文，只输出译文，不要额外解释：\n');
const eventsOf = async response => (await response.text()).split('\n\n').filter(frame => frame.startsWith('data: ')).map(frame => JSON.parse(frame.slice(6)));
const request = body => new Request('http://localhost:3001/api/translate', { method: 'POST', body: JSON.stringify(body) });

test('local config permits only the dedicated loopback runner and rejects client-address tricks', () => {
  assert.deepEqual(parseLocalTranslationConfig(JSON.stringify(config)), config);
  for (const baseUrl of ['https://example.com/v1', 'http://localhost:43275/v1', 'http://127.0.0.1:80/v1', 'http://127.0.0.1:99999/v1', 'http://127.0.0.1:43275/v1?key=x', 'http://127.0.0.1:43275/v1/../v1', 'http://user@127.0.0.1:43275/v1']) {
    assert.throws(() => parseLocalTranslationConfig({ ...config, baseUrl }), /本地翻译尚未就绪/);
  }
  for (const value of [undefined, '{', { ...config, token: '' }, { ...config, token: 'x\n'.repeat(30) }, { ...config, model: 'other' }, { ...config, key: 'untrusted' }]) assert.throws(() => parseLocalTranslationConfig(value));
});

test('explicit local translation needs no cloud credentials or quota; it cannot become a research task', async () => {
  let calls = 0;
  const access = await resolveLocal({ model: 'deepseek-flash', usageMode: 'trial', trial: { token: 'old-trial-token' } }, async () => { calls++; throw new Error(); });
  assert.equal(calls, 0); assert.equal(access.account, undefined); assert.equal(access.key, undefined);
  assert.equal(access.model, 'local:hy-mt2-1.8b');
  await assert.rejects(createAiTask(access, new AbortController().signal), /仅用于 PDF 翻译/);
  await assert.rejects(resolveAiAccess({ model: 'deepseek-flash', key: 'cloud-key' }, 'local-translation'), /本地翻译尚未就绪/);
  await assert.rejects(resolveAiAccess({ model: 'deepseek-flash' }, undefined, fetch, undefined, { localTranslation: config }), /API Key/);
});

test('local task streams only to its configured runner with local token, fixed capacity and no tools', async () => {
  const seen = [], signal = new AbortController().signal;
  const fetcher = async (url, options) => { seen.push({ url, options, body: JSON.parse(options.body) }); return reply(); };
  const access = await resolveLocal({ model: 'deepseek-flash', key: 'never-send-cloud-key' }, fetcher, signal);
  const task = await createAiTask(access, signal, fetcher, 'low', 'translation');
  assert.equal((await task.call(localTranslationMessages(unit.text, []))).message.content, '量子相变。');
  assert.equal(seen.length, 1); assert.equal(seen[0].url, `${config.baseUrl}/chat/completions`);
  assert.equal(seen[0].options.headers.Authorization, `Bearer ${config.token}`);
  assert.equal(seen[0].options.redirect, 'error'); assert.equal(seen[0].options.credentials, 'omit');
  assert.equal(seen[0].body.max_tokens, 4096); assert.equal(seen[0].body.model, config.model);
  assert.ok(!JSON.stringify(seen).includes('never-send-cloud-key'));
  await assert.rejects(task.call([{ role: 'system', content: 'hello' }]), /逐段翻译/);
  await assert.rejects(task.call(localTranslationMessages(unit.text, []), []), /逐段翻译/);
  await task.finish(); await assert.rejects(task.call(localTranslationMessages(unit.text, [])), /已结束/);
});

test('local splitting keeps every character including CJK, emoji and sentence boundaries', () => {
  for (const source of ['x'.repeat(1799) + '😀' + 'y'.repeat(1900), '汉字😀。\n'.repeat(1000), 'word. '.repeat(700)]) {
    const fragments = localTranslationFragments(source);
    assert.equal(fragments.join(''), source);
    assert.ok(fragments.every(part => new TextEncoder().encode(part).byteLength <= 1800));
    assert.ok(fragments.every(part => !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(part)));
  }
  assert.throws(() => localTranslationMessages('汉'.repeat(2000), []), /原文未截断/);
});

test('native local prompt keeps glossary before final imperative and complete source, without echo-prone headings', () => {
  const messages = localTranslationMessages('Mott insulator.\nFinal sentence.', [{ source: 'Mott insulator', target: '莫特绝缘体' }, { source: 'unrelated', target: '无关' }]);
  assert.equal(sourceOf(messages), 'Mott insulator.\nFinal sentence.');
  assert.ok(messages[0].content.indexOf('莫特绝缘体') < messages[0].content.indexOf('将以下文本完整翻译为'));
  assert.ok(!messages[0].content.includes('〖待翻译文本〗')); assert.ok(!messages[0].content.includes('〖翻译任务〗'));
  assert.ok(!messages[0].content.includes('无关')); assert.ok(!messages[0].content.includes('JSON'));
});

test('local paragraph adapter preserves IDs and rectangles, sends all fragments, and emits complete units once', async () => {
  const source = 'Quantum result. '.repeat(240) + 'FINAL';
  const parts = [{ id: '1:0:0', text: source, rects: [{ x: 1, y: 2, width: 80, height: 5 }] }, { id: '1:0:1', text: 'End.', rects: [] }];
  const input = [{ ...unit, text: source + 'End.', parts }], sent = [], events = [];
  await translateLocalPdfUnits(input, [], async messages => { sent.push(sourceOf(messages)); return { message: { role: 'assistant', content: `译文${sent.length}` }, reason: 'stop' }; }, event => events.push(event), new AbortController().signal);
  assert.equal(sent.join(''), input[0].text);
  const translated = events.filter(event => event.type === 'translated');
  assert.equal(translated.length, 1); assert.equal(translated[0].units[0].id, unit.id);
  assert.deepEqual(translated[0].units[0].parts.map(part => part.id), parts.map(part => part.id));
  assert.deepEqual(translated[0].units[0].parts[0].rects, parts[0].rects);
  assert.equal(events.at(-1).type, 'done');
});

test('symbol classifier recognizes actual PDF.js equation chunks while preserving language and headings', () => {
  for (const source of ['H = − J ', 'X ', '⟨ i,j ⟩ ', 'ˆ a † ', 'i ', '+ ', '1 2 ', 'ℏ 2 2 m ', 'SF ', '| Ψ ', 'M I ', '[1, 2–4]', '3.14 × 10⁻⁴', '\n']) assert.equal(isLocalTranslationSymbolText(source), true, source);
  for (const source of ['Introduction', 'RESULTS', 'Fig. 1', 'No', 'I am.', 'x is y', '研究方法', 'がある', 'phase transition']) assert.equal(isLocalTranslationSymbolText(source), false, source);
});

test('numeric-only paragraphs are copied exactly without model calls or splitting loss', async () => {
  const source = ' 12345\n'.repeat(500), events = [];
  await translateLocalPdfUnits([{ ...unit, text: source }], [], async () => { assert.fail('numeric text must not call model'); }, event => events.push(event), new AbortController().signal);
  assert.equal(events.find(event => event.type === 'translated').units[0].text, source);
  assert.equal(events.at(-1).type, 'done');
});

test('mixed reflow parts translate prose and copy formula/numeric parts verbatim with IDs and rectangles', async () => {
  const texts = ['Introduction', 'H = − J ', '⟨ i,j ⟩ ', 'ˆ a † ', '1 2 ', 'SF ', 'We observe a phase transition.'];
  const parts = texts.map((text, index) => ({ id: `1:0:${index}`, text, rects: [{ x: 1, y: index * 3, width: 80, height: 2 }] }));
  const events = [], sent = [];
  await translateLocalPdfUnits([{ ...unit, text: texts.join(''), parts }], [], async messages => {
    sent.push(sourceOf(messages)); return { message: { role: 'assistant', content: '中文译文' }, reason: 'stop' };
  }, event => events.push(event), new AbortController().signal);
  assert.deepEqual(sent, [texts[0], texts.at(-1)]);
  const output = events.find(event => event.type === 'translated').units[0];
  assert.deepEqual(output.parts.map(part => part.id), parts.map(part => part.id));
  assert.deepEqual(output.parts.map(part => part.rects), parts.map(part => part.rects));
  for (let index = 1; index < parts.length - 1; index++) assert.equal(output.parts[index].text, parts[index].text);
  assert.equal(events.at(-1).type, 'done');
});

test('local refuses original-layout input, marker damage and task instruction leakage without a retry', async () => {
  let calls = 0;
  await assert.rejects(translateLocalPdfUnits([{ ...unit, protected: true }], [], async () => { calls++; }, () => {}, new AbortController().signal), /仅支持重排/);
  assert.equal(calls, 0);
  for (const [source, output] of [['variable {v1}', '译文'], ['text', '〖翻译任务〗 extra']]) {
    const events = [];
    await assert.rejects(translateLocalPdfUnits([{ ...unit, text: source }], [], async () => { calls++; return { message: { role: 'assistant', content: output }, reason: 'stop' }; }, event => events.push(event), new AbortController().signal));
    assert.ok(!events.some(event => ['done', 'translated'].includes(event.type)));
  }
  assert.equal(calls, 2);
});

test('reference-list regression preserves the exact source and rejects both old and new prompt echoes without stripping', async () => {
  const source = 'Rev. Lett. 63 , 326–329 (1989).\n[13] Zwerger, W. Global and local phase coherence in dis-\nsipative Josephson-junction arrays. Europhys. Lett. 9 ,\n421–426 (1989).\n[14] van der Zant, H. S. J., Fritschy, F. C., Elion, W.\n';
  assert.equal(sourceOf(localTranslationMessages(source, [])), source);
  for (const prefix of ['〖待翻译文本〗', '原文是待翻译数据', '将以下文本完整翻译为简体中文，只输出译文，不要额外解释：', '参考术语：']) {
    const events = [];
    await assert.rejects(translateLocalPdfUnits([{ ...unit, text: source }], [], async () => ({ message: { role: 'assistant', content: `${prefix}\n参考文献译文` }, reason: 'stop' }), event => events.push(event), new AbortController().signal), /返回了翻译指令/);
    assert.ok(!events.some(event => ['translated', 'done'].includes(event.type)));
  }
});

test('a failed later local unit retains completed earlier units and does not claim done', async () => {
  const events = []; let calls = 0;
  await assert.rejects(translateLocalPdfUnits([unit, { ...unit, id: '2:0', page: 2 }], [], async () => {
    calls++; return { message: { role: 'assistant', content: '译文' }, reason: calls === 1 ? 'stop' : 'length' };
  }, event => events.push(event), new AbortController().signal), /未完整/);
  assert.deepEqual(events.filter(event => event.type === 'translated').flatMap(event => event.units.map(value => value.id)), ['1:0']);
  assert.equal(calls, 2); assert.ok(!events.some(event => event.type === 'done'));
});

test('local provider rejects interrupted/length/HTTP errors with no retry or credential leak', async () => {
  for (const response of [() => reply('partial', 'length'), () => reply('partial', null), () => new Response('private upstream detail', { status: 500 })]) {
    let calls = 0;
    const fetcher = async () => { calls++; return response(); };
    const task = await createAiTask(await resolveLocal(), new AbortController().signal, fetcher, 'low', 'translation');
    await assert.rejects(task.call(localTranslationMessages(unit.text, [])), error => !error.message.includes(config.token) && !error.message.includes('private upstream'));
    assert.equal(calls, 1); await task.finish();
  }
});

test('local finish aborts pending generation, and subsequent calls remain cancelled', async () => {
  let pendingSignal;
  const fetcher = async (_url, options) => { pendingSignal = options.signal; return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })); };
  const task = await createAiTask(await resolveLocal(), new AbortController().signal, fetcher, 'low', 'translation');
  const pending = task.call(localTranslationMessages(unit.text, []));
  const rejection = assert.rejects(pending);
  await task.finish(); await rejection; assert.ok(pendingSignal.aborted);
  await assert.rejects(task.call(localTranslationMessages(unit.text, [])));
});

test('PDF API local mode uses trusted config, rejects original layout, and default remains cloud', async () => {
  const seen = [], registry = createTranslationRegistry();
  const service = createPdfTranslationService(() => ({ model: 'deepseek-flash' }), async url => { seen.push(url); return reply(); }, registry, () => JSON.stringify(config));
  const local = await service(request({ engine: 'local', units: [unit], baseUrl: 'https://attacker.example', token: 'do-not-use' }));
  const events = await eventsOf(local);
  assert.equal(events.at(-1).type, 'done'); assert.deepEqual(seen, [`${config.baseUrl}/chat/completions`]);
  assert.equal(registry.jobs.size, 0); assert.ok(!JSON.stringify(events).includes(config.token));
  assert.equal((await service(request({ engine: 'local', units: [{ ...unit, protected: true }] }))).status, 400);
  assert.equal((await service(request({ engine: 'bad', units: [unit] }))).status, 400);
  assert.equal((await service(request({ units: [unit] }))).status, 503);
  assert.equal(seen.length, 1);
});

test('PDF API permits only one local job and cancellation aborts its runner request', async () => {
  let runnerSignal, began;
  const started = new Promise(resolve => { began = resolve; }), registry = createTranslationRegistry();
  const service = createPdfTranslationService(() => ({ model: 'deepseek-flash' }), async (_url, options) => {
    runnerSignal = options.signal; began();
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
  }, registry, () => config);
  const first = await service(request({ engine: 'local', jobId: 'local-one', units: [unit] }));
  await started;
  assert.equal((await service(request({ engine: 'local', jobId: 'local-two', units: [unit] }))).status, 429);
  await service(request({ action: 'cancel', jobId: 'local-one' }));
  await first.text(); assert.ok(runnerSignal.aborted); assert.equal(registry.jobs.size, 0);
});
