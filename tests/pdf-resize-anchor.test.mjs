import assert from 'node:assert/strict';
import test from 'node:test';
import { createPdfResizeAnchor } from '../app/pdf-resize-anchor.ts';
import { capturePdfReadingScroll } from '../app/pdf-reading-session-model.ts';

const viewport = {
  scrollLeft: 0,
  scrollTop: 1870,
  width: 800,
  height: 600,
  scrollWidth: 800,
  scrollHeight: 6800,
};
const pages = [
  { page: 1, left: 12, top: 12, width: 760, height: 1075 },
  { page: 2, left: 12, top: 1111, width: 760, height: 1300 },
  { page: 3, left: 12, top: 2435, width: 760, height: 1075 },
];
const narrowPages = pages.map((page, index) => ({
  ...page,
  top: index === 0 ? 12 : index === 1 ? 573.5 : 1247.5,
  width: 380,
  height: page.height / 2,
}));
const narrow = { ...viewport, width: 400, scrollHeight: 3500 };
const readPoint = (box, sheets) => capturePdfReadingScroll(box, sheets).anchor;

void test('opening and closing side panes preserve the same point inside page two', () => {
  const anchor = createPdfResizeAnchor();
  const original = readPoint(viewport, pages);
  assert.equal(original.page, 2);
  anchor.measure(776, 560, false);
  assert.equal(anchor.capture(viewport, pages), true);
  anchor.measure(376, 560, false);
  assert.equal(anchor.isPending(), true);
  assert.equal(anchor.capture(narrow, narrowPages), false);
  const position = anchor.restore(narrow, narrowPages);
  const narrowed = {
    ...narrow,
    scrollTop: position.top,
    scrollLeft: position.left,
  };
  assert.deepEqual(readPoint(narrowed, narrowPages), original);
  anchor.measure(776, 560, false);
  const reopened = anchor.restore(viewport, pages);
  assert.ok(Math.abs(reopened.top - viewport.scrollTop) < 1e-9);
  assert.equal(anchor.isPending(), false);
});

void test('window height changes and consecutive resize measurements keep the original anchor', () => {
  const anchor = createPdfResizeAnchor();
  anchor.measure(776, 560, false);
  anchor.capture(viewport, pages);
  anchor.measure(600, 400, false);
  anchor.measure(376, 260, false);
  const shorter = { ...narrow, height: 300 };
  const position = anchor.restore(shorter, narrowPages);
  assert.deepEqual(
    readPoint(
      { ...shorter, scrollTop: position.top, scrollLeft: position.left },
      narrowPages,
    ),
    readPoint(viewport, pages),
  );
});

void test('mixed pre-commit geometry is not saved before the resize observer runs', () => {
  const anchor = createPdfResizeAnchor();
  anchor.capture(viewport, pages);
  assert.equal(anchor.capture(narrow, pages), false);
  assert.equal(anchor.isPending(), true);
  const position = anchor.restore(narrow, narrowPages);
  assert.deepEqual(
    readPoint(
      { ...narrow, scrollTop: position.top, scrollLeft: position.left },
      narrowPages,
    ),
    readPoint(viewport, pages),
  );
});

void test('mount restoration and horizontal page navigation retain their own authority', () => {
  const anchor = createPdfResizeAnchor();
  anchor.measure(776, 560, false);
  anchor.capture(viewport, pages);
  anchor.measure(376, 560, true);
  assert.equal(anchor.isPending(), false);
  assert.equal(anchor.restore(narrow, narrowPages), undefined);
  assert.equal(anchor.capture(narrow, narrowPages), true);
});

void test('explicit page jumps, focus, zoom and scroll input cancel a pending correction', () => {
  const anchor = createPdfResizeAnchor();
  anchor.measure(776, 560, false);
  anchor.capture(viewport, pages);
  anchor.measure(376, 560, false);
  assert.equal(anchor.isPending(), true);
  anchor.reset();
  assert.equal(anchor.restore(narrow, narrowPages), undefined);
  const userPosition = { ...narrow, scrollTop: 40 };
  assert.equal(anchor.capture(userPosition, narrowPages), true);
  assert.equal(readPoint(userPosition, narrowPages).page, 1);
});

void test('empty or unmeasured page geometry cannot overwrite a stable reading point', () => {
  const anchor = createPdfResizeAnchor();
  anchor.capture(viewport, pages);
  assert.equal(anchor.capture({ ...viewport, width: 0 }, pages), false);
  assert.equal(anchor.capture(narrow, []), false);
  anchor.measure(776, 560, false);
  anchor.measure(376, 560, false);
  assert.equal(anchor.restore(narrow, []), undefined);
  assert.equal(anchor.isPending(), true);
  assert.ok(anchor.restore(narrow, narrowPages));
});

void test('an immediate sidebar toggle uses the final user scroll before the deferred save', () => {
  const anchor = createPdfResizeAnchor();
  anchor.measure(776, 560, false);
  anchor.capture(viewport, pages);
  anchor.interrupt();
  const scrolled = { ...viewport, scrollTop: 2200 };
  anchor.scroll(scrolled);
  // No capture/session-save frame runs between scrolling and this resize.
  anchor.measure(376, 560, false);
  const position = anchor.restore(narrow, narrowPages);
  assert.deepEqual(
    readPoint(
      { ...narrow, scrollTop: position.top, scrollLeft: position.left },
      narrowPages,
    ),
    readPoint(scrolled, pages),
  );
});

void test('layout-generated scroll cannot replace a pending resize point', () => {
  const anchor = createPdfResizeAnchor();
  anchor.measure(776, 560, false);
  anchor.capture(viewport, pages);
  anchor.measure(376, 560, false);
  anchor.scroll({ ...narrow, scrollTop: 0 });
  const position = anchor.restore(narrow, narrowPages);
  assert.deepEqual(
    readPoint(
      { ...narrow, scrollTop: position.top, scrollLeft: position.left },
      narrowPages,
    ),
    readPoint(viewport, pages),
  );
});

void test('user input during resizing cannot re-arm the old reading point', () => {
  const anchor = createPdfResizeAnchor();
  anchor.measure(776, 560, false);
  anchor.capture(viewport, pages);
  anchor.measure(376, 560, false);
  anchor.interrupt();
  anchor.measure(376, 300, false);
  assert.equal(anchor.isPending(), false);
  assert.equal(anchor.restore(narrow, narrowPages), undefined);
  const userPosition = { ...narrow, height: 300, scrollTop: 10 };
  assert.equal(anchor.capture(userPosition, narrowPages), true);
  anchor.measure(776, 560, false);
  const position = anchor.restore(viewport, pages);
  assert.equal(
    readPoint({ ...viewport, scrollTop: position.top }, pages).page,
    1,
  );
});

void test('a resize reads the latest native scroll offset even before its scroll event is delivered', () => {
  const anchor = createPdfResizeAnchor();
  anchor.measure(776, 560, false);
  anchor.capture(viewport, pages);
  const scrolled = { ...viewport, scrollTop: 2200 };
  anchor.measure(376, 560, false, {
    scrollLeft: 0,
    scrollTop: scrolled.scrollTop,
  });
  const position = anchor.restore(narrow, narrowPages);
  assert.deepEqual(
    readPoint(
      { ...narrow, scrollTop: position.top, scrollLeft: position.left },
      narrowPages,
    ),
    readPoint(scrolled, pages),
  );
});

void test('a mixed-box session capture retains the latest offset against the old sheets', () => {
  const anchor = createPdfResizeAnchor();
  anchor.capture(viewport, pages);
  const scrolled = { ...viewport, scrollTop: 2200 };
  assert.equal(anchor.capture({ ...scrolled, width: 400 }, pages), false);
  anchor.measure(376, 560, false, {
    scrollLeft: 0,
    scrollTop: scrolled.scrollTop,
  });
  const position = anchor.restore(narrow, narrowPages);
  assert.deepEqual(
    readPoint(
      { ...narrow, scrollTop: position.top, scrollLeft: position.left },
      narrowPages,
    ),
    readPoint(scrolled, pages),
  );
});
