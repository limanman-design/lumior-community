import test from 'node:test';
import assert from 'node:assert/strict';
import { repairPdfSelectionGap } from '../app/pdf-text-selection.ts';

function span(text, { x, y = 466.555, width, height = 11.305 }, dir = 'ltr') {
  const node = { nodeType: 3, length: text.length };
  const element = {
    dir, firstChild: node, childNodes: [node], textContent: text,
    closest: () => element,
    getBoundingClientRect: () => ({ left: x, right: x + width, top: y, bottom: y + height, width, height }),
  };
  node.parentElement = element;
  return element;
}
function fixture({ rightX = 536, rightY = 466.555, reverse = false } = {}) {
  const left = span('It may, for example, melt or freeze.', { x: 345.273, width: 182.519 });
  const right = span('This macroscopic', { x: rightX, y: rightY, width: 90 });
  const spaces = span(' ', { x: 527.792, width: 8.208 });
  const lower = span('temperature of the system approaches zero, all thermal', { x: 345.273, y: 494, width: 270 });
  const spans = [left, spaces, right, lower], extensions = [];
  const layer = { querySelectorAll: () => spans };
  const selection = {
    isCollapsed: false, anchorNode: reverse ? lower.firstChild : left.firstChild,
    anchorOffset: reverse ? lower.firstChild.length : 0,
    focusNode: layer, focusOffset: 12,
    extend(node, offset) { extensions.push({ node, offset }); this.focusNode = node; this.focusOffset = offset; },
  };
  layer.ownerDocument = { getSelection: () => selection };
  return { layer, selection, left, right, lower, spans, extensions };
}

void test('the reported sentence-gap endpoint stays at freeze instead of the native layer fallback two lines below', () => {
  const app = fixture();
  assert.equal(repairPdfSelectionGap(app.layer, { x: 535.5, y: 470 }), true);
  assert.deepEqual(app.extensions, [{ node: app.right.firstChild, offset: 0 }]);
  assert.equal(app.selection.anchorNode, app.left.firstChild);
  assert.equal(app.selection.anchorOffset, 0);
});

void test('reverse selection keeps its original anchor while restoring the nearest gap boundary', () => {
  const app = fixture({ reverse: true }), anchor = app.selection.anchorNode, offset = app.selection.anchorOffset;
  assert.equal(repairPdfSelectionGap(app.layer, { x: 530, y: 470 }), true);
  assert.deepEqual(app.extensions, [{ node: app.left.firstChild, offset: app.left.firstChild.length }]);
  assert.equal(app.selection.anchorNode, anchor); assert.equal(app.selection.anchorOffset, offset);
});

void test('valid native character endpoints are never replaced, even when the pointer lies in a nearby gap', () => {
  const app = fixture(); app.selection.focusNode = app.right.firstChild; app.selection.focusOffset = 3;
  assert.equal(repairPdfSelectionGap(app.layer, { x: 535.5, y: 470 }), false);
  assert.equal(app.selection.focusOffset, 3); assert.equal(app.extensions.length, 0);
});

void test('pointing within actual text, beyond a line end or in a column gutter leaves the native selection unchanged', () => {
  for (const point of [{ x: 520, y: 470 }, { x: 640, y: 470 }, { x: 535.5, y: 485 }]) {
    const app = fixture(); assert.equal(repairPdfSelectionGap(app.layer, point), false); assert.equal(app.extensions.length, 0);
  }
  const columns = fixture({ rightX: 555 });
  assert.equal(repairPdfSelectionGap(columns.layer, { x: 535.5, y: 470 }), false);
  assert.equal(columns.extensions.length, 0);
});

void test('overlapping but different baselines do not invent a single-line gap', () => {
  const app = fixture({ rightY: 471 });
  assert.equal(repairPdfSelectionGap(app.layer, { x: 535.5, y: 474 }), false);
  assert.equal(app.extensions.length, 0);
});

void test('collapsed selections and fallbacks outside this PDF text layer remain untouched', () => {
  const app = fixture(); app.selection.isCollapsed = true;
  assert.equal(repairPdfSelectionGap(app.layer, { x: 535.5, y: 470 }), false);
  app.selection.isCollapsed = false; app.selection.focusNode = {};
  assert.equal(repairPdfSelectionGap(app.layer, { x: 535.5, y: 470 }), false);
  assert.equal(repairPdfSelectionGap(null, { x: 535.5, y: 470 }), false);
});

void test('a cross-page anchor is preserved when the endpoint falls into a small gap on the next page', () => {
  const app = fixture(), otherPage = span('Original page anchor', { x: 10, y: 10, width: 100 });
  app.selection.anchorNode = otherPage.firstChild; app.selection.anchorOffset = 4;
  assert.equal(repairPdfSelectionGap(app.layer, { x: 535.5, y: 470 }), true);
  assert.equal(app.selection.anchorNode, otherPage.firstChild); assert.equal(app.selection.anchorOffset, 4);
});

void test('RTL span boundaries use visual edges without reversing the anchor', () => {
  const app = fixture(); app.left.dir = 'rtl';
  assert.equal(repairPdfSelectionGap(app.layer, { x: 530, y: 470 }), true);
  assert.deepEqual(app.extensions, [{ node: app.left.firstChild, offset: 0 }]);
});
