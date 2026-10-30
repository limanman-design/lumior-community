import test from 'node:test';
import assert from 'node:assert/strict';
import {
  capturePdfReadingScroll,
  pdfReadingRestoreState,
  restorePdfReadingScroll,
} from '../app/pdf-reading-session-model.ts';

const viewport = {
  scrollLeft: 180, scrollTop: 1720, width: 800, height: 600,
  scrollWidth: 1400, scrollHeight: 6000,
};
const pages = [
  { page: 1, left: 12, top: 12, width: 1200, height: 1600 },
  { page: 2, left: 12, top: 1636, width: 1200, height: 1800 },
];

test('reading anchor round-trips a scrolled and zoomed page without rounding loss', () => {
  const snapshot = capturePdfReadingScroll(viewport, pages);
  assert.equal(snapshot.anchor.page, 2);
  const result = restorePdfReadingScroll(snapshot, viewport, pages);
  assert.ok(Math.abs(result.top - viewport.scrollTop) < 1e-9);
  assert.ok(Math.abs(result.left - viewport.scrollLeft) < 1e-9);
});

test('changing pane width or preceding page heights retains the point inside the target page', () => {
  const snapshot = capturePdfReadingScroll(viewport, pages);
  const smaller = { ...viewport, width: 500, height: 400, scrollHeight: 9000 };
  const changed = [
    { ...pages[0], height: 2600 },
    { page: 2, left: 12, top: 2636, width: 900, height: 1350 },
  ];
  const result = restorePdfReadingScroll(snapshot, smaller, changed);
  const referenceY = Math.min(120, smaller.height / 4);
  assert.ok(Math.abs((result.top + referenceY - changed[1].top) / changed[1].height
    - snapshot.anchor.fractionY) < 1e-9);
  assert.ok(Math.abs((result.left + smaller.width / 2 - changed[1].left) / changed[1].width
    - snapshot.anchor.fractionX) < 1e-9);
});

test('document ends clamp after a smaller document or a larger viewport', () => {
  const small = { ...viewport, width: 900, height: 1000, scrollWidth: 900, scrollHeight: 1200 };
  assert.deepEqual(restorePdfReadingScroll({ scrollTop: 6000, scrollLeft: 500 }, small, []),
    { top: 200, left: 0 });
  assert.deepEqual(restorePdfReadingScroll({ scrollTop: -20, scrollLeft: Infinity }, small, []),
    { top: 0, left: 0 });
  assert.deepEqual(restorePdfReadingScroll({ scrollTop: NaN, scrollLeft: NaN },
    { ...small, height: 1400 }, []), { top: 0, left: 0 });
});

test('horizontal reading uses the page under the viewport reference point', () => {
  const horizontal = { ...viewport, scrollLeft: 1400, scrollTop: 40, scrollWidth: 3000, horizontal: true };
  const sheets = [pages[0], { ...pages[1], left: 1236, top: 12 }];
  const snapshot = capturePdfReadingScroll(horizontal, sheets);
  assert.equal(snapshot.anchor.page, 2);
  const result = restorePdfReadingScroll(snapshot, horizontal, sheets);
  assert.ok(Math.abs(result.left - horizontal.scrollLeft) < 1e-9);
});

test('citation, annotation and repeated focus requests all take precedence over saved scrolling', () => {
  const saved = { page: 42, zoom: 1.75, scrollTop: 12000, scrollLeft: 0, translationOpen: true };
  assert.deepEqual(pdfReadingRestoreState(saved, 70), { page: 42, zoom: 1.75, restoreScroll: true });
  assert.deepEqual(pdfReadingRestoreState(saved, 70, { page: 3 }),
    { page: 3, zoom: 1.75, restoreScroll: false });
  assert.deepEqual(pdfReadingRestoreState(saved, 70, { page: 3, markPage: 9 }),
    { page: 9, zoom: 1.75, restoreScroll: false });
  assert.equal(pdfReadingRestoreState(saved, 70, { requested: true }).restoreScroll, false);
  assert.deepEqual(pdfReadingRestoreState({ ...saved, page: 900, zoom: 50 }, 12),
    { page: 12, zoom: 4, restoreScroll: true });
  assert.deepEqual(pdfReadingRestoreState(undefined, 0), { page: 1, zoom: 1, restoreScroll: false });
});
