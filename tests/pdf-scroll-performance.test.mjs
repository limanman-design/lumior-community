import test from 'node:test';
import assert from 'node:assert/strict';
import { createPdfRenderCache } from '../app/pdf-render-cache.ts';
import { pdfPageAtScrollTop, trackPdfPage } from '../app/pdf-page-tracker.ts';

test('raster retention obeys pixel memory and entry limits, reuses recent pages and disposes replaced data', () => {
  const disposed = [],
    cache = createPdfRenderCache((value) => disposed.push(value), 100, 3);
  cache.set('a', 'page-a', 30);
  cache.set('b', 'page-b', 30);
  cache.set('c', 'page-c', 30);
  assert.equal(cache.get('a'), 'page-a');
  cache.set('d', 'page-d', 30);
  assert.deepEqual(disposed, ['page-b']);
  assert.equal(cache.size, 3);
  assert.equal(cache.pixels, 90);
  cache.set('a', 'page-a-at-new-zoom', 70);
  assert.deepEqual(disposed, ['page-b', 'page-a', 'page-c']);
  assert.equal(cache.pixels, 100);
  cache.set('huge', 'unretained-high-zoom-page', 101);
  assert.equal(cache.size, 0);
  assert.equal(cache.pixels, 0);
  assert.ok(disposed.includes('unretained-high-zoom-page'));
  cache.set('first', 'first', 5);
  cache.set('second', 'second', 5);
  cache.clear();
  assert.equal(cache.size, 0);
  assert.equal(cache.pixels, 0);
  assert.deepEqual(disposed.slice(-2), ['first', 'second']);
});

test('page tracking handles mixed page heights, gaps, exact boundaries and the document end', () => {
  const pages = [
    { page: 1, bottom: 600 },
    { page: 2, bottom: 930 },
    { page: 3, bottom: 1810 },
  ];
  assert.equal(pdfPageAtScrollTop(pages, 0), 1);
  assert.equal(pdfPageAtScrollTop(pages, 559), 1);
  assert.equal(pdfPageAtScrollTop(pages, 560), 2);
  assert.equal(pdfPageAtScrollTop(pages, 900), 3);
  assert.equal(pdfPageAtScrollTop(pages, 1800), undefined);
  assert.equal(pdfPageAtScrollTop([], 0), undefined);
});

test('a 230-page reader reads layout once, coalesces scrolling and refreshes only after actual geometry changes', () => {
  const previousRequest = globalThis.requestAnimationFrame,
    previousCancel = globalThis.cancelAnimationFrame,
    previousResize = globalThis.ResizeObserver;
  const frames = new Map();
  let nextFrame = 0,
    observer;
  globalThis.requestAnimationFrame = (callback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  globalThis.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback;
      observer = this;
    }
    observe() {}
    disconnect() {
      this.disconnected = true;
    }
  };
  const flush = () => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback());
  };
  let layoutReads = 0,
    listeners = new Map(),
    shouldTrack = false,
    height = 600;
  const sheets = Array.from({ length: 230 }, (_, i) => ({
    dataset: { pdfPage: String(i + 1) },
    get offsetTop() {
      layoutReads++;
      return i * height;
    },
    get offsetHeight() {
      layoutReads++;
      return height;
    },
  }));
  const root = {
    scrollTop: 0,
    querySelectorAll: () => sheets,
    addEventListener: (name, callback, options) => {
      assert.equal(options.passive, true);
      listeners.set(name, callback);
    },
    removeEventListener: (name) => listeners.delete(name),
  };
  const pages = [];
  try {
    const cleanup = trackPdfPage(
      root,
      (n) => pages.push(n),
      () => shouldTrack,
    );
    flush();
    assert.deepEqual(
      pages,
      [],
      'an explicitly requested citation stays selected',
    );
    assert.equal(layoutReads, 460);
    shouldTrack = true;
    for (const top of [700, 1300, 1800]) {
      root.scrollTop = top;
      listeners.get('scroll')();
    }
    assert.equal(frames.size, 1);
    flush();
    assert.deepEqual(pages, [4]);
    assert.equal(layoutReads, 460);
    root.scrollTop = 120000;
    listeners.get('scroll')();
    flush();
    assert.equal(pages.at(-1), 201);
    assert.equal(layoutReads, 460);
    height = 500;
    observer.callback();
    flush();
    assert.equal(
      pages.at(-1),
      201,
      'no page is published past the document end',
    );
    root.scrollTop = 49960;
    listeners.get('scroll')();
    flush();
    assert.equal(pages.at(-1), 101);
    assert.equal(layoutReads, 920);
    listeners.get('scroll')();
    assert.equal(frames.size, 1);
    cleanup();
    assert.equal(frames.size, 0);
    assert.equal(listeners.size, 0);
    assert.equal(observer.disconnected, true);
  } finally {
    globalThis.requestAnimationFrame = previousRequest;
    globalThis.cancelAnimationFrame = previousCancel;
    globalThis.ResizeObserver = previousResize;
  }
});

test('horizontal sidebar tracking follows page width and ignores vertical reading position', () => {
  const previousRequest = globalThis.requestAnimationFrame,
    previousCancel = globalThis.cancelAnimationFrame,
    previousResize = globalThis.ResizeObserver;
  let queued;
  globalThis.requestAnimationFrame = (callback) => { queued = callback; return 1; };
  globalThis.cancelAnimationFrame = () => { queued = undefined; };
  globalThis.ResizeObserver = undefined;
  const listeners = new Map();
  const root = {
    scrollLeft: 0,
    scrollTop: 3000,
    querySelectorAll: () => [1, 2, 3].map((page) => ({
      dataset: { pdfPage: String(page) },
      offsetLeft: 12 + (page - 1) * 390,
      offsetWidth: 376,
      get offsetTop() { throw new Error('horizontal pages must not read vertical geometry'); },
    })),
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name) => listeners.delete(name),
  };
  const pages = [];
  const flush = () => { const callback = queued; queued = undefined; callback?.(); };
  try {
    const cleanup = trackPdfPage(root, (page) => pages.push(page), () => true, 'horizontal');
    flush();
    assert.deepEqual(pages, [1]);
    root.scrollLeft = 390;
    listeners.get('scroll')();
    flush();
    assert.equal(pages.at(-1), 2);
    root.scrollLeft = 780;
    root.scrollTop = 0;
    listeners.get('scroll')();
    flush();
    assert.equal(pages.at(-1), 3);
    cleanup();
    assert.equal(listeners.size, 0);
  } finally {
    globalThis.requestAnimationFrame = previousRequest;
    globalThis.cancelAnimationFrame = previousCancel;
    globalThis.ResizeObserver = previousResize;
  }
});
