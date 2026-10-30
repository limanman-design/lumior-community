import assert from 'node:assert/strict';
import test from 'node:test';
import {
  emptyWorkspaceHistory, moveWorkspaceHistory, recordWorkspaceHistory,
  reconcileWorkspaceHistory, workspaceHistoryLimit,
} from '../app/workspace-history-model.ts';

const ids = ['a', 'b', 'c'];
const canvas = boardId => ({ page: 'canvas', boardId });
const page = name => ({ page: name, boardId: null });
const visit = entries => entries.reduce((state, entry) => recordWorkspaceHistory(state, entry, ids), emptyWorkspaceHistory);

test('back and forward replay boards and full-page destinations without recording a new visit', () => {
  const original = visit([canvas('a'), page('boards'), canvas('b'), page('library'), page('atlas')]);
  const back = moveWorkspaceHistory(original, -1, ids);
  assert.deepEqual(back.target, page('library'));
  assert.strictEqual(recordWorkspaceHistory(back.state, back.target, ids), back.state);
  const backAgain = moveWorkspaceHistory(back.state, -1, ids);
  assert.deepEqual(backAgain.target, canvas('b'));
  const forward = moveWorkspaceHistory(backAgain.state, 1, ids);
  assert.deepEqual(forward.target, page('library'));
  assert.deepEqual(moveWorkspaceHistory(forward.state, 1, ids).state, original);
  assert.deepEqual(original.entries, [canvas('a'), page('boards'), canvas('b'), page('library'), page('atlas')]);
});

test('a new visit after going back discards the old forward branch', () => {
  const original = visit([canvas('a'), canvas('b'), page('library')]);
  const back = moveWorkspaceHistory(original, -1, ids);
  const branched = recordWorkspaceHistory(back.state, page('atlas'), ids);
  assert.deepEqual(branched, { entries: [canvas('a'), canvas('b'), page('atlas')], index: 2 });
  assert.equal(moveWorkspaceHistory(branched, 1, ids).target, null);
  assert.equal(original.entries.length, 3);
});

test('full-page visits ignore the underlying board and repeated current destinations do not erase forward history', () => {
  const original = visit([canvas('a'), page('library'), canvas('b')]);
  const back = moveWorkspaceHistory(original, -1, ids);
  assert.strictEqual(recordWorkspaceHistory(back.state, { page: 'library', boardId: 'c' }, ids), back.state);
  assert.deepEqual(moveWorkspaceHistory(back.state, 1, ids).target, canvas('b'));
});

test('deleted boards are removed on both sides of the cursor and never replayed', () => {
  const original = visit([canvas('a'), page('boards'), canvas('b'), page('library'), canvas('c')]);
  const current = moveWorkspaceHistory(original, -1, ids).state;
  const pruned = reconcileWorkspaceHistory(current, ['a']);
  assert.deepEqual(pruned, { entries: [canvas('a'), page('boards'), page('library')], index: 2 });
  assert.equal(moveWorkspaceHistory(pruned, 1, ['a']).target, null);
  assert.deepEqual(moveWorkspaceHistory(pruned, -1, ['a']).target, page('boards'));
  assert.deepEqual(reconcileWorkspaceHistory(visit([canvas('a'), canvas('b')]), []), emptyWorkspaceHistory);
  assert.strictEqual(recordWorkspaceHistory(pruned, canvas('missing'), ['a']), pruned);
});

test('pruning duplicate adjacent pages preserves the cursor and useful later destinations', () => {
  const original = visit([page('library'), canvas('b'), page('library'), page('atlas')]);
  assert.deepEqual(reconcileWorkspaceHistory({ ...original, index: 2 }, ['a']), { entries: [page('library'), page('atlas')], index: 0 });
  const removedFirst = reconcileWorkspaceHistory({ ...original, entries: [canvas('b'), page('boards')], index: 0 }, ['a']);
  assert.deepEqual(removedFirst, { entries: [page('boards')], index: 0 });
  assert.equal(moveWorkspaceHistory(removedFirst, -1, ['a']).target, null);
});

test('history has stable boundaries and a bounded session size', () => {
  assert.equal(moveWorkspaceHistory(emptyWorkspaceHistory, -1, ids).target, null);
  assert.equal(moveWorkspaceHistory(emptyWorkspaceHistory, 1, ids).target, null);
  let state = emptyWorkspaceHistory;
  for (let index = 0; index < workspaceHistoryLimit + 5; index++) state = recordWorkspaceHistory(state, page(`view-${index}`), ids);
  assert.equal(state.entries.length, workspaceHistoryLimit);
  assert.equal(state.entries[0].page, 'view-5');
  assert.equal(state.index, workspaceHistoryLimit - 1);
  assert.equal(moveWorkspaceHistory(state, 1, ids).target, null);
});

test('standalone content history uses exact available identities and never remembers an underlying board', () => {
  const available = [...ids, 'content:paper', 'content:note'];
  let state = recordWorkspaceHistory(emptyWorkspaceHistory, page('boards'), available);
  state = recordWorkspaceHistory(state, { page: 'content:paper', boardId: 'a' }, available);
  state = recordWorkspaceHistory(state, { page: 'content:note', boardId: 'b' }, available);
  assert.deepEqual(state.entries, [page('boards'), page('content:paper'), page('content:note')]);
  const back = moveWorkspaceHistory(state, -1, available);
  assert.deepEqual(back.target, page('content:paper'));
  assert.strictEqual(recordWorkspaceHistory(back.state, { page: 'content:paper', boardId: 'c' }, available), back.state);
  assert.deepEqual(moveWorkspaceHistory(back.state, 1, available).target, page('content:note'));
  assert.strictEqual(recordWorkspaceHistory(state, page('content:missing'), available), state);
  assert.strictEqual(recordWorkspaceHistory(state, page('content:paper:missing'), available), state);
});

test('deleting content removes its backward and forward destinations but preserves Home and board visits', () => {
  const available = [...ids, 'content:paper', 'content:note'];
  const visits = [page('boards'), page('content:paper'), canvas('a'), page('content:note'), page('boards')];
  const history = visits.reduce((state, entry) => recordWorkspaceHistory(state, entry, available), emptyWorkspaceHistory);
  const current = moveWorkspaceHistory(history, -1, available).state;
  const pruned = reconcileWorkspaceHistory(current, ids);
  assert.deepEqual(pruned, { entries: [page('boards'), canvas('a'), page('boards')], index: 1 });
  assert.deepEqual(moveWorkspaceHistory(pruned, -1, ids).target, page('boards'));
  assert.deepEqual(moveWorkspaceHistory(pruned, 1, ids).target, page('boards'));
});

test('canvas readers keep their source board across history replay without adopting the current canvas', () => {
  const available = [...ids, 'content:paper', 'content:note'];
  const paper = { ...page('content:paper'), returnBoardId: 'a' };
  const note = { ...page('content:note'), returnBoardId: 'a' };
  const visits = [canvas('a'), paper, note, canvas('b')];
  const history = visits.reduce((state, entry) => recordWorkspaceHistory(state, entry, available), emptyWorkspaceHistory);
  const back = moveWorkspaceHistory(history, -1, available);
  assert.deepEqual(back.target, note);
  assert.strictEqual(recordWorkspaceHistory(back.state, { ...note, boardId: 'b' }, available), back.state);
  const backAgain = moveWorkspaceHistory(back.state, -1, available);
  assert.deepEqual(backAgain.target, paper);
  assert.deepEqual(moveWorkspaceHistory(backAgain.state, 1, available).target, note);
  assert.deepEqual(moveWorkspaceHistory(back.state, 1, available).target, canvas('b'));
});

test('an existing independent file tab stays distinct from the same content expanded on either board', () => {
  const available = [...ids, 'content:paper'];
  const standalone = page('content:paper');
  const fromA = { ...standalone, returnBoardId: 'a' };
  const fromB = { ...standalone, returnBoardId: 'b' };
  const visits = [standalone, fromA, fromB, standalone];
  const history = visits.reduce((state, entry) => recordWorkspaceHistory(state, entry, available), emptyWorkspaceHistory);
  assert.deepEqual(history.entries, visits);
  const back = moveWorkspaceHistory(history, -1, available);
  assert.deepEqual(back.target, fromB);
  assert.deepEqual(moveWorkspaceHistory(back.state, 1, available).target, standalone);
});

test('deleting a source board drops only its temporary readers, preserving independent content history', () => {
  const available = [...ids, 'content:paper', 'content:note'];
  const standalone = page('content:paper');
  const fromA = { ...standalone, returnBoardId: 'a' };
  const fromB = { ...page('content:note'), returnBoardId: 'b' };
  const visits = [page('boards'), standalone, fromA, fromB, canvas('c')];
  const history = visits.reduce((state, entry) => recordWorkspaceHistory(state, entry, available), emptyWorkspaceHistory);
  const surviving = available.filter(id => id !== 'a');
  const pruned = reconcileWorkspaceHistory(history, surviving);
  assert.deepEqual(pruned.entries, [page('boards'), standalone, fromB, canvas('c')]);
  assert.strictEqual(recordWorkspaceHistory(pruned, fromA, surviving), pruned);
  assert.deepEqual(reconcileWorkspaceHistory(pruned, ['b', 'c']).entries, [page('boards'), canvas('c')]);
  assert.deepEqual(reconcileWorkspaceHistory({ entries: [fromA], index: 0 }, surviving), emptyWorkspaceHistory);
});
