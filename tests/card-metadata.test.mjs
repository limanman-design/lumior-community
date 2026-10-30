import test from 'node:test';
import assert from 'node:assert/strict';
import { patchCanvasCard } from '../app/canvas-card-update.ts';
import { reconcileShared, libraryInstance } from '../app/shared-cards.ts';
import { dateAddedCards } from '../app/memory-atlas-data.ts';
import { cardCreatedTime, compareCardDates } from '../app/card-metadata.ts';
import { appendImportedMediaBatch } from '../app/media-card-creation.ts';
import { readWorkspace } from '../app/workspace-store.ts';

const old = '2026-10-01T10:00:00.000Z', now = '2026-10-16T10:00:00.000Z';
const card = (id, extra = {}) => ({ id, kind: 'note', title: id, body: 'Original', x: 0, y: 0, width: 400, createdAt: old, creationDateSource: 'actual', ...extra });
const board = (id, cards) => ({ id, title: id, cards, edges: [] });

test('editing moves a card ahead of newer creations and synchronizes reference metadata', () => {
  const a = board('a', [card('one'), card('two', { createdAt: '2026-10-10T00:00:00Z' })]);
  const b = board('b', [card('reference', { sharedId: 'one' })]);
  const result = patchCanvasCard(a, 'one', { body: 'Edited', tags: ['Research'] }, [a, b], now);
  assert.equal(result.board.cards[0].createdAt, old);
  assert.equal(result.board.cards[0].updatedAt, now);
  assert.equal(result.boards[1].cards[0].updatedAt, now);
  assert.deepEqual(result.boards[1].cards[0].tags, ['Research']);
  assert.equal([...result.board.cards].sort(compareCardDates)[0].id, 'one');
  assert.equal([...result.board.cards].sort((a,b)=>compareCardDates(a,b,'created'))[0].id, 'two');
});

test('moving, resizing and no-op content patches do not change modification dates', () => {
  const a = board('a', [card('one', { updatedAt: old })]);
  assert.equal(patchCanvasCard(a, 'one', { x: 100, width: 700 }, [a], now).board.cards[0].updatedAt, old);
  assert.equal(patchCanvasCard(a, 'one', { body: 'Original' }, [a], now).board, a);
  const moved = { ...a, cards: [{ ...a.cards[0], y: 200 }] };
  assert.equal(reconcileShared(a, moved, [a], now)[0].cards[0].updatedAt, old);
});

test('board-level edits and undo content receive modification dates', () => {
  const a = board('a', [card('one')]);
  const b = board('b', [card('reference', { sharedId: 'one' })]);
  const changed = { ...a, cards: [{ ...a.cards[0], title: 'Renamed' }] };
  const result = reconcileShared(a, changed, [a, b], now);
  assert.ok(result.every(board => board.cards[0].updatedAt === now));
  const undone = reconcileShared(result[0], a, result, '2026-10-17T00:00:00Z');
  assert.equal(undone[1].cards[0].title, 'one');
  assert.equal(undone[1].cards[0].updatedAt, '2026-10-17T00:00:00Z');
});

test('new notes and imports initialize dates, copies reset dates, references retain them', () => {
  const a = board('a', []);
  const added = dateAddedCards(a, board('a', [card('new', { createdAt: undefined })]), [a], now).cards[0];
  assert.equal(added.createdAt, now); assert.equal(added.updatedAt, now); assert.deepEqual(added.tags, []);
  const source = card('source', { updatedAt: old, tags: ['Work'] });
  const copy = libraryInstance(source, { x: 10, y: 10 }, false, 'copy');
  assert.notEqual(copy.createdAt, old); assert.equal(copy.updatedAt, copy.createdAt);
  assert.deepEqual(copy.tags, source.tags); assert.notEqual(copy.tags, source.tags);
  const reference = libraryInstance(source, { x: 10, y: 10 }, true, 'reference');
  assert.equal(reference.createdAt, old); assert.equal(reference.updatedAt, old);
  const imported = appendImportedMediaBatch([a], 'a', [{ kind: 'image', title: 'Image', body: '', image: '/test.png' }], { x: 0, y: 0 }, () => 'import', { now }).cards[0];
  assert.equal(imported.createdAt, now); assert.equal(imported.updatedAt, now);
});

test('unknown or simulated dates stay last and are not presented as real creation dates', () => {
  const legacy = card('legacy', { creationDateSource: 'simulated' });
  const unknown = card('unknown', { createdAt: 'invalid' });
  const actual = card('actual');
  assert.equal(cardCreatedTime(legacy), 0);
  assert.deepEqual([legacy, unknown, actual].sort(compareCardDates).map(card=>card.id), ['actual', 'legacy', 'unknown']);
  assert.equal(legacy.updatedAt, undefined);
});

test('workspace serialization preserves metadata without fabricating legacy updates', () => {
  const a = board('a', [card('one', { updatedAt: now, tags: ['Research', 'Games'] }), card('legacy')]);
  const restored = readWorkspace(JSON.stringify({ version: 1, boards: [a], deletedBoards: [], activeId: 'a', nextUntitledIndex: 1 }));
  assert.deepEqual(restored.boards[0].cards, a.cards);
  assert.equal(restored.boards[0].cards[1].updatedAt, undefined);
});

test('undoing deletion restores the original dates, including an unknown legacy update', () => {
  const empty = board('a', []);
  const restored = dateAddedCards(empty, board('a', [card('edited', { updatedAt: old }), card('legacy')]), [empty], now);
  assert.equal(restored.cards[0].createdAt, old);
  assert.equal(restored.cards[0].updatedAt, old);
  assert.equal(restored.cards[1].updatedAt, undefined);
});
