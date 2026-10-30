import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeferredContentQueue } from '../app/deferred-content-queue.ts';

function scheduler() {
  const frames = new Map(); let id = 0;
  return { frames, request: callback => { frames.set(++id, callback); return id; }, cancel: id => frames.delete(id), tick: () => {
    const [id, callback] = frames.entries().next().value; frames.delete(id); callback();
  } };
}

test('a zoomed-out board with 120 visible notes initializes one editor per frame', () => {
  const frames = scheduler(), enqueue = createDeferredContentQueue(frames.request, frames.cancel), mounted = [];
  for (let i = 0; i < 120; i++) enqueue(() => mounted.push(i));
  assert.equal(mounted.length, 0);
  for (let i = 0; i < 120; i++) { assert.equal(frames.frames.size, 1); frames.tick(); assert.equal(mounted.length, i + 1); }
  assert.deepEqual(mounted, Array.from({ length: 120 }, (_, i) => i));
  assert.equal(frames.frames.size, 0);
});

test('switching boards or scrolling away cancels queued work and preserves live callbacks', () => {
  const frames = scheduler(), enqueue = createDeferredContentQueue(frames.request, frames.cancel), mounted = [];
  const cancelOld = enqueue(() => mounted.push('old board'));
  enqueue(() => mounted.push('current board'));
  const cancelInvisible = enqueue(() => mounted.push('offscreen'));
  cancelOld(); cancelInvisible(); frames.tick();
  assert.deepEqual(mounted, ['current board']);
  assert.equal(frames.frames.size, 0);
  const cancelLast = enqueue(() => mounted.push('closed drawer'));
  cancelLast(); assert.equal(frames.frames.size, 0);
});

test('an editor failure does not strand other queued content', () => {
  const frames = scheduler(), enqueue = createDeferredContentQueue(frames.request, frames.cancel), mounted = [];
  enqueue(() => { throw new Error('failed editor'); });
  enqueue(() => mounted.push('next'));
  assert.throws(() => frames.tick(), /failed editor/);
  frames.tick(); assert.deepEqual(mounted, ['next']);
});

test('visible sidebar content takes the next frame without starving the canvas backlog', () => {
  const frames = scheduler(), enqueue = createDeferredContentQueue(frames.request, frames.cancel), mounted = [];
  for (let i = 0; i < 120; i++) enqueue(() => mounted.push(i));
  enqueue(() => mounted.push('sidebar'), 1);
  frames.tick(); assert.deepEqual(mounted, ['sidebar']);
  frames.tick(); assert.deepEqual(mounted, ['sidebar', 0]);
});
