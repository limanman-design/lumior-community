import assert from 'node:assert/strict';
import test from 'node:test';
import {
  closeBoardTab,
  readBoardTabs,
  reconcileBoardTabs,
  selectBoardTab,
  serializeBoardTabs,
} from '../app/board-tabs-model.ts';

const available = ['a', 'b', 'c', 'd'];

test('opening boards from any navigation adds one tab and retains opening order', () => {
  let state = { ids: ['a', 'b'], activeId: 'b' };
  state = selectBoardTab(state, 'a', available);
  assert.deepEqual(state, { ids: ['a', 'b'], activeId: 'a' });
  state = selectBoardTab(state, 'c', available);
  assert.deepEqual(state, { ids: ['a', 'b', 'c'], activeId: 'c' });
  assert.deepEqual(selectBoardTab(state, 'missing', available), state);
});

test('closing the active tab selects its right neighbor then left neighbor', () => {
  const middle = { ids: ['a', 'b', 'c'], activeId: 'b' };
  assert.deepEqual(closeBoardTab(middle, 'b'), { ids: ['a', 'c'], activeId: 'c' });
  assert.deepEqual(closeBoardTab({ ...middle, activeId: 'c' }, 'c'), { ids: ['a', 'b'], activeId: 'b' });
  assert.deepEqual(closeBoardTab({ ids: ['a'], activeId: 'a' }, 'a'), { ids: [], activeId: null });
  assert.deepEqual(middle, { ids: ['a', 'b', 'c'], activeId: 'b' });
});

test('closing inactive tabs preserves navigation and cannot remove a board', () => {
  const state = { ids: ['a', 'b'], activeId: 'b' };
  assert.deepEqual(closeBoardTab(state, 'a'), { ids: ['b'], activeId: 'b' });
  assert.deepEqual(available, ['a', 'b', 'c', 'd']);
  assert.strictEqual(closeBoardTab(state, 'missing'), state);
  assert.deepEqual(closeBoardTab({ ...state, activeId: null }, 'b'), { ids: ['a'], activeId: null });
});

test('deleted boards are filtered and active deletion falls back to the next surviving neighbor', () => {
  const state = { ids: ['a', 'b', 'c', 'd'], activeId: 'b' };
  assert.deepEqual(reconcileBoardTabs(state, ['a', 'd']), { ids: ['a', 'd'], activeId: 'd' });
  assert.deepEqual(reconcileBoardTabs(state, ['a']), { ids: ['a'], activeId: 'a' });
  assert.deepEqual(reconcileBoardTabs(state, []), { ids: [], activeId: null });
  assert.deepEqual(reconcileBoardTabs({ ...state, activeId: null }, ['a', 'd']), { ids: ['a', 'd'], activeId: null });
});

test('tab persistence contains identities only and restored navigation follows the workspace', () => {
  const serialized = serializeBoardTabs({ ids: ['a', 'c'], activeId: 'c' });
  assert.deepEqual(JSON.parse(serialized), { version: 1, ids: ['a', 'c'] });
  const restored = readBoardTabs(serialized, available);
  assert.deepEqual(restored, { ids: ['a', 'c'], activeId: null });
  assert.deepEqual(selectBoardTab(restored, 'b', available), { ids: ['a', 'c', 'b'], activeId: 'b' });
});

test('stale, duplicate, malformed and unsupported saved tabs cannot reopen deleted boards', () => {
  assert.deepEqual(readBoardTabs(JSON.stringify({ version: 1, ids: ['c', 'missing', 'a', 'c', null, {}, 1], title: 'ignored', key: 'ignored' }), available), { ids: ['c', 'a'], activeId: null });
  for (const raw of [null, '', '{', 'null', '[]', '{"version":2,"ids":["a"]}', '{"version":1,"ids":"a"}', ' '.repeat(32_769)]) {
    assert.deepEqual(readBoardTabs(raw, available), { ids: [], activeId: null });
  }
});

test('Home, canonical content, legacy boards and databases retain separate identities across tab restore', () => {
  const mixed = ['workspace:home', 'legacy-board', 'content:paper', 'content:note', 'database:tasks'];
  let state = { ids: [], activeId: null };
  for (const id of mixed) state = selectBoardTab(state, id, mixed);
  assert.deepEqual(state.ids, mixed);
  state = selectBoardTab(state, 'content:note', mixed);
  assert.equal(state.ids.length, mixed.length);
  const restored = readBoardTabs(serializeBoardTabs(state), mixed);
  assert.deepEqual(restored, { ids: mixed, activeId: null });
  assert.equal(closeBoardTab(state, 'content:note').activeId, 'database:tasks');
  const surviving = mixed.filter(id => id !== 'content:paper');
  assert.deepEqual(readBoardTabs(serializeBoardTabs(state), surviving).ids, surviving);
  assert.deepEqual(readBoardTabs(JSON.stringify({ version: 1, ids: ['content:missing', 'workspace:home', 'content:note'] }), surviving).ids, ['workspace:home', 'content:note']);
});
