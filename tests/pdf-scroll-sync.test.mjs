import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pdfScrollAnchors,
  interpolatePdfScrollPoint,
  mapPdfScrollTop,
  createPdfScrollFeedbackGuard,
  pdfPartIsVisible,
  createPdfScrollSync,
} from '../app/pdf-scroll-sync.ts';

const part = (id, top, bottom = top + 100) => ({ id, top, bottom });
const page = (number, top, bottom, parts = []) => ({
  page: number,
  top,
  bottom,
  parts,
});
const geometry = (pages, scrollHeight, viewportHeight = 500) => ({
  pages,
  scrollHeight,
  viewportHeight,
});

test('original-layout pages synchronize both ways at different physical scales', () => {
  const source = geometry([page(1, 0, 1000), page(2, 1020, 2020)], 2020);
  const translation = geometry(
    [page(1, 0, 800), page(2, 816, 1616)],
    1616,
    400,
  );
  const anchors = pdfScrollAnchors(source, translation, [
    { page: 1, source: 1 },
    { page: 2, source: 2 },
  ]);
  assert.equal(
    mapPdfScrollTop(760, 'source', source, translation, anchors),
    608,
  );
  assert.equal(
    mapPdfScrollTop(608, 'translation', source, translation, anchors),
    760,
  );
  assert.equal(mapPdfScrollTop(0, 'source', source, translation, anchors), 0);
  assert.equal(
    mapPdfScrollTop(1520, 'source', source, translation, anchors),
    1216,
  );
  assert.equal(
    mapPdfScrollTop(1216, 'translation', source, translation, anchors),
    1520,
  );
});

test('one original page maps across continuation pages using matching paragraphs', () => {
  const source = geometry(
    [page(1, 0, 1000, [part('a', 100), part('b', 500), part('c', 800)])],
    1000,
    200,
  );
  const translation = geometry(
    [
      page(1, 0, 1000, [part('a', 200), part('b', 900)]),
      page(2, 1020, 2020, [part('b', 1100), part('c', 1620)]),
    ],
    2020,
    200,
  );
  const anchors = pdfScrollAnchors(source, translation, [
    { page: 1, source: 1 },
    { page: 2, source: 1 },
  ]);
  assert.equal(interpolatePdfScrollPoint(500, 'source', anchors), 900);
  assert.equal(interpolatePdfScrollPoint(1620, 'translation', anchors), 800);
  assert.equal(interpolatePdfScrollPoint(650, 'source', anchors), 1260);
  assert.equal(interpolatePdfScrollPoint(1260, 'translation', anchors), 650);
  assert.equal(
    mapPdfScrollTop(800, 'source', source, translation, anchors),
    1820,
  );
});

test('page-aligned reflow keeps every reachable page boundary paired despite different sheet heights', () => {
  const source = geometry([page(1,20,1020),page(2,1040,2040),page(3,2060,3060)],3080,500);
  const translation = geometry([page(1,20,1420),page(2,1440,2440),page(3,2460,4060)],4080,500);
  const mapping = [1,2,3].map(value=>({page:value,source:value,alignment:'page'}));
  const anchors = pdfScrollAnchors(source,translation,mapping);
  for (const [left,right] of [[20,20],[1040,1440],[2060,2460]]) {
    assert.equal(mapPdfScrollTop(left,'source',source,translation,anchors,true),right);
    assert.equal(mapPdfScrollTop(right,'translation',source,translation,anchors,true),left);
  }
  assert.equal(mapPdfScrollTop(2580,'source',source,translation,anchors,true),3580);
  assert.equal(mapPdfScrollTop(3580,'translation',source,translation,anchors,true),2580);
  let previous=-Infinity;
  for(let top=0;top<=2580;top+=10){const mapped=mapPdfScrollTop(top,'source',source,translation,anchors,true);assert.ok(mapped>=previous);previous=mapped;}
  assert.equal(mapPdfScrollTop(100,'source',source,translation,[],true),null);
});

test('pages without paragraph rectangles still map smoothly across a target page group', () => {
  const source = geometry([page(1, 20, 1020)], 1040, 200);
  const translation = geometry(
    [page(1, 20, 820), page(2, 850, 1650)],
    1670,
    200,
  );
  const anchors = pdfScrollAnchors(source, translation, [
    { page: 1, source: 1 },
    { page: 2, source: 1 },
  ]);
  assert.equal(interpolatePdfScrollPoint(520, 'source', anchors), 835);
  assert.equal(interpolatePdfScrollPoint(835, 'translation', anchors), 520);
  assert.equal(
    mapPdfScrollTop(840, 'source', source, translation, anchors),
    1470,
  );
});

test('column and overlapping anchors never make scrolling reverse direction', () => {
  const source = geometry(
    [
      page(1, 0, 1000, [
        part('a', 100),
        part('b', 300),
        part('c', 100),
        part('d', 500),
      ]),
    ],
    1000,
    200,
  );
  const translation = geometry(
    [
      page(1, 0, 2000, [
        part('a', 200),
        part('b', 600),
        part('c', 1400),
        part('d', 1000),
      ]),
    ],
    2000,
    200,
  );
  const anchors = pdfScrollAnchors(source, translation, [
    { page: 1, source: 1 },
  ]);
  assert.deepEqual(
    anchors.map((anchor) => anchor.source),
    [0, 100, 300, 500, 1000],
  );
  let preceding = -Infinity;
  for (let top = 0; top <= 800; top += 10) {
    const target = mapPdfScrollTop(top, 'source', source, translation, anchors);
    assert.ok(target >= preceding);
    preceding = target;
  }
});

test('partially translated documents stop at the last available translated page', () => {
  const source = geometry([page(1, 0, 1000), page(2, 1020, 2020)], 2020, 200);
  const translation = geometry([page(1, 0, 1000)], 1000, 200);
  const anchors = pdfScrollAnchors(source, translation, [
    { page: 1, source: 1 },
  ]);
  assert.equal(
    mapPdfScrollTop(1800, 'source', source, translation, anchors),
    800,
  );
  assert.equal(interpolatePdfScrollPoint(1000, 'translation', anchors), 1000);
  assert.equal(mapPdfScrollTop(100, 'source', source, translation, []), null);
  assert.equal(
    mapPdfScrollTop(0, 'source', geometry([], 100, 100), translation, anchors),
    null,
  );
});

test('programmatic scroll acknowledgment suppresses feedback and user input takes ownership immediately', () => {
  const guard = createPdfScrollFeedbackGuard();
  guard.mark('translation', 420, 10);
  assert.equal(guard.consume('translation', 420.4, 30), true);
  assert.equal(guard.consume('translation', 420.4, 40), false);
  guard.mark('source', 500, 50);
  guard.user('source');
  assert.equal(guard.consume('source', 500, 60), false);
  guard.mark('translation', 600, 80);
  assert.equal(guard.consume('translation', 630, 90), false);
  guard.mark('source', 700, 100);
  assert.equal(guard.consume('source', 700, 401), false);
});

test('hover only needs positioning when every fragment of the matching paragraph is outside the viewport', () => {
  const fragments = [part('a', 100, 180), part('a', 700, 780)];
  assert.equal(pdfPartIsVisible(fragments, 150, 100), true);
  assert.equal(pdfPartIsVisible(fragments, 600, 200), true);
  assert.equal(pdfPartIsVisible(fragments, 180, 100), false);
  assert.equal(pdfPartIsVisible(fragments, 800, 100), false);
  assert.equal(pdfPartIsVisible([], 0, 100), false);
});

test('the controller coalesces scroll events, handles scrollbar input both ways and removes all listeners', () => {
  const scheduled = new Map();
  let nextFrame = 0;
  const previousRequest = globalThis.requestAnimationFrame,
    previousCancel = globalThis.cancelAnimationFrame;
  const previousResize = globalThis.ResizeObserver,
    previousMutation = globalThis.MutationObserver;
  globalThis.requestAnimationFrame = (callback) => {
    scheduled.set(++nextFrame, callback);
    return nextFrame;
  };
  globalThis.cancelAnimationFrame = (id) => scheduled.delete(id);
  const flush = () => {
    const callbacks = [...scheduled.values()];
    scheduled.clear();
    callbacks.forEach((callback) => callback());
  };
  class Observer {
    static instances = [];
    targets = new Set();
    constructor(callback) {
      this.callback = callback;
      Observer.instances.push(this);
    }
    observe(target) {
      this.targets.add(target);
    }
    disconnect() {
      this.targets.clear();
    }
    trigger(...args) {
      this.callback(...args);
    }
  }
  globalThis.ResizeObserver = Observer;
  globalThis.MutationObserver = Observer;
  class Events {
    listeners = new Map();
    addEventListener(type, callback) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(callback);
    }
    removeEventListener(type, callback) {
      this.listeners.get(type)?.delete(callback);
    }
    emit(type) {
      this.listeners.get(type)?.forEach((callback) => callback());
    }
    listenerCount() {
      return [...this.listeners.values()].reduce(
        (count, callbacks) => count + callbacks.size,
        0,
      );
    }
  }
  const view = new Events();
  class Root extends Events {
    scrollTop = 0;
    writes = 0;
    geometryReads = 0;
    constructor(height, viewport) {
      super();
      this.scrollHeight = height;
      this.clientHeight = viewport;
      this.ownerDocument = { defaultView: view };
      this.sheet = {
        dataset: { pdfPage: '1' },
        querySelectorAll: () => [],
        getBoundingClientRect: () => {
          this.geometryReads++;
          return { top: -this.scrollTop, height: this.scrollHeight };
        },
      };
    }
    getBoundingClientRect() {
      return { top: 0 };
    }
    querySelectorAll() {
      return [this.sheet];
    }
    scrollTo({ top }) {
      this.scrollTop = top;
      this.writes++;
      this.emit('scroll');
    }
  }
  try {
    const source = new Root(1000, 200),
      translation = new Root(2000, 400);
    const sync = createPdfScrollSync({
      source: () => source,
      translation: () => translation,
      pages: () => [{ page: 1, source: 1 }],
    });
    const disconnect = sync.connect();
    source.emit('wheel');
    source.scrollTop = 100;
    source.emit('scroll');
    source.scrollTop = 200;
    source.emit('scroll');
    assert.equal(scheduled.size, 1);
    assert.equal(sync.isScrolling(), true);
    assert.equal(sync.hover('source', 'offscreen-paragraph'), false);
    flush();
    assert.equal(translation.scrollTop, 400);
    assert.equal(translation.writes, 1);
    assert.equal(source.writes, 0);
    assert.equal(
      scheduled.size,
      0,
      'the programmatic target scroll does not echo back',
    );
    const reads = [source.geometryReads, translation.geometryReads];
    source.scrollTop = 300;
    source.emit('scroll');
    flush();
    assert.equal(translation.scrollTop, 600);
    assert.deepEqual(
      [source.geometryReads, translation.geometryReads],
      reads,
      "native scrolling reuses both documents' geometry instead of reading every paragraph again",
    );
    translation.emit('pointerdown');
    translation.scrollTop = 800;
    translation.emit('scroll');
    flush();
    assert.equal(source.scrollTop, 400);
    assert.equal(source.writes, 1);
    view.emit('pointerup');

    const sourceResize = Observer.instances.find((observer) =>
      observer.targets.has(source.sheet),
    );
    const translationResize = Observer.instances.find((observer) =>
      observer.targets.has(translation.sheet),
    );
    const translationMutation = Observer.instances.find(
      (observer) =>
        observer.targets.has(translation) &&
        !observer.targets.has(translation.sheet),
    );
    translation.clientHeight = 500;
    translationResize.trigger();
    flush();
    assert.ok(Math.abs(source.scrollTop - 426.6666666666667) < 0.001);
    assert.equal(
      translation.scrollTop,
      800,
      'viewport resize follows the most recent reader input',
    );
    source.scrollHeight = 1200;
    sourceResize.trigger();
    flush();
    assert.ok(Math.abs(source.scrollTop - 533.3333333333334) < 0.001);
    assert.equal(
      translation.scrollTop,
      800,
      'late source page aspect ratio does not take ownership',
    );
    const oldSheet = translation.sheet;
    translation.sheet = { ...oldSheet };
    translationMutation.trigger([
      { target: translation, addedNodes: [], removedNodes: [] },
    ]);
    assert.equal(translationResize.targets.has(oldSheet), false);
    assert.equal(translationResize.targets.has(translation.sheet), true);
    flush();
    assert.equal(
      scheduled.size,
      0,
      'resizing and programmatic scrolling do not form a loop',
    );

    source.scrollTop = 500;
    source.emit('scroll');
    assert.equal(scheduled.size, 1);
    disconnect();
    assert.equal(scheduled.size, 0);
    assert.equal(source.listenerCount(), 0);
    assert.equal(translation.listenerCount(), 0);
    assert.equal(view.listenerCount(), 0);
    assert.equal(
      Observer.instances.reduce(
        (count, observer) => count + observer.targets.size,
        0,
      ),
      0,
    );
    source.scrollTop = 600;
    source.emit('scroll');
    assert.equal(scheduled.size, 0);
  } finally {
    globalThis.requestAnimationFrame = previousRequest;
    globalThis.cancelAnimationFrame = previousCancel;
    globalThis.ResizeObserver = previousResize;
    globalThis.MutationObserver = previousMutation;
  }
});
