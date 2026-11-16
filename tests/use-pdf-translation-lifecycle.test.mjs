import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import * as translations from '../lib/pdf-translation.ts';
import { sseData } from '../lib/ai-stream.ts';

const compiled = ts.transpileModule(readFileSync(new URL('../app/use-pdf-translation.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
async function until(condition) { for (let i = 0; i < 50 && !condition(); i++) await flush(); assert.ok(condition(), 'expected async reader state'); }
const pages = [1, 2, 3].map(page => ({ page, text: `Source page ${page}.`, paragraphs: [{ start: 0, end: 14, rects: [] }] }));
const translated = unit => ({ ...unit, text: `译文第 ${unit.page} 页。`, parts: unit.parts?.map(part => ({ ...part, text: `译文 ${part.id}。` })) });
const event = units => ({ type: 'translated', units: units.map(translated), sourceLanguage: '英语', glossary: [] });
function channel() {
  let stream;
  const response = new Response(new ReadableStream({ start(controller) { stream = controller; } }), { headers: { 'content-type': 'text/event-stream' } });
  return { response, send: value => stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`)) };
}
function finished(units) { const stream = channel(); stream.send(event(units)); stream.send({ type: 'done' }); return stream.response; }

// Execute the actual hook with isolated React state cells. Persistence is the
// real onChange snapshot, reloaded through JSON rather than a shared reference.
function fixture({ sourcePages = pages, respond = (_url, body) => finished(body.units), startRunner = async () => {}, stopRunner = async () => {}, cancel = async () => {} } = {}) {
  const module = { exports: {} }, calls = [], starts = [], stops = [], cancellations = new Set();
  let active;
  const cell = initial => { const index = active.cursor++; return active.cells[index] ??= initial(); };
  const react = {
    useState(initial) { const state = cell(() => ({ value: typeof initial === 'function' ? initial() : initial })); return [state.value, next => { state.value = typeof next === 'function' ? next(state.value) : next; }]; },
    useRef(value) { return cell(() => ({ current: value })); },
    useEffect(effect, deps) {
      const state = cell(() => ({ deps: undefined, cleanup: undefined }));
      if (!state.deps || deps.some((value, index) => value !== state.deps[index])) {
        active.effects.push(() => { state.cleanup?.(); state.cleanup = effect(); state.deps = deps; });
      }
    },
  };
  const dependencies = {
    react,
    './feature-flags': { PDF_TRANSLATION_ENABLED: false },
    './local-translation-settings': { selectedTranslationEngine: () => 'local' },
    './desktop-bridge': { getDesktopBridge: () => ({ startLocalTranslation: async lease => { starts.push(lease); await startRunner(lease); }, stopLocalTranslation: async lease => { stops.push(lease); await stopRunner(lease); } }) },
    './i18n': { useI18n: () => ({ t: english => english }) },
    './pdf-system-messages': { pdfSystemMessage: value => value },
    './document-reading-store': { readingKey: card => card.id, readDocument: async () => ({ pages: sourcePages, total: sourcePages.length, emptyPages: [] }) },
    '../lib/ai-stream': { sseData }, '../lib/pdf-translation': translations,
    './pdf-translation-session': {
      translationOwner: () => 'reader', nextTranslationGeneration: () => calls.length + 1,
      cancelTranslationJob: (...args) => { const promise = Promise.resolve(cancel(...args)); cancellations.add(promise); void promise.finally(() => cancellations.delete(promise)); return promise; },
      waitForTranslationCancellation: () => Promise.allSettled(cancellations),
    },
    './pdf-layout-client': { preparePdfLayout: () => assert.fail('must not use original layout'), finishPdfLayout: () => assert.fail('must not use original layout') },
  };
  const leaseModule = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../app/local-translation-session.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports: leaseModule.exports, require: name => dependencies[name] });
  dependencies['./local-translation-session'] = leaseModule.exports;
  vm.runInNewContext(compiled, {
    module, exports: module.exports, require: name => { assert.ok(name in dependencies, name); return dependencies[name]; },
    AbortController, crypto: { randomUUID }, setInterval: () => 1, clearInterval() {}, window: { addEventListener() {}, removeEventListener() {} },
    fetch: async (url, options) => { const body = JSON.parse(options.body); calls.push({ url, body, signal: options.signal }); return respond(url, body, options, calls.length); },
  });
  return {
    calls, starts, stops,
    reader(saved) {
      const reader = { cells: [], cursor: 0, effects: [], saves: [], card: { id: 'paper', pdf: { url: 'blob:paper', translation: saved && structuredClone(saved) } } };
      reader.render = () => {
        reader.cursor = 0; active = reader;
        reader.hook = module.exports.usePdfTranslation(reader.card, value => { reader.saves.push(value); reader.card = { ...reader.card, pdf: { ...reader.card.pdf, translation: value } }; });
        for (const effect of reader.effects.splice(0)) effect();
        return reader.hook;
      };
      reader.unmount = () => { for (const state of reader.cells) state.cleanup?.(); };
      reader.render(); return reader;
    },
  };
}

test('pause persists completed PDF units; a newly opened reader continues only remaining pages and completion survives reload', async () => {
  const first = channel();
  const f = fixture({ respond: (_url, body, _options, count) => count === 1 ? first.response : finished(body.units) });
  const reader = f.reader(), running = reader.hook.start();
  await until(() => f.calls.length === 1);
  first.send(event([f.calls[0].body.units[0]]));
  await until(() => reader.saves.at(-1)?.units.length === 1);
  reader.hook.stop();
  await running;
  const partial = JSON.parse(JSON.stringify(reader.card.pdf.translation));
  assert.equal(partial.complete, false); assert.deepEqual(partial.units.map(unit => unit.id), ['1:0']);
  assert.equal(reader.render().busy, false);
  const reopened = f.reader(partial);
  await reopened.hook.start('reflow', true); // UI's Continue action uses this flag.
  assert.deepEqual(f.calls[1].body.units.map(unit => unit.id), ['2:0', '3:0']);
  const saved = JSON.parse(JSON.stringify(reopened.card.pdf.translation));
  assert.equal(saved.complete, true); assert.equal(saved.units.length, 3);
  assert.deepEqual(saved.units[0], partial.units[0], 'the completed page is not regenerated');
  const again = f.reader(saved);
  await again.hook.start();
  assert.equal(f.calls.length, 2); assert.equal(f.starts.length, 2, 'saved complete PDF opens without inference');
  assert.equal(again.hook.translation.complete, true);
});

test('quickly reopened reader waits for cancellation and local lease release before starting another runner', async () => {
  const stream = channel(), released = deferred(), cancelled = deferred();
  let firstLease;
  const f = fixture({
    respond: (_url, body, _options, count) => count === 1 ? stream.response : finished(body.units),
    stopRunner: lease => { firstLease ??= lease; return lease === firstLease ? released.promise : Promise.resolve(); },
    cancel: () => cancelled.promise,
  });
  const old = f.reader(), oldRun = old.hook.start();
  await until(() => f.calls.length === 1);
  old.unmount();
  const reopened = f.reader(), nextRun = reopened.hook.start();
  await until(() => f.stops.length === 1);
  assert.equal(f.starts.length, 1);
  cancelled.resolve(); await flush();
  assert.equal(f.starts.length, 1, 'backend cancellation alone does not release the desktop lease');
  released.resolve();
  await Promise.all([oldRun, nextRun]);
  assert.equal(f.starts.length, 2);
  assert.equal(reopened.card.pdf.translation.complete, true);
  assert.equal(new Set(f.starts).size, 2);
});

test('resume retranslates a unit with missing paragraph mappings while preserving fully saved units', async () => {
  const splitPages = [{ page: 1, text: 'First. Second.', paragraphs: [{ start: 0, end: 6, rects: [] }, { start: 6, end: 14, rects: [] }] }, pages[1]];
  const sourceUnits = translations.translationUnits(splitPages), incomplete = translated(sourceUnits[0]);
  incomplete.parts = incomplete.parts.slice(0, 1);
  const saved = { version: 1, sourceKey: 'paper:zh-CN:1', target: 'zh-CN', sourceLanguage: '英语', model: 'local:hy-mt2-1.8b', mode: 'reflow', units: [incomplete, translated(sourceUnits[1])], glossary: [], totalPages: 2, emptyPages: [], complete: false, updatedAt: 1 };
  const f = fixture({ sourcePages: splitPages }), reader = f.reader(saved);
  await reader.hook.start('reflow', true);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].body.units.map(unit => unit.id), ['1:0']);
  assert.equal(f.calls[0].body.units[0].parts.length, 2);
  assert.equal(reader.card.pdf.translation.complete, true);
  assert.deepEqual(reader.card.pdf.translation.units[1], saved.units[1]);
});

test('a later request error keeps earlier PDF translation and retry does not retransmit it', async () => {
  const partial = channel();
  const f = fixture({ respond: (_url, body, _options, count) => count === 1 ? partial.response : finished(body.units) });
  const reader = f.reader(), running = reader.hook.start();
  await until(() => f.calls.length === 1);
  partial.send(event([f.calls[0].body.units[0]]));
  partial.send({ type: 'error', message: 'Synthetic runner interruption' });
  await running;
  assert.equal(reader.card.pdf.translation.units.length, 1);
  assert.equal(reader.card.pdf.translation.complete, false);
  assert.equal(reader.render().busy, false);
  await reader.hook.start('reflow', true);
  assert.deepEqual(f.calls[1].body.units.map(unit => unit.id), ['2:0', '3:0']);
  assert.equal(reader.card.pdf.translation.complete, true);
});

test('pausing during runner startup performs no PDF request and does not erase a saved partial translation', async () => {
  const startup = deferred(), source = translations.translationUnits(pages);
  const saved = { version: 1, sourceKey: 'paper:zh-CN:1', target: 'zh-CN', sourceLanguage: '英语', model: 'local:hy-mt2-1.8b', mode: 'reflow', units: [translated(source[0])], glossary: [], totalPages: 3, emptyPages: [], complete: false, updatedAt: 1 };
  const f = fixture({ startRunner: () => startup.promise }), reader = f.reader(saved), running = reader.hook.start();
  await until(() => f.starts.length === 1);
  reader.hook.stop(); startup.resolve(); await running;
  assert.equal(f.calls.length, 0);
  assert.deepEqual(reader.card.pdf.translation.units, saved.units);
  assert.equal(reader.card.pdf.translation.complete, false);
  assert.equal(reader.render().busy, false);
  assert.ok(f.stops.length >= 1);
});
