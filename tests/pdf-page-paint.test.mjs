import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createPdfRenderCache } from '../app/pdf-render-cache.ts';

const script = ts.transpileModule(readFileSync(new URL('../app/pdf-page-paint.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function fixture() {
  const renders = [], textLayers = [], bitmaps = [];
  const dependencies = {
    'pdfjs-dist': { TextLayer: class {
      constructor({ viewport, container }) { this.container = container; textLayers.push(viewport.scale); }
      async render() {}
      cancel() {}
    } },
    './pdf-render-cache': { createPdfRenderCache },
    './pdf-render-scheduler': { pdfRenderScheduler: { schedule: (_priority, render) => render() } },
  };
  const loaded = { exports: {} };
  vm.runInNewContext(script, {
    exports: loaded.exports, require: name => { assert.ok(name in dependencies, name); return dependencies[name]; },
    devicePixelRatio: 2,
    document: { createElement: () => ({ style: { setProperty() {} } }) },
    createImageBitmap: async () => { const bitmap = { closed: false, close() { this.closed = true; } }; bitmaps.push(bitmap); return bitmap; },
  });
  const page = {
    getViewport: ({ scale }) => ({ scale, width: 612 * scale, height: 792 * scale }),
    render: ({ viewport }) => { renders.push(viewport.scale); return { promise: Promise.resolve(), cancel() {} }; },
    getTextContent: async () => ({ items: [], styles: {} }),
  };
  const pdf = { getPage: async () => page };
  return { ...loaded.exports, pdf, renders, textLayers, bitmaps };
}

void test('viewports sharing the capped raster size keep separate text geometry when switching reading widths', async () => {
  const app = fixture();
  const narrow = app.pdfPaintDimensions(1500, 792 / 612, 1, 2);
  const wide = app.pdfPaintDimensions(2800, 792 / 612, 1, 2);
  assert.equal(narrow.width, wide.width); assert.equal(narrow.height, wide.height);
  const first = await app.preparePdfPage(app.pdf, 1, 1500, 1);
  const second = await app.preparePdfPage(app.pdf, 1, 2800, 1);
  assert.notEqual(first, second);
  assert.equal(first.scale, (1500 - 24) / 612);
  assert.equal(second.scale, (2800 - 24) / 612);
  assert.deepEqual(app.renders, [first.scale, second.scale]);
  assert.deepEqual(app.textLayers, app.renders);
  assert.equal(await app.preparePdfPage(app.pdf, 1, 1500, 1), first);
  assert.equal(app.renders.length, 2, 'returning to a previous width should reuse its matching text layer');
  app.clearPdfPaint(app.pdf); assert.ok(app.bitmaps.every(bitmap => bitmap.closed));
});

void test('zoom changes past the raster budget use the new font scale without disabling matching paint reuse', async () => {
  const app = fixture();
  const first = await app.preparePdfPage(app.pdf, 1, 1500, 1);
  const zoomed = await app.preparePdfPage(app.pdf, 1, 1500, 1.5);
  assert.equal(zoomed.scale, ((1500 - 24) * 1.5) / 612);
  assert.notEqual(zoomed, first);
  assert.equal(await app.preparePdfPage(app.pdf, 1, 1500, 1.5), zoomed);
  assert.equal(app.renders.length, 2);
});
