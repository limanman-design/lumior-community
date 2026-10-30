import test from 'node:test';
import assert from 'node:assert/strict';
import { createWheelAnimation, nearestWheelTarget, wheelRepeatRadius, wheelRowFrame, wrapWheelIndex } from '../app/sound-option-wheel-model.ts';

test('cyclic source indices cross both boundaries and retain fractional rounding', () => {
  assert.equal(wrapWheelIndex(-1, 5), 4);
  assert.equal(wrapWheelIndex(5, 5), 0);
  assert.equal(wrapWheelIndex(-10.6, 5), 4);
  assert.equal(wrapWheelIndex(1004.6, 5), 0);
  assert.equal(wrapWheelIndex(7, 0), 0);
});

test('external source synchronization takes the nearest equivalent cycle', () => {
  assert.equal(nearestWheelTarget(0, 4, 5), 5);
  assert.equal(nearestWheelTarget(4, 0, 5), -1);
  assert.equal(nearestWheelTarget(4, -5, 5), -6);
  assert.equal(nearestWheelTarget(0, 1004, 5), 1005);
  for (let count = 1; count <= 9; count++) {
    for (let position = -30.25; position < 31; position += .5) {
      for (let source = 0; source < count; source++) {
        const target = nearestWheelTarget(source, position, count);
        assert.equal(wrapWheelIndex(target, count), source);
        assert.ok(Math.abs(target - position) <= count / 2);
      }
    }
  }
});

test('repeated rows cover the viewport even with fewer sources than visible rows', () => {
  for (const [height, rowHeight, count] of [[380, 58, 5], [320, 46, 2], [380, 58, 1], [720, 42, 3]]) {
    const radius = wheelRepeatRadius(height, rowHeight, count);
    assert.ok(radius * count * rowHeight > height / 2);
  }
  assert.equal(wheelRepeatRadius(380, 58, 0), 0);
});

function wheelClock() {
  const pending = new Map();
  const cancelled = [];
  const paints = [];
  let now = 0;
  let nextFrame = 1;
  let position = 0;
  let target = 0;
  const animation = createWheelAnimation(
    () => ({ position, target }),
    value => { position = value; },
    () => { paints.push(position); },
    {
      now: () => now,
      requestFrame: callback => { const id = nextFrame++; pending.set(id, callback); return id; },
      cancelFrame: id => { cancelled.push(id); pending.delete(id); },
    },
  );
  return {
    animation, pending, cancelled, paints,
    get position() { return position; },
    input(value, elapsed = 0) { now += elapsed; target = value; animation.animate(); },
    frame(elapsed = 16) {
      now += elapsed;
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback(now);
    },
  };
}

test('dense wheel input keeps the first queued frame and uses its full elapsed time', () => {
  const wheel = wheelClock();
  wheel.input(1);
  const firstFrame = [...wheel.pending.keys()][0];
  for (let event = 1; event <= 10; event++) wheel.input(event / 2, 1);
  assert.deepEqual([...wheel.pending.keys()], [firstFrame]);
  assert.deepEqual(wheel.cancelled, []);
  wheel.frame(6);
  assert.equal(wheel.paints.length, 1);
  assert.ok(Math.abs(wheel.position - 5 * (1 - Math.exp(-16 / 95))) < 1e-10);
  assert.equal(wheel.pending.size, 1);
});

test('changing direction during motion reads the newest destination and eventually settles', () => {
  const wheel = wheelClock();
  wheel.input(4);
  wheel.frame();
  const oldPosition = wheel.position;
  wheel.input(-3);
  wheel.frame();
  assert.ok(wheel.position < oldPosition);
  for (let frame = 0; wheel.pending.size && frame < 100; frame++) wheel.frame();
  assert.equal(wheel.position, -3);
  assert.equal(wheel.pending.size, 0);
  assert.ok(wheel.paints.every(Number.isFinite));
});

test('reduced motion and unmount cancellation stop pending frames', () => {
  const wheel = wheelClock();
  wheel.input(3);
  wheel.animation.animate(true);
  assert.equal(wheel.position, 3);
  assert.equal(wheel.pending.size, 0);
  assert.equal(wheel.paints.length, 1);
  wheel.input(4);
  wheel.animation.cancel();
  wheel.frame();
  assert.equal(wheel.position, 3);
  assert.equal(wheel.paints.length, 1);
  assert.equal(wheel.pending.size, 0);
});

test('a delayed browser frame stays bounded instead of jumping to the destination', () => {
  const wheel = wheelClock();
  wheel.input(10);
  wheel.frame(1000);
  assert.ok(Math.abs(wheel.position - 10 * (1 - Math.exp(-50 / 95))) < 1e-10);
});

test('offscreen copies skip painting while the same curve remains visible in a larger wheel', () => {
  const center = wheelRowFrame(0, 58, 320);
  assert.equal(center.visible, true);
  assert.equal(center.opacity, 1);
  assert.equal(center.filter, 'blur(0.00px)');
  assert.equal(center.active, 1);
  const compact = wheelRowFrame(5, 58, 320);
  const expanded = wheelRowFrame(5, 58, 650);
  assert.equal(compact.visible, false);
  assert.equal(expanded.visible, true);
  assert.equal(compact.transform, expanded.transform);
  assert.equal(expanded.filter, 'blur(3.60px)');
  assert.equal(wheelRowFrame(10, 58, 650).visible, false);
  assert.equal(wheelRowFrame(-10, 58, 650).visible, false);
  // Enough cyclic copies are retained to fill a tall wheel even with one source.
  const radius = wheelRepeatRadius(650, 58, 1);
  const visible = Array.from({ length: radius * 2 + 1 }, (_, index) => index - radius)
    .filter(offset => wheelRowFrame(offset, 58, 650).visible);
  assert.ok(visible.length >= 11);
  assert.equal(visible[0], -visible[visible.length - 1]);
});
