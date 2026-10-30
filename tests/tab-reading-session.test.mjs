import test from 'node:test';
import assert from 'node:assert/strict';
import { createTabReadingSessionStore, finiteScrollPosition, tabReadingSessionKey } from '../app/tab-reading-session-model.ts';

test('same card in different boards and media sources restores only its own session', () => {
  const store = createTabReadingSessionStore();
  const key = tabReadingSessionKey('board-a', 'shared-card', 'pdf', 'file-v1');
  store.save('board-a', key, { page: 4, fraction: .63 });
  assert.deepEqual(store.get(key), { page: 4, fraction: .63 });
  assert.equal(store.get(tabReadingSessionKey('board-b', 'shared-card', 'pdf', 'file-v1')), undefined);
  assert.equal(store.get(tabReadingSessionKey('board-a', 'shared-card', 'pdf', 'file-v2')), undefined);
  assert.notEqual(tabReadingSessionKey('a:b', 'c', 'note'), tabReadingSessionKey('a', 'b:c', 'note'));
});

test('pruning deleted boards also rejects their later reader cleanup write', () => {
  const store = createTabReadingSessionStore(), removed = tabReadingSessionKey('removed', 'card', 'note');
  store.save('removed', removed, { scrollTop: 840 });
  store.prune(['retained']);
  store.save('removed', removed, { scrollTop: 0 });
  assert.equal(store.get(removed), undefined);
  const kept = tabReadingSessionKey('retained', 'card', 'note');
  store.save('retained', kept, { scrollTop: 50 });
  assert.deepEqual(store.get(kept), { scrollTop: 50 });
  assert.equal(createTabReadingSessionStore().get(kept), undefined);
});

test('scroll snapshots preserve zero and fractional offsets while rejecting invalid geometry', () => {
  assert.deepEqual(finiteScrollPosition({ scrollTop: 0, scrollLeft: 4.75 }), { scrollTop: 0, scrollLeft: 4.75 });
  assert.deepEqual(finiteScrollPosition({ scrollTop: -20, scrollLeft: Infinity }), { scrollTop: 0, scrollLeft: 0 });
  assert.deepEqual(finiteScrollPosition({ scrollTop: NaN }), { scrollTop: 0, scrollLeft: 0 });
});
