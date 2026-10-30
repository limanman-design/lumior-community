import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAiBoardActions } from '../app/ai-board-actions.ts';
import { readAiBoardContext } from '../lib/ai-board-tools.ts';

const card = (id, extra = {}) => ({ id, kind: 'note', title: id, body: 'Original text', x: 0, y: 0, width: 360, height: 300, ...extra });
const board = (extra = {}) => ({ id: 'board', title: 'My research', cards: [card('source'), card('other', { x: 900 })], edges: [], sections: [{ id: 'section', title: 'Keep me', x: 0, y: 0, width: 1600, height: 1000, color: '#aaa' }], ...extra });
const batch = (extra = {}) => ({ id: 'question-1', boardId: 'board', notes: [{ id: 'new:summary', title: 'Research summary', body: '## Findings\n\nA new editable note.' }], connections: [{ from: 'source', to: 'new:summary', label: 'Evidence' }], ...extra });
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

test('one immutable board contains the complete new notes and links while preserving all existing objects', () => {
  const source = freeze(board({ edges: [{ id: 'old-edge', from: 'source', to: 'other', label: 'Original relation' }] }));
  const action = freeze(batch({ notes: [...batch().notes, { id: 'new:questions', title: 'Questions', body: 'What evidence is missing?' }],
    connections: [...batch().connections, { from: 'new:summary', to: 'new:questions' }, { from: 'other', to: 'new:questions' }] }));
  const result = applyAiBoardActions(source, action, { point: { x: 300, y: 200 } });
  assert.equal(result.actionId, action.id);
  assert.equal(result.alreadyApplied, false);
  assert.equal(result.createdCards, 2);
  assert.equal(result.createdConnections, 3);
  assert.deepEqual(result.cardIds, ['ai-note:question-1:new:summary', 'ai-note:question-1:new:questions']);
  assert.deepEqual(result.edgeIds, ['ai-edge:question-1:0', 'ai-edge:question-1:1', 'ai-edge:question-1:2']);
  assert.equal(result.board.id, source.id);
  assert.equal(result.board.title, source.title);
  assert.strictEqual(result.board.sections, source.sections);
  assert.strictEqual(result.board.cards[0], source.cards[0]);
  assert.strictEqual(result.board.cards[1], source.cards[1]);
  assert.strictEqual(result.board.edges[0], source.edges[0]);
  const note = result.board.cards[2];
  assert.equal(note.body, action.notes[0].body);
  assert.equal(note.kind, 'note');
  assert.equal(note.contentRole, 'note');
  assert.equal(note.creationDateSource, 'actual');
  assert.ok(!Number.isNaN(Date.parse(note.createdAt)));
  assert.equal(note.createdAt, note.updatedAt);
  assert.equal(note.sourceContentId, undefined);
  assert.deepEqual(result.board.edges.slice(1).map(({ from, to, label }) => ({ from, to, label })), [
    { from: 'source', to: result.cardIds[0], label: 'Evidence' },
    { from: result.cardIds[0], to: result.cardIds[1], label: undefined },
    { from: 'other', to: result.cardIds[1], label: undefined },
  ]);
  assert.equal(source.cards.length, 2);
  assert.equal(source.edges.length, 1);
});

test('layout leaves measured old cards untouched and reserves reading space among a twelve-note batch', () => {
  const source = freeze(board({ cards: [card('source', { x: -600, y: -200, width: 1800, height: 100 })] }));
  const notes = Array.from({ length: 12 }, (_, index) => ({ id: `new:${index}`, title: `Note ${index}`, body: 'Readable body' }));
  const result = applyAiBoardActions(source, batch({ notes, connections: [] }), {
    point: { x: 0, y: 0 }, measuredHeights: { source: 1300 },
  });
  const added = result.board.cards.slice(1);
  assert.equal(new Set(added.map(item => item.x)).size, 3);
  assert.strictEqual(result.board.cards[0], source.cards[0]);
  for (const item of added) {
    assert.ok(item.y >= source.cards[0].y + 1300 + 32);
    assert.ok(item.width >= 360 && item.height >= 300);
    for (const other of added) {
      if (item === other) continue;
      assert.equal(item.x < other.x + other.width && item.x + item.width > other.x
        && item.y < other.y + other.height && item.y + item.height > other.y, false);
    }
  }
});

test('existing and repeated undirected connections are skipped with accurate actual counts', () => {
  const source = freeze(board({ edges: [{ id: 'keep', from: 'other', to: 'source', label: 'Do not replace' }] }));
  const action = batch({ connections: [
    { from: 'source', to: 'other', label: 'Cannot overwrite label' },
    { from: 'source', to: 'new:summary', label: 'Evidence' },
    { from: 'new:summary', to: 'source', label: 'Duplicate direction' },
  ] });
  const first = applyAiBoardActions(source, action);
  assert.equal(first.createdConnections, 1);
  assert.deepEqual(first.edgeIds, ['ai-edge:question-1:1']);
  assert.strictEqual(first.board.edges[0], source.edges[0]);
  const replay = applyAiBoardActions(first.board, action);
  assert.equal(replay.alreadyApplied, true);
  assert.strictEqual(replay.board, first.board);
  assert.equal(replay.createdConnections, 0);
  assert.equal(replay.createdCards, 0);
  assert.deepEqual(replay.edgeIds, first.edgeIds);
});

test('an existing-only connection batch is atomic, idempotent and does not manufacture notes', () => {
  const source = freeze(board());
  const action = batch({ notes: [], connections: [{ from: 'source', to: 'other', label: 'Compare' }] });
  const first = applyAiBoardActions(source, action);
  assert.equal(first.createdCards, 0);
  assert.equal(first.createdConnections, 1);
  assert.deepEqual(first.cardIds, []);
  assert.strictEqual(first.board.cards, source.cards);
  const replay = applyAiBoardActions(first.board, action);
  assert.equal(replay.alreadyApplied, true);
  assert.strictEqual(replay.board, first.board);
  assert.equal(replay.createdConnections, 0);
});

test('duplicate existing-only relations return the original board and report zero changes', () => {
  const source = freeze(board({ edges: [{ id: 'keep', from: 'source', to: 'other' }] }));
  const result = applyAiBoardActions(source, batch({ notes: [], connections: [{ from: 'other', to: 'source' }] }));
  assert.strictEqual(result.board, source);
  assert.equal(result.createdCards, 0);
  assert.equal(result.createdConnections, 0);
  assert.deepEqual(result.edgeIds, []);
});

test('persisted stable identifiers prevent replay after a reload and tolerate subsequent layout moves', () => {
  const action = batch();
  const first = applyAiBoardActions(board(), action);
  const persisted = JSON.parse(JSON.stringify(first.board));
  persisted.cards.at(-1).x = 6000;
  persisted.cards.at(-1).y = -4000;
  persisted.cards.at(-1).width = 600;
  const replay = applyAiBoardActions(freeze(persisted), action);
  assert.strictEqual(replay.board, persisted);
  assert.equal(replay.alreadyApplied, true);
  assert.equal(replay.createdCards, 0);
  assert.equal(replay.createdConnections, 0);
});

test('a trusted applied-action set prevents a replay after undo or removal without mutating the set', () => {
  const source = freeze(board());
  const applied = new Set(['question-1']);
  const result = applyAiBoardActions(source, batch(), { appliedActionIds: applied });
  assert.strictEqual(result.board, source);
  assert.equal(result.alreadyApplied, true);
  assert.equal(result.createdCards, 0);
  assert.equal(result.createdConnections, 0);
  assert.deepEqual([...applied], ['question-1']);
  assert.throws(() => applyAiBoardActions({ ...source, id: 'different' }, batch(), { appliedActionIds: applied }));
});

test('invalid targets, self-links and stale board scope reject all notes rather than making partial progress', () => {
  const source = freeze(board());
  const invalid = [
    batch({ boardId: 'different' }),
    batch({ connections: [...batch().connections, { from: 'source', to: 'missing' }] }),
    batch({ connections: [{ from: 'source', to: 'source' }] }),
    batch({ connections: [{ from: 'new:summary', to: 'new:summary' }] }),
    batch({ connections: [{ from: 'new:undefined', to: 'source' }] }),
  ];
  for (const action of invalid) assert.throws(() => applyAiBoardActions(source, action));
  assert.equal(source.cards.length, 2);
  assert.equal(source.edges.length, 0);
});

test('local aliases cannot shadow existing card identities', () => {
  const source = freeze(board({ cards: [card('source'), card('new:summary')] }));
  assert.throws(() => applyAiBoardActions(source, batch()), /冲突/);
});

test('malformed and excessive model output is rejected before any board data changes', () => {
  const source = freeze(board());
  const note = batch().notes[0];
  const invalid = [
    null,
    batch({ notes: [{ ...note, id: 'existing-id' }] }),
    batch({ notes: [note, note] }),
    batch({ notes: [{ ...note, title: 'x'.repeat(201) }] }),
    batch({ notes: [{ ...note, body: 'x'.repeat(20001) }] }),
    batch({ notes: [{ ...note, body: 42 }] }),
    batch({ notes: Array.from({ length: 13 }, (_, i) => ({ ...note, id: `new:${i}` })) }),
    batch({ connections: Array.from({ length: 25 }, () => ({ from: 'source', to: 'other' })) }),
    batch({ connections: [{ from: 'source', to: 'other', label: 'x'.repeat(121) }] }),
    batch({ connections: [{ from: 'source', to: {} }] }),
  ];
  for (const action of invalid) assert.throws(() => applyAiBoardActions(source, action));
  assert.equal(source.cards.length, 2);
  assert.equal(source.edges.length, 0);
});

test('partial persisted actions and stable-ID collisions are rejected atomically', () => {
  const action = batch({ notes: [...batch().notes, { id: 'new:second', title: 'Second', body: 'Another note' }],
    connections: [...batch().connections, { from: 'new:summary', to: 'new:second' }] });
  const complete = applyAiBoardActions(board(), action).board;
  const invalidBoards = [
    { ...complete, cards: complete.cards.filter(item => item.id !== 'ai-note:question-1:new:second') },
    { ...complete, edges: [] },
    { ...complete, cards: complete.cards.slice(0, 2) },
    { ...complete, cards: complete.cards.map(item => item.id === 'ai-note:question-1:new:summary' ? { ...item, body: 'Edited by user' } : item) },
    { ...complete, edges: complete.edges.map(item => ({ ...item, label: 'Edited relation' })) },
  ];
  for (const source of invalidBoards) {
    freeze(source);
    assert.throws(() => applyAiBoardActions(source, action));
  }
});

test('a partly restored connection-only action does not append its missing connections', () => {
  const source = board({ cards: [card('source'), card('other'), card('third')] });
  const action = batch({ notes: [], connections: [{ from: 'source', to: 'other' }, { from: 'other', to: 'third' }] });
  const complete = applyAiBoardActions(source, action).board;
  const partial = freeze({ ...complete, edges: complete.edges.slice(0, 1) });
  assert.throws(() => applyAiBoardActions(partial, action), /部分/);
  assert.equal(partial.edges.length, 1);
});

test('invalid geometry and ambiguous existing IDs never leak an incomplete candidate board', () => {
  const source = freeze(board());
  assert.throws(() => applyAiBoardActions(source, batch(), { point: { x: NaN, y: 0 } }), /位置/);
  assert.throws(() => applyAiBoardActions(source, batch(), { point: { x: 0, y: Infinity } }), /位置/);
  assert.throws(() => applyAiBoardActions(freeze(board({ cards: [card('source'), card('source')] })), batch()), /重复/);
  assert.throws(() => applyAiBoardActions(freeze(board({ edges: [{ id: 'duplicate', from: 'source', to: 'other' }, { id: 'duplicate', from: 'other', to: 'source' }] })), batch()), /重复/);
});

test('persistent note IDs accept the context limit exactly and reject overlong compositions atomically', () => {
  const source = freeze(board());
  const localId = 'new:n';
  const maximumActionLength = 200 - 'ai-note:'.length - ':'.length - localId.length;
  const accepted = batch({ id: 'q'.repeat(maximumActionLength), notes: [{ id: localId, title: 'Boundary', body: 'Readable note' }], connections: [] });
  const result = applyAiBoardActions(source, accepted);
  assert.equal(result.cardIds[0].length, 200);
  assert.doesNotThrow(() => readAiBoardContext({ boardId: result.board.id,
    cards: result.board.cards.map(({ id, title, kind }) => ({ id, title, kind })), edges: [] }));
  const rejected = { ...accepted, id: accepted.id + 'q' };
  assert.throws(() => applyAiBoardActions(source, rejected), /标识过长/);
  assert.throws(() => applyAiBoardActions(source, rejected, { appliedActionIds: new Set([rejected.id]) }), /标识过长/);
  assert.equal(source.cards.length, 2);
  assert.equal(source.edges.length, 0);
});

test('persistent edge IDs enforce the same limit, including two-digit connection indices', () => {
  const source = freeze(board({ cards: Array.from({ length: 13 }, (_, i) => card(`source-${i}`)) }));
  const connections = Array.from({ length: 11 }, (_, i) => ({ from: 'source-0', to: `source-${i + 1}` }));
  const accepted = batch({ id: 'q'.repeat(189), notes: [], connections });
  const result = applyAiBoardActions(source, accepted);
  assert.equal(result.edgeIds.at(-1).length, 200);
  assert.equal(result.createdConnections, 11);
  assert.throws(() => applyAiBoardActions(source, { ...accepted, id: accepted.id + 'q' }), /标识过长/);
  const single = batch({ id: 'q'.repeat(190), notes: [], connections: [connections[0]] });
  assert.equal(applyAiBoardActions(source, single).edgeIds[0].length, 200);
  assert.throws(() => applyAiBoardActions(source, { ...single, id: single.id + 'q' }), /标识过长/);
  assert.equal(source.edges.length, 0);
});
