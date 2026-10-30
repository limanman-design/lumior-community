import test from 'node:test';
import assert from 'node:assert/strict';
import { createPdfRenderScheduler } from '../app/pdf-render-scheduler.ts';
import { createPdfWidthSettler } from '../app/pdf-width-settle.ts';
import { createPdfRenderCache } from '../app/pdf-render-cache.ts';

void test('visible pages precede neighbours, thumbnails and cancelled speculative pages', async () => {
  const queue = createPdfRenderScheduler(),
    order = [],
    cancelled = new AbortController();
  const warm = queue.schedule(
    () => 4,
    async () => order.push('warm'),
  );
  const thumb = queue.schedule(
    () => 3,
    async () => order.push('thumbnail'),
  );
  const neighbour = queue.schedule(
    () => 1,
    async () => order.push('neighbour'),
  );
  const stale = queue.schedule(
    () => 0,
    async () => order.push('stale'),
    cancelled.signal,
  );
  const rejected = assert.rejects(stale, { name: 'AbortError' });
  cancelled.abort();
  const visible = queue.schedule(
    () => 0,
    async () => order.push('visible'),
  );
  await Promise.all([warm, thumb, neighbour, rejected, visible]);
  assert.deepEqual(order, ['visible', 'neighbour', 'thumbnail', 'warm']);
});

void test('a failure releases the single renderer slot, current visibility is checked on dispatch', async () => {
  const queue = createPdfRenderScheduler(),
    order = [];
  let visible = false,
    release;
  const active = queue.schedule(
    () => 0,
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  while (!release) await new Promise((resolve) => setTimeout(resolve, 1));
  const neighbour = queue.schedule(
    () => (visible ? 0 : 2),
    async () => {
      order.push('now-visible');
    },
  );
  const broken = queue.schedule(
    () => 1,
    async () => {
      order.push('broken');
      throw new Error('page unavailable');
    },
  );
  const rejected = assert.rejects(broken, /page unavailable/);
  const thumbnail = queue.schedule(
    () => 3,
    async () => {
      order.push('thumbnail');
    },
  );
  visible = true;
  release();
  await Promise.all([active, neighbour, rejected, thumbnail]);
  assert.deepEqual(order, ['now-visible', 'broken', 'thumbnail']);
});

void test('queued cancellation is immediate even while another page is rendering', async () => {
  const queue = createPdfRenderScheduler(),
    controller = new AbortController();
  let release;
  const active = queue.schedule(
    () => 0,
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  while (!release) await new Promise((resolve) => setTimeout(resolve, 1));
  const stale = queue.schedule(
    () => 4,
    async () => {
      throw Error('must not render');
    },
    controller.signal,
  );
  const rejected = assert.rejects(stale, { name: 'AbortError' });
  controller.abort();
  await rejected;
  release();
  await active;
});

void test('width animations commit only their final size and a held drag postpones painting', () => {
  const previousSet = globalThis.setTimeout,
    previousClear = globalThis.clearTimeout;
  const timers = new Map();
  let next = 0,
    dragging = false;
  globalThis.setTimeout = (callback) => {
    timers.set(++next, callback);
    return next;
  };
  globalThis.clearTimeout = (id) => {
    timers.delete(id);
  };
  const flush = () => {
    const callbacks = [...timers.values()];
    timers.clear();
    callbacks.forEach((callback) => callback());
  };
  const widths = [];
  try {
    const settle = createPdfWidthSettler(
      (width) => widths.push(width),
      () => dragging,
    );
    for (const size of [400, 405, 418, 425, 431]) settle.update(size);
    assert.equal(timers.size, 1);
    flush();
    assert.deepEqual(widths, [431]);
    dragging = true;
    settle.update(500);
    flush();
    assert.deepEqual(widths, [431]);
    settle.update(550);
    flush();
    assert.deepEqual(widths, [431]);
    dragging = false;
    flush();
    assert.deepEqual(widths, [431, 550]);
    settle.update(550);
    flush();
    assert.deepEqual(widths, [431, 550]);
    settle.update(0);
    settle.update(NaN);
    assert.equal(timers.size, 0);
    settle.update(600);
    settle.cancel();
    assert.equal(timers.size, 0);
  } finally {
    globalThis.setTimeout = previousSet;
    globalThis.clearTimeout = previousClear;
  }
});

void test('expiry removes only its raster and frees its pixel allocation', () => {
  const disposed = [],
    cache = createPdfRenderCache((value) => disposed.push(value), 100, 3);
  cache.set('warm-page', 'warm', 40);
  cache.set('reader-page', 'reader', 50);
  cache.delete('warm-page');
  cache.delete('already-expired');
  assert.deepEqual(disposed, ['warm']);
  assert.equal(cache.pixels, 50);
  assert.equal(cache.get('reader-page'), 'reader');
});
