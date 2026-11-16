import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import { sseData } from '../lib/ai-stream.ts';
import * as translations from '../lib/pdf-translation.ts';

const compile = name => ts.transpileModule(readFileSync(new URL(`../app/${name}.ts`, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const scripts = Object.fromEntries(['use-pdf-selection-translation', 'use-pdf-translation', 'local-translation-session'].map(name => [name, compile(name)]));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { resolve, reject, promise }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
async function until(condition) { for (let i = 0; i < 100 && !condition(); i++) await flush(); assert.ok(condition(), 'expected asynchronous hook state'); }
const response = events => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
const translationEvent = (units, text = '译文内容。') => ({ type: 'translated', sourceLanguage: '英语', glossary: [], units: units.map(unit => ({ ...unit, text })) });
const done = (units, text) => response([translationEvent(units, text), { type: 'done' }]);

function fixture({ state = { supported: true, installed: true, status: 'ready' }, getState, startRunner = async () => {}, stopRunner = async () => {}, respond = (_url, body) => done(body.units) } = {}) {
  const starts = [], stops = [], calls = [], cancelled = [], listeners = new Map(), cancellations = new Set();
  let activeReader, generation = 0, currentLease;
  const cell = initial => { const index = activeReader.cursor++; return activeReader.cells[index] ??= initial(); };
  const react = {
    useState(initial) { const owner = activeReader, entry = cell(() => ({ value: typeof initial === 'function' ? initial() : initial })); return [entry.value, next => { owner.writes++; entry.value = typeof next === 'function' ? next(entry.value) : next; }]; },
    useRef(value) { return cell(() => ({ current: value })); },
    useEffect(effect, deps) {
      const entry = cell(() => ({ deps: undefined, cleanup: undefined }));
      if (!entry.deps || deps.some((value, index) => value !== entry.deps[index])) activeReader.effects.push(() => { entry.cleanup?.(); entry.cleanup = effect(); entry.deps = deps; });
    },
  };
  const bridge = {
    getLocalTranslationState: async () => getState ? getState() : { ...state },
    startLocalTranslation: async lease => { starts.push(lease); if (currentLease) throw new Error('Already busy'); currentLease = lease; state.status = 'starting'; await startRunner(lease); if (currentLease === lease) state.status = 'running'; },
    stopLocalTranslation: async lease => { stops.push(lease); await stopRunner(lease); if (currentLease === lease) { currentLease = undefined; state.status = 'ready'; } },
  };
  const dependencies = {
    react, './desktop-bridge': { getDesktopBridge: () => bridge },
    './i18n': { useI18n: () => ({ t: english => english }) }, './pdf-system-messages': { pdfSystemMessage: value => value },
    '../lib/ai-stream': { sseData }, '../lib/pdf-translation': translations,
    './pdf-translation-session': {
      translationOwner: () => 'same-tab-reader', nextTranslationGeneration: () => ++generation,
      cancelTranslationJob: (...args) => { cancelled.push(args); const operation = Promise.resolve(); cancellations.add(operation); void operation.finally(() => cancellations.delete(operation)); return operation; },
      waitForTranslationCancellation: () => Promise.allSettled(cancellations),
    },
    './feature-flags': { PDF_TRANSLATION_ENABLED: false }, './local-translation-settings': { selectedTranslationEngine: () => 'local' },
    './document-reading-store': { readingKey: card => card.id, readDocument: async () => ({ pages: [{ page: 1, text: 'The full source PDF.' }], total: 1, emptyPages: [] }) },
    './pdf-layout-client': {},
  };
  const load = name => {
    const loaded = { exports: {} };
    vm.runInNewContext(scripts[name], {
      exports: loaded.exports, require: name => { assert.ok(name in dependencies, name); return dependencies[name]; },
      AbortController, crypto: { randomUUID }, setInterval: () => 1, clearInterval() {},
      window: { addEventListener: (type, fn) => { const handlers = listeners.get(type) || new Set(); handlers.add(fn); listeners.set(type, handlers); }, removeEventListener: (type, fn) => listeners.get(type)?.delete(fn) },
      fetch: async (url, options) => { const body = JSON.parse(options.body); calls.push({ url, body, signal: options.signal }); return respond(url, body, options, calls.length); },
    });
    return loaded.exports;
  };
  dependencies['./local-translation-session'] = load('local-translation-session');
  const selectionHook = load('use-pdf-selection-translation').usePdfSelectionTranslation;
  const fullHook = load('use-pdf-translation').usePdfTranslation;
  return {
    calls, starts, stops, cancelled, state,
    reader(key = 'source-pdf', full = false) {
      const reader = { cells: [], cursor: 0, effects: [], writes: 0, key };
      reader.render = (nextKey = reader.key) => { reader.key = nextKey; reader.cursor = 0; activeReader = reader; reader.hook = full ? fullHook({ id: nextKey, pdf: { url: 'blob:test' } }) : selectionHook(nextKey); for (const effect of reader.effects.splice(0)) effect(); return reader.hook; };
      reader.unmount = () => { for (const entry of reader.cells) entry.cleanup?.(); };
      reader.render(); return reader;
    },
    pagehide: () => { for (const fn of listeners.get('pagehide') || []) fn(); },
  };
}

void test('selected sentence uses only the local scoped request, preserves full text, and closes its runner', async () => {
  const app = fixture(), reader = app.reader(), source = '  This is a complete sentence.\n中文 😀  ';
  await reader.hook.start(source, 7);
  assert.equal(app.calls.length, 1); assert.equal(app.calls[0].url, '/api/translate');
  const body = app.calls[0].body;
  assert.equal(body.engine, 'local'); assert.equal(body.scope, 'selection');
  assert.deepEqual(body.units, [{ id: '7:0', page: 7, text: source }]);
  assert.equal(body.ownerId, 'same-tab-reader-selection');
  assert.match(app.starts[0], /^[a-f0-9]{32}$/); assert.deepEqual(app.stops, app.starts);
  assert.equal(reader.render().result.status, 'done'); assert.equal(reader.hook.result.source, source); assert.equal(reader.hook.result.text, '译文内容。');
  assert.equal(reader.hook.busy, false); assert.equal(app.cancelled[0][1], body.ownerId);
});

void test('missing download, unsupported computer and another running job do not start, cancel or fetch', async () => {
  for (const [state, expected] of [
    [{ supported: true, installed: false, status: 'not-installed' }, 'needs-install'],
    [{ supported: true, installed: false, status: 'downloading' }, 'needs-install'],
    [{ supported: false, installed: false, status: 'not-installed' }, 'error'],
    [{ supported: true, installed: true, status: 'running' }, 'error'],
  ]) {
    const app = fixture({ state }), reader = app.reader(); await reader.hook.start('Translate this sentence.', 1);
    assert.equal(reader.render().result.status, expected); assert.equal(reader.hook.busy, false);
    assert.equal(app.starts.length + app.stops.length + app.calls.length + app.cancelled.length, 0);
  }
});

void test('oversized or empty selection is rejected before any runtime operation without trimming its source', async () => {
  const app = fixture(), reader = app.reader();
  for (const text of ['   ', '😀'.repeat(2251)]) { await reader.hook.start(text, 1); assert.equal(reader.render().result.status, 'error'); assert.equal(reader.hook.result.source, text); }
  assert.equal(app.starts.length + app.calls.length + app.cancelled.length, 0);
});

void test('unmount during model startup releases its own lease and performs no model request', async () => {
  const startup = deferred(), app = fixture({ startRunner: () => startup.promise }), reader = app.reader();
  const running = reader.hook.start('Pending sentence.', 1); await until(() => app.starts.length === 1);
  reader.unmount(); const writes = reader.writes; startup.resolve(); await running;
  assert.equal(app.calls.length, 0); assert.ok(app.stops.includes(app.starts[0])); assert.equal(reader.writes, writes);
});

void test('cancelled text never becomes a completed result and a retry waits for desktop release', async () => {
  const pending = deferred(), released = deferred(); let firstLease;
  const app = fixture({
    respond: (_url, body, _options, count) => count === 1 ? pending.promise : done(body.units, '新的译文。'),
    stopRunner: lease => { firstLease ??= lease; return lease === firstLease ? released.promise : Promise.resolve(); },
  });
  const reader = app.reader(), first = reader.hook.start('First sentence.', 1);
  await until(() => app.calls.length === 1); reader.hook.cancel();
  assert.equal(reader.render().result.status, 'cancelled'); assert.ok(app.calls[0].signal.aborted);
  const second = reader.hook.start('Second sentence.', 1); await flush(); assert.equal(app.starts.length, 1);
  released.resolve(); await second;
  pending.resolve(done(app.calls[0].body.units, '迟到的旧译文。')); await first;
  assert.equal(reader.render().result.text, '新的译文。'); assert.equal(reader.hook.result.source, 'Second sentence.');
  assert.equal(app.starts.length, 2); assert.notEqual(app.starts[0], app.starts[1]);
});

void test('source change cancels outstanding selection and cannot receive a stale result', async () => {
  const pending = deferred(), app = fixture({ respond: () => pending.promise }), reader = app.reader();
  const running = reader.hook.start('Old document text.', 2); await until(() => app.calls.length === 1);
  reader.render('different-document'); assert.equal(reader.render().result, null);
  pending.resolve(done(app.calls[0].body.units)); await running;
  assert.equal(reader.render().result, null); assert.ok(app.calls[0].signal.aborted);
});

void test('pagehide cancels active generation and leaves a restored page usable', async () => {
  const pending = deferred(), app = fixture({ respond: () => pending.promise }), reader = app.reader();
  const running = reader.hook.start('Leaving page.', 1); await until(() => app.calls.length === 1);
  app.pagehide(); assert.equal(reader.render().busy, false); assert.equal(reader.hook.result.status, 'cancelled');
  pending.resolve(done(app.calls[0].body.units)); await running;
  assert.equal(reader.render().result.status, 'cancelled'); assert.ok(app.calls[0].signal.aborted);
});

void test('incomplete, mismatched and malformed responses never expose unverified translated text', async () => {
  const invalid = [
    units => response([translationEvent(units)]),
    () => response([{ type: 'done' }]),
    units => response([translationEvent([{ ...units[0], id: '2:0' }]), { type: 'done' }]),
    units => response([translationEvent([{ ...units[0], parts: [{ id: '1:0:0', text: 'extra' }] }]), { type: 'done' }]),
    units => response([translationEvent(units), translationEvent(units), { type: 'done' }]),
    () => new Response('invalid response'),
    () => Response.json({ error: 'Local model unavailable' }, { status: 503 }),
  ];
  for (const reply of invalid) {
    const app = fixture({ respond: (_url, body) => reply(body.units) }), reader = app.reader(); await reader.hook.start('Source text.', 1);
    assert.equal(reader.render().result.status, 'error'); assert.equal(reader.hook.result.text, ''); assert.equal(app.calls.length, 1);
    assert.deepEqual(app.stops, app.starts); assert.equal(reader.hook.busy, false);
  }
});

void test('selection does not interrupt a full-PDF run and both readers share old-lease cleanup', async () => {
  const pending = deferred(), release = deferred(); let wholeLease;
  const app = fixture({
    respond: (_url, body) => body.scope === 'selection' ? done(body.units) : pending.promise,
    stopRunner: lease => { wholeLease ??= lease; return lease === wholeLease ? release.promise : Promise.resolve(); },
  });
  const whole = app.reader('whole', true), wholeRun = whole.hook.start(); await until(() => app.calls.length === 1);
  const selected = app.reader('whole'); await selected.hook.start('Selected sentence.', 1);
  assert.equal(selected.render().result.status, 'error'); assert.equal(app.starts.length, 1); assert.equal(app.stops.length, 0); assert.equal(app.cancelled.length, 0);
  whole.hook.stop();
  const selectedRun = selected.hook.start('Selected sentence.', 1); await flush(); assert.equal(app.starts.length, 1);
  release.resolve(); await selectedRun;
  pending.resolve(done(app.calls[0].body.units)); await wholeRun;
  assert.equal(selected.render().result.status, 'done');
  assert.equal(app.calls[0].body.ownerId, 'same-tab-reader'); assert.equal(app.calls[1].body.ownerId, 'same-tab-reader-selection');
});
