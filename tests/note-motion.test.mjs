import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NoteCreationLifecycle, noteHasContent, noteMotionChanges } from '../app/note-motion-model.ts';

const card = (id, kind = 'note') => ({ id, kind, title: id, body: '', x: 0, y: 0, width: 360 });
const board = (cards, id = 'board') => ({ id, title: id, cards, edges: [] });

test('mutation detection identifies only new and removed Note IDs, including batches', () => {
  const before = board([card('a'), card('b'), card('pdf', 'pdf')]);
  const after = board([card('a'), card('c'), card('d'), card('image', 'image')]);
  assert.deepEqual(noteMotionChanges(before, after), { added: ['c', 'd'], removed: ['b'] });
  assert.equal(before.cards.length, 3);
  assert.equal(after.cards.length, 4);
});

const emptyNote = id => ({ ...card(id), title: 'Untitled' });

test('new blank Notes reveal only on the first content-bearing focus exit', () => {
  const lifecycle = new NoteCreationLifecycle();
  const before = board([]), created = board([emptyNote('new')]);
  lifecycle.prepare(before, created);
  assert.equal(lifecycle.leave('board', 'new'), false, 'empty blur keeps creation pending');
  const typed = board([{ ...created.cards[0], body: 'First thought' }]);
  lifecycle.prepare(created, typed);
  assert.equal(lifecycle.leave('board', 'new'), true);
  assert.equal(lifecycle.leave('board', 'new'), false, 'one reveal per new Note');
  lifecycle.prepare(typed, board([{ ...typed.cards[0], body: 'Edited again' }]));
  assert.equal(lifecycle.leave('board', 'new'), false, 'later edits do not rearm it');
});

test('clearing the first input before blur postpones reveal until content exists again', () => {
  const lifecycle = new NoteCreationLifecycle();
  const empty = board([emptyNote('new')]);
  const typed = board([{ ...empty.cards[0], body: 'Draft' }]);
  lifecycle.prepare(board([]), empty);
  lifecycle.prepare(empty, typed);
  lifecycle.prepare(typed, empty);
  assert.equal(lifecycle.leave('board', 'new'), false);
  lifecycle.prepare(empty, board([{ ...empty.cards[0], title: 'A useful title' }]));
  assert.equal(lifecycle.leave('board', 'new'), true, 'a title alone is real first input');
});

test('editor initialization and whitespace do not arm an empty Note', () => {
  assert.equal(noteHasContent(emptyNote('new')), false);
  assert.equal(noteHasContent({ ...emptyNote('new'), body: ' \n\u200b ' }), false);
  assert.equal(noteHasContent({ ...emptyNote('new'), body: 'stale body', blocks: [{ type: 'paragraph', content: [] }] }), false);
  assert.equal(noteHasContent({ ...emptyNote('new'), blocks: [{ type: 'paragraph', content: [{ type: 'text', text: 'Typed', styles: {} }] }] }), true);
  assert.equal(noteHasContent({ ...emptyNote('new'), blocks: [{ type: 'image', props: { url: '/image.png' } }] }), true);
});

test('prefilled and duplicated Notes still wait for a focus exit; stored Notes never rearm', () => {
  const lifecycle = new NoteCreationLifecycle();
  const stored = board([card('stored')]);
  const added = board([...stored.cards, { ...emptyNote('ai'), body: 'Saved AI answer' }, { ...card('copy'), body: 'Duplicated content' }]);
  lifecycle.prepare(stored, added);
  assert.equal(lifecycle.leave('board', 'stored'), false);
  assert.equal(lifecycle.leave('board', 'ai'), true);
  assert.equal(lifecycle.leave('board', 'copy'), true);
  assert.equal(lifecycle.leave('board', 'copy'), false);
});

test('deletion, undo clearing, board switches and reduced-motion clearing discard pending reveals', () => {
  const lifecycle = new NoteCreationLifecycle();
  const created = board([card('new')]);
  lifecycle.prepare(board([]), created);
  lifecycle.prepare(created, board([]));
  assert.equal(lifecycle.leave('board', 'new'), false);
  lifecycle.prepare(board([]), created);
  lifecycle.clear();
  assert.equal(lifecycle.leave('board', 'new'), false);
  lifecycle.prepare(created, { ...created, title: 'Restored' });
  assert.equal(lifecycle.leave('board', 'new'), false, 'existing restored Notes stay unarmed');
  lifecycle.prepare(board([]), created);
  lifecycle.prepare(created, board([card('elsewhere')], 'other'));
  assert.equal(lifecycle.leave('board', 'new'), false);
  assert.equal(lifecycle.leave('other', 'elsewhere'), false);
});

test('outgoing board cleanup preserves a Note added to the incoming board in the same event', () => {
  const lifecycle = new NoteCreationLifecycle();
  const first = board([card('old')], 'first');
  lifecycle.prepare(board([], 'first'), first);
  const other = board([], 'other');
  lifecycle.prepare(other, board([card('incoming')], 'other'));
  lifecycle.clear('first');
  assert.equal(lifecycle.leave('first', 'old'), false);
  assert.equal(lifecycle.leave('other', 'incoming'), true);
});

test('editing, moving and resizing existing Notes do not repeat the reveal', () => {
  const before = board([card('a')]);
  const after = board([{ ...before.cards[0], title: 'Edited', x: 42, width: 400, height: 600 }]);
  assert.deepEqual(noteMotionChanges(before, after), { added: [], removed: [] });
});

test('switching between boards does not treat stored Notes as creations or removals', () => {
  assert.deepEqual(noteMotionChanges(board([card('a')], 'first'), board([card('b')], 'second')), { added: [], removed: [] });
});
