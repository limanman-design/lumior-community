import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampNoteContentHeight,
  defaultNoteFitLimits,
  isNoteFitLimits,
  normalizeNoteFitLimits,
  noteFitStorageKey,
} from '../app/note-size-preferences.ts';

let generation = 0;
const freshCore = () =>
  import(`../app/note-size-preferences.ts?test=${++generation}`);
function memoryStorage() {
  const values = new Map();
  const writes = [];
  return {
    values,
    writes,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      writes.push([key, value]);
      values.set(key, value);
    },
  };
}

test('height measurements ceil and clamp short, long and invalid content safely', () => {
  assert.deepEqual(defaultNoteFitLimits, { minHeight: 120, maxHeight: 800 });
  for (const height of [0, -400, 119.9, NaN, Infinity, -Infinity, '500'])
    assert.equal(clampNoteContentHeight(height), 120);
  assert.equal(clampNoteContentHeight(342.01), 343);
  assert.equal(clampNoteContentHeight(799.01), 800);
  assert.equal(clampNoteContentHeight(1_000_000), 800);
  assert.equal(
    clampNoteContentHeight(1900.1, { minHeight: 300, maxHeight: 2400 }),
    1901,
  );
  assert.equal(
    clampNoteContentHeight(200, { minHeight: NaN, maxHeight: 1 }),
    200,
  );
});

test('normalization bounds integer data and orders a reversed pair', () => {
  assert.deepEqual(normalizeNoteFitLimits({ minHeight: -5, maxHeight: 9999 }), {
    minHeight: 120,
    maxHeight: 2400,
  });
  assert.deepEqual(normalizeNoteFitLimits({ minHeight: 900, maxHeight: 300 }), {
    minHeight: 300,
    maxHeight: 900,
  });
  assert.deepEqual(
    normalizeNoteFitLimits({ minHeight: 9999, maxHeight: 8888 }),
    {
      minHeight: 2400,
      maxHeight: 2400,
    },
  );
  for (const value of [
    null,
    undefined,
    false,
    '120,800',
    [120, 800],
    {},
    { minHeight: 120 },
    { minHeight: '120', maxHeight: 800 },
    { minHeight: 120.5, maxHeight: 800 },
    { minHeight: NaN, maxHeight: 800 },
    { minHeight: 120, maxHeight: Infinity },
  ]) {
    assert.equal(isNoteFitLimits(value), false);
    assert.deepEqual(normalizeNoteFitLimits(value), defaultNoteFitLimits);
  }
  for (const pair of [
    { minHeight: 120, maxHeight: 800 },
    { minHeight: 120, maxHeight: 120 },
    { minHeight: 2400, maxHeight: 2400 },
  ])
    assert.equal(isNoteFitLimits(pair), true);
});

test('the store rejects invalid pairs atomically and keeps stable, immutable snapshots', async () => {
  const core = await freshCore();
  const storage = memoryStorage();
  core.initializeNoteFitLimits(storage);
  let notifications = 0;
  const unsubscribe = core.subscribeNoteFitLimits(() => notifications++);
  const original = core.getNoteFitLimits();
  assert.equal(original, core.defaultNoteFitLimits);
  for (const value of [
    { minHeight: 100, maxHeight: 800 },
    { minHeight: 120, maxHeight: 2500 },
    { minHeight: 900, maxHeight: 800 },
    { minHeight: 120, maxHeight: 800.5 },
    { minHeight: NaN, maxHeight: 800 },
    { minHeight: 120, maxHeight: Infinity },
    { minHeight: 300 },
  ])
    assert.equal(core.setNoteFitLimits(value), false);
  assert.equal(core.getNoteFitLimits(), original);
  assert.equal(storage.writes.length, 0);
  assert.equal(notifications, 0);
  const input = { minHeight: 240, maxHeight: 1000 };
  assert.equal(core.setNoteFitLimits(input), true);
  input.minHeight = 700;
  assert.deepEqual(core.getNoteFitLimits(), {
    minHeight: 240,
    maxHeight: 1000,
  });
  assert.ok(Object.isFrozen(core.getNoteFitLimits()));
  const saved = core.getNoteFitLimits();
  core.setNoteFitLimits({ minHeight: 240, maxHeight: 1000 });
  assert.equal(core.getNoteFitLimits(), saved);
  assert.equal(notifications, 1);
  unsubscribe();
  core.setNoteFitLimits({ minHeight: 300, maxHeight: 1200 });
  assert.equal(notifications, 1);
});

test('refresh restores only height preferences and mounting twice retains a session change', async () => {
  const storage = memoryStorage();
  const first = await freshCore();
  first.initializeNoteFitLimits(storage);
  first.setNoteFitLimits({ minHeight: 200, maxHeight: 1600 });
  assert.deepEqual(storage.writes, [
    [noteFitStorageKey, '{"minHeight":200,"maxHeight":1600}'],
  ]);
  const refreshed = await freshCore();
  assert.equal(refreshed.getNoteFitLimits(), refreshed.defaultNoteFitLimits);
  refreshed.initializeNoteFitLimits(storage);
  assert.deepEqual(refreshed.getNoteFitLimits(), {
    minHeight: 200,
    maxHeight: 1600,
  });
  storage.values.set(noteFitStorageKey, '{"minHeight":120,"maxHeight":800}');
  refreshed.initializeNoteFitLimits(storage);
  assert.deepEqual(refreshed.getNoteFitLimits(), {
    minHeight: 200,
    maxHeight: 1600,
  });
});

test('cross-window synchronization does not echo writes and removal returns to defaults', async () => {
  const core = await freshCore();
  const storage = memoryStorage();
  core.initializeNoteFitLimits(storage);
  core.synchronizeNoteFitLimits('{"minHeight":300,"maxHeight":1500}');
  assert.deepEqual(core.getNoteFitLimits(), {
    minHeight: 300,
    maxHeight: 1500,
  });
  assert.equal(storage.writes.length, 0);
  core.synchronizeNoteFitLimits('{"minHeight":50,"maxHeight":3000}');
  assert.deepEqual(core.getNoteFitLimits(), {
    minHeight: 120,
    maxHeight: 2400,
  });
  core.synchronizeNoteFitLimits('broken JSON');
  assert.deepEqual(core.getNoteFitLimits(), core.defaultNoteFitLimits);
  core.synchronizeNoteFitLimits('{"minHeight":200,"maxHeight":1200}');
  core.synchronizeNoteFitLimits(null);
  assert.deepEqual(core.getNoteFitLimits(), core.defaultNoteFitLimits);
  assert.equal(storage.writes.length, 0);
});

test('unavailable storage does not prevent settings in the current session', async () => {
  const core = await freshCore();
  const denied = {
    getItem() {
      throw new Error('Storage disabled');
    },
    setItem() {
      throw new Error('Quota exceeded');
    },
  };
  assert.doesNotThrow(() => core.initializeNoteFitLimits(denied));
  assert.equal(core.getNoteFitLimits(), core.defaultNoteFitLimits);
  assert.equal(core.setNoteFitLimits({ minHeight: 180, maxHeight: 900 }), true);
  assert.deepEqual(core.getNoteFitLimits(), { minHeight: 180, maxHeight: 900 });
});
