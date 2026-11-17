import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { awaitReadingTask, pdfPageText } from '../app/document-reading.ts';
import { pdfParagraphs } from '../lib/pdf-paragraphs.ts';
import { inlineGlyphWidths, prepareInlineFormulaPages } from '../lib/pdf-inline-formulas.ts';
import { translationUnits } from '../lib/pdf-translation.ts';

const compiled = ts.transpileModule(readFileSync(new URL('../app/pdf-translation-formulas.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const region = (id = 'formula:1:1:0:0', rect = { x: 20, y: 30, width: 40, height: 5 }) => ({ id, page: 1, partIds: [`part:${id}`], rect });
const translation = (units = [{ id: '1:0', page: 1, text: 'H = 1', parts: [] }]) => ({ units });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(test) { for (let i = 0; i < 30 && !test(); i++) await tick(); assert.ok(test()); }

function fixture(options = {}) {
  const compiledModule = { exports: {} }, calls = { acquired: [], releases: 0, pages: [], text: [], renders: [], cancelled: 0, canvases: [], detections: [] };
  let regions = options.regions ?? [region()], failBlob = false;
  const sourcePages = new Map();
  function getPage(number) {
    calls.pages.push(number);
    if (options.getPage) return options.getPage(number);
    const details = options.pageDetails?.[number] ?? options;
    if (!sourcePages.has(number)) sourcePages.set(number, {
      rotate: details.rotation ?? 0, userUnit: details.userUnit ?? 1, view: details.view ?? [0,0,600,800],
      getViewport({ scale }) { return { width: (details.width ?? 600) * scale, height: (details.height ?? 800) * scale, convertToViewportPoint: (x, y) => [x, 800 - y] }; },
      async getTextContent() { calls.text.push(number); if (options.readError) throw new Error('source unavailable'); return { items: details.items ?? [{ str: 'H = 1', transform: [10, 0, 0, 10, 120, 500], width: 45, height: 10 }], styles: {} }; },
      async getOperatorList() { return { fnArray: [], argsArray: [] }; },
      render(args) {
        calls.renders.push({ ...args, width: args.canvas.width, height: args.canvas.height });
        return { promise: options.render?.(args) ?? Promise.resolve(), cancel() { calls.cancelled++; options.cancel?.(); } };
      },
    });
    return Promise.resolve(sourcePages.get(number));
  }
  const pdf = { numPages: options.numPages ?? 8, getPage };
  const document = {
    createElement(name) {
      assert.equal(name, 'canvas');
      const canvas = { width: 0, height: 0, toBlob(callback, format) { assert.equal(format, 'image/png'); if (options.encode) return options.encode(callback); callback(failBlob ? null : new Blob([new Uint8Array([137, 80, 78, 71])], { type: format })); } };
      calls.canvases.push(canvas); return canvas;
    },
  };
  const dependencies = {
    'pdfjs-dist': { OPS: { setFont: 37, showText: 44 } },
    '../lib/pdf-inline-formulas.ts': { inlineGlyphWidths, prepareInlineFormulaPages },
    '../lib/pdf-translation.ts': { translationUnits }, '../lib/pdf-paragraphs.ts': { pdfParagraphs },
    './document-reading.ts': { awaitReadingTask, pdfPageText },
    '../lib/pdf-formula-regions.ts': { findPdfFormulaRegions(source, saved, sizes) { calls.detections.push({ source, saved, sizes }); return source.length ? regions : []; } },
    './pdf-runtime': { acquirePdf(url) { calls.acquired.push(url); return { promise: options.loading ?? Promise.resolve(pdf), release() { calls.releases++; } }; } },
  };
  vm.runInNewContext(compiled, { module: compiledModule, exports: compiledModule.exports, require(name) { assert.ok(name in dependencies, name); return dependencies[name]; }, document, DOMException, Uint8Array, Blob });
  return { prepare: compiledModule.exports.preparePdfInlineTranslation, load: compiledModule.exports.loadTranslationFormulas, loadSource: compiledModule.exports.loadTranslationSource, calls, pdf, setRegions(value) { regions = value; }, failBlob(value) { failBlob = value; } };
}

test('formula crops render source pixels at high density without annotations or a whole-page canvas', async () => {
  const f = fixture(), saved = translation(), before = structuredClone(saved);
  const images = await f.load('blob:original', saved);
  assert.equal(images.length, 1); assert.equal(images[0].width, 240); assert.equal(images[0].height, 40);
  assert.deepEqual([...images[0].png], [137, 80, 78, 71]);
  const render = f.calls.renders[0];
  assert.equal(render.annotationMode, 0); assert.equal(render.viewport.width, 2400);
  assert.deepEqual([...render.transform], [1, 0, 0, 1, -480, -960]);
  assert.equal(render.width, 960); assert.equal(render.height, 160);
  assert.equal(f.calls.canvases[0].width, 0); assert.equal(f.calls.canvases[0].height, 0);
  assert.deepEqual(f.calls.acquired, ['blob:original']); assert.equal(f.calls.releases, 1);
  assert.equal(f.calls.detections[0].source[0].text, 'H = 1');
  assert.equal(f.calls.detections[0].source[0].parts[0].id, '1:0:0');
  assert.deepEqual(saved, before);
});

test('incremental previews reuse completed source crops, read only saved pages, and keep source handles balanced', async () => {
  const f = fixture();
  await f.load('blob:original', translation());
  await f.load('blob:original', translation([{ id: '1:0', page: 1, text: '译文更新' }, { id: '3:0', page: 3, text: '第三页' }]));
  assert.equal(f.calls.renders.length, 1); assert.deepEqual(f.calls.text, [1, 3]);
  assert.equal(f.calls.releases, 2);
  const f2 = fixture({ regions: [] });
  assert.equal((await f2.load('blob:other', translation())).length, 0);
  assert.equal(f2.calls.renders.length, 0); assert.equal(f2.calls.releases, 1);
  assert.equal((await f2.load('blob:empty', translation([]))).length, 0);
  assert.equal(f2.calls.acquired.length, 1);
});

test('abort while rendering cancels the task, frees pixels and allows a clean retry', async () => {
  const pending = deferred(); let first = true;
  const f = fixture({ render() { if (first) { first = false; return pending.promise; } }, cancel() { pending.reject(new Error('render cancelled')); } });
  const controller = new AbortController(), running = f.load('blob:original', translation(), controller.signal);
  await until(() => f.calls.renders.length === 1);
  const rejected = assert.rejects(running, { name: 'AbortError' }); controller.abort(); await rejected;
  assert.ok(f.calls.cancelled >= 1); assert.equal(f.calls.releases, 1);
  assert.equal(f.calls.canvases[0].width, 0);
  assert.equal((await f.load('blob:original', translation())).length, 1);
  assert.equal(f.calls.renders.length, 2); assert.equal(f.calls.releases, 2);
});

test('aborted PDF loading and encoding release the source without caching unfinished images', async () => {
  const loading = deferred(), controller = new AbortController(), f = fixture({ loading: loading.promise });
  const pending = f.load('blob:original', translation(), controller.signal), rejected = assert.rejects(pending, { name: 'AbortError' });
  controller.abort(); await rejected; assert.equal(f.calls.releases, 1); assert.equal(f.calls.renders.length, 0);
  loading.resolve(f.pdf);
  let callback; const encodingController = new AbortController(), encoding = fixture({ encode(value) { callback = value; } });
  const image = encoding.load('blob:original', translation(), encodingController.signal);
  await until(() => !!callback); const cancelled = assert.rejects(image, { name: 'AbortError' }); encodingController.abort(); await cancelled;
  assert.equal(encoding.calls.releases, 1); assert.equal(encoding.calls.canvases[0].width, 0);
  callback(new Blob(['late PNG'])); await tick();
});

test('failed source and PNG reads report errors and do not masquerade as missing formulas', async () => {
  const broken = fixture({ readError: true });
  await assert.rejects(broken.load('blob:original', translation()), /source unavailable/); assert.equal(broken.calls.releases, 1);
  const f = fixture(); f.failBlob(true);
  await assert.rejects(f.load('blob:original', translation()), /公式裁片/); assert.equal(f.calls.canvases[0].width, 0);
  f.failBlob(false); assert.equal((await f.load('blob:original', translation())).length, 1); assert.equal(f.calls.renders.length, 2);
});

test('oversized or invalid crops refuse low-quality output and rotated historical geometry is not guessed', async () => {
  for (const rect of [{ x: -1, y: 0, width: 10, height: 2 }, { x: 0, y: 0, width: 100, height: 100 }]) {
    const f = fixture({ regions: [region('bad', rect)] });
    await assert.rejects(f.load('blob:original', translation()), /公式/); assert.equal(f.calls.renders.length, 0); assert.equal(f.calls.releases, 1);
  }
  for (const options of [{ rotation: 90 }, { userUnit: 2 }]) {
    const f = fixture(options); assert.equal((await f.load('blob:original', translation())).length, 0);
    assert.equal(f.calls.renders.length, 0); assert.equal(f.calls.text.length, 0); assert.equal(f.calls.releases, 1);
  }
  const missing = fixture({ numPages: 1 });
  await assert.rejects(missing.load('blob:original', translation([{ page: 2, text: 'wrong' }])), /页码/);
  assert.equal(missing.calls.releases, 1);
});

test('completed crop cache has a fixed upper bound instead of retaining every formula', async () => {
  const f = fixture({ regions: Array.from({ length: 257 }, (_, i) => region(String(i))) });
  await f.load('blob:original', translation()); assert.equal(f.calls.renders.length, 257);
  f.setRegions([region('0')]); await f.load('blob:original', translation()); assert.equal(f.calls.renders.length, 258);
  f.setRegions([region('256')]); await f.load('blob:original', translation()); assert.equal(f.calls.renders.length, 258);
});

test('source geometry includes every page but extracts text only for completed translation units', async () => {
  const f = fixture({ numPages: 3, regions: [], pageDetails: { 1: { width: 612, height: 792 }, 2: { width: 842, height: 595 }, 3: { width: 400, height: 700 } } });
  const saved = { ...translation(), totalPages: 3, emptyPages: [2] }, before = structuredClone(saved);
  const first = await f.loadSource('blob:original', saved);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), { formulas: [], pageSizes: [{ width: 612, height: 792 }, { width: 842, height: 595 }, { width: 400, height: 700 }] });
  assert.deepEqual(f.calls.pages, [1, 2, 3]); assert.deepEqual(f.calls.text, [1]); assert.equal(f.calls.releases, 1);
  const next = await f.loadSource('blob:original', { ...saved, units: [...saved.units, { id: '3:0', page: 3, text: '第三页译文' }] });
  assert.deepEqual(JSON.parse(JSON.stringify(next.pageSizes)), JSON.parse(JSON.stringify(first.pageSizes)));
  assert.deepEqual(f.calls.pages, [1, 2, 3], 'cached page geometry is reused during progressive translation');
  assert.deepEqual(f.calls.text, [1, 3]); assert.equal(f.calls.releases, 2); assert.deepEqual(saved, before);
});

test('rotated and nonstandard-unit pages still use their actual viewport size when formula crops are unsupported', async () => {
  const f = fixture({ numPages: 3, pageDetails: { 1: { rotation: 90, width: 800, height: 600 }, 2: { userUnit: 2, width: 1200, height: 1600 }, 3: { width: 400, height: 700 } }, regions: [] });
  const source = await f.loadSource('blob:original', { ...translation([{ page: 1, text: '横页' }, { page: 2, text: '特殊单位页' }]), totalPages: 3 });
  assert.deepEqual(JSON.parse(JSON.stringify(source.pageSizes)), [{ width: 800, height: 600 }, { width: 1200, height: 1600 }, { width: 400, height: 700 }]);
  assert.equal(source.formulas.length, 0); assert.deepEqual(f.calls.text, []); assert.equal(f.calls.renders.length, 0);
  const pending = fixture({ numPages: 2 });
  const empty = await pending.loadSource('blob:original', { ...translation([]), totalPages: 2 });
  assert.equal(empty.pageSizes.length, 2); assert.equal(empty.formulas.length, 0); assert.deepEqual(pending.calls.text, []);
  assert.equal(pending.calls.releases, 1);
});

test('aborted geometry loading releases its source and does not read the following page', async () => {
  const loading = deferred(), f = fixture({ numPages: 2, getPage: () => loading.promise }), controller = new AbortController();
  const pending = f.loadSource('blob:original', { ...translation([]), totalPages: 2 }, controller.signal);
  await until(() => f.calls.pages.length === 1);
  const cancelled = assert.rejects(pending, { name: 'AbortError' }); controller.abort(); await cancelled;
  assert.equal(f.calls.releases, 1); assert.deepEqual(f.calls.pages, [1]);
  loading.resolve({ rotate: 0, userUnit: 1, getViewport: () => ({ width: 600, height: 800 }) });
  await tick(); assert.deepEqual(f.calls.pages, [1]);
});

test('invalid source dimensions and page-count mismatches fail explicitly without guessing page height', async () => {
  for (const width of [0, -1, NaN, Infinity]) {
    const f = fixture({ numPages: 1, width });
    await assert.rejects(f.loadSource('blob:original', { ...translation(), totalPages: 1 }), /尺寸/);
    assert.equal(f.calls.releases, 1); assert.equal(f.calls.renders.length, 0);
  }
  const f = fixture({ numPages: 2 });
  await assert.rejects(f.loadSource('blob:original', { ...translation(), totalPages: 1 }), /页数/);
  assert.deepEqual(f.calls.pages, []); assert.equal(f.calls.releases, 1);
});

test('source loading preserves crop reuse and releases the handle after formula failures', async () => {
  const f = fixture({ numPages: 1 }), saved = { ...translation(), totalPages: 1 };
  const first = await f.loadSource('blob:original', saved), second = await f.loadSource('blob:original', saved);
  assert.equal(first.formulas[0], second.formulas[0]); assert.equal(f.calls.renders.length, 1);
  assert.deepEqual(f.calls.pages, [1]); assert.equal(f.calls.releases, 2);
  const broken = fixture({ numPages: 1, readError: true });
  await assert.rejects(broken.loadSource('blob:original', saved), /source unavailable/);
  assert.equal(broken.calls.releases, 1);
});

test('export passes source page sizes with formula images and leaves original-layout exports independent', async () => {
  const exportCode = ts.transpileModule(readFileSync(new URL('../app/pdf-translation-export.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {}, calls = [], pageSizes = [{ width: 612, height: 792 }], formulas = [{ id: 'image' }], font = new Uint8Array([1]);
  const dependencies = {
    '../lib/pdf-translation-pdf': { async createTranslationPdf(...args) { calls.push(['pdf', ...args]); return new Uint8Array([2]); } },
    '../lib/pdf-layout-artifact': { async createLayoutTranslationFile() { calls.push(['layout']); return new File(['pdf'], 'layout.pdf'); } },
    './file-import': { async importFile(file) { return { title: file.name }; } },
    './pdf-translation-font': { async loadTranslationFont() { return font; } },
    './pdf-translation-formulas': { async loadTranslationSource(...args) { calls.push(['source', ...args]); return { formulas, pageSizes }; } },
    './i18n-core.ts': { translate: (english, _chinese, values) => english.replace(/\{(\w+)\}/g, (_, key) => values[key]) },
  };
  vm.runInNewContext(exportCode, { exports, require(name) { assert.ok(name in dependencies, name); return dependencies[name]; }, File, Uint8Array });
  const card = { pdf: { name: 'source.pdf', url: 'blob:original' } }, saved = { ...translation(), totalPages: 1 };
  await exports.exportTranslatedPdf(card, saved);
  assert.deepEqual(calls[0], ['source', card.pdf.url, saved]);
  assert.deepEqual(calls[1], ['pdf', 'source', saved, font, formulas, pageSizes]);
  calls.length = 0;
  await exports.exportTranslatedPdf(card, { ...saved, mode: 'original-layout' });
  assert.deepEqual(calls, [['layout']]);
});

const inlineItems = () => [
  {str:'The particles occupy ',fontName:'body',height:10,width:100,transform:[10,0,0,10,40,700]},
  {str:'n',fontName:'math',height:10,width:5,transform:[10,0,0,10,145,700]},
  {str:'i',fontName:'sub',height:7,width:3,transform:[7,0,0,7,150,697]},
  {str:' atoms in each lattice site.',fontName:'body',height:10,width:130,transform:[10,0,0,10,158,700]},
];
test('inline preparation and previews share source hashes, geometry and cached crops', async () => {
  const f=fixture({numPages:1,regions:[],items:inlineItems()}),prepared=await f.prepare('blob:inline');
  const part=prepared.units[0].parts[0], saved={inlineMathVersion:1,totalPages:1,units:prepared.units};
  assert.equal(part.inlineFormulas.length,1);assert.match(part.sourceHash,/^[a-f\d]{64}$/);
  const first=await f.loadSource('blob:inline',saved),second=await f.loadSource('blob:inline',saved);
  assert.equal(first.formulas.length,1);assert.equal(first.formulas[0],second.formulas[0]);assert.equal(f.calls.renders.length,1);assert.equal(f.calls.releases,3);
  assert.equal(first.formulas[0].inline.marker,part.inlineFormulas[0].marker);assert(first.formulas[0].inline.baseline>0&&first.formulas[0].inline.baseline<first.formulas[0].height);
  assert.equal(f.calls.text.length,1);assert.equal(f.calls.renders[0].annotationMode,0);
});

test('inline source mismatches fail explicitly while paused legacy fallback remains readable',async()=>{
  const f=fixture({numPages:1,regions:[],items:inlineItems()}),prepared=await f.prepare('blob:inline');
  const saved={inlineMathVersion:1,totalPages:1,units:prepared.units},changed=structuredClone(saved);
  changed.units[0].parts[0].sourceHash='0'.repeat(64);await assert.rejects(f.loadSource('blob:inline',changed),/不一致/);
  const altered=structuredClone(saved);altered.units[0].parts[0].inlineFormulas[0].rect.x++;await assert.rejects(f.loadSource('blob:inline',altered),/不一致/);
  const lost=structuredClone(saved);lost.units[0].parts[0].text='译文丢失公式';await assert.rejects(f.loadSource('blob:inline',lost),/标记不完整/);
  const pending=structuredClone(saved);delete pending.units[0].parts[0].sourceHash;delete pending.units[0].parts[0].inlineFormulas;pending.units[0].parts[0].text='旧译文';
  assert.equal((await f.loadSource('blob:inline',pending)).formulas.length,0);assert.equal(f.calls.renders.length,0);assert.equal(f.calls.releases,5);
});

test('inline preparation cancellation releases its source and skips following pages',async()=>{
  const loading=deferred(),f=fixture({numPages:2,getPage:()=>loading.promise}),controller=new AbortController();
  const pending=f.prepare('blob:inline',controller.signal);await until(()=>f.calls.pages.length===1);
  const rejected=assert.rejects(pending,{name:'AbortError'});controller.abort();await rejected;
  assert.equal(f.calls.releases,1);assert.deepEqual(f.calls.pages,[1]);
});

test('nonzero source crop origins cannot silently produce displaced inline images',async()=>{
  const f=fixture({numPages:1,regions:[],items:inlineItems(),view:[12,24,612,824]});
  const prepared=await f.prepare('blob:cropped');assert(prepared.units.length);assert.equal(prepared.units.flatMap(u=>u.parts).filter(p=>p.inlineFormulas).length,0);
  const result=await f.loadSource('blob:cropped',{inlineMathVersion:1,totalPages:1,units:prepared.units});assert.equal(result.formulas.length,0);assert.equal(f.calls.renders.length,0);
});
