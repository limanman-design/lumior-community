import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAtlasSelection } from '../app/memory-atlas-selection.ts';
import { mapMemoryAtlas } from '../app/memory-atlas-data.ts';

const card = (id, values = {}) => ({ id, kind: 'note', title: 'A note', body: 'A thought', x: 10, y: 20, width: 360, ...values });
const board = (id, cards) => ({ id, title: `Board ${id}`, cards, edges: [] });
const memory = card => ({ id: card.sharedId || card.id, title: card.title, note: card.body, categoryId: card.kind, date: '2026-10-12', card, locations: [], simulatedDate: false });
const data = memories => ({ categories: [], memories, fragments: [] });

void test('selection follows the latest mapped Card without using a stale editor snapshot', () => {
  const old = memory(card('a'));
  const latest = memory(card('a', { title: 'An edited title', body: 'An edited thought' }));
  assert.equal(resolveAtlasSelection([], 'one', old, data([latest]), true), latest);
});

void test('clearing a note keeps its live Card selected in an editable atlas while a read-only atlas omits it', () => {
  const previous = memory(card('a'));
  const empty = card('a', { title: 'Untitled', body: '', blocks: [] });
  const source = [board('one', [empty])];
  const selected = resolveAtlasSelection(source, 'one', previous, data([]), true);
  assert.equal(selected.id, 'a');
  assert.equal(selected.card, empty);
  assert.equal(selected.card.body, '');
  assert.equal(selected.card.title, 'Untitled');
  assert.equal(resolveAtlasSelection(source, 'one', previous, data([])), undefined);
});

void test('ordinary editable Note and Text previews survive empty BlockNote content and accept new text', () => {
  for (const kind of ['note', 'text']) {
    const original = card(kind, { kind });
    const previous = mapMemoryAtlas([board('one', [original])], 'one').memories[0];
    const empty = { ...original, title: 'Untitled', body: '', blocks: [{ id: 'empty-paragraph', type: 'paragraph', props: {}, content: [], children: [] }] };
    const boards = [board('one', [empty])];
    const mappedEmpty = mapMemoryAtlas(boards, 'one');
    assert.equal(mappedEmpty.memories.length, 0);
    const selected = resolveAtlasSelection(boards, 'one', previous, mappedEmpty, true);
    assert.equal(selected.card, empty);
    assert.equal(selected.id, previous.id);
    const edited = { ...empty, body: 'A new thought', blocks: [] };
    const nextBoards = [board('one', [edited])];
    const continued = resolveAtlasSelection(nextBoards, 'one', selected, mapMemoryAtlas(nextBoards, 'one'), true);
    assert.equal(continued.card, edited);
    assert.equal(continued.note, 'A new thought');
    assert.equal(continued.id, previous.id);
  }
});

void test('shared selection keeps its canonical identity while the source board changes', () => {
  const first = card('first', { sharedId: 'shared', title: 'Untitled', body: '' });
  const second = card('second', { sharedId: 'shared', title: 'Untitled', body: '' });
  const previous = memory(card('first', { sharedId: 'shared' }));
  const boards = [board('one', [first]), board('two', [second])];
  const before = structuredClone(boards);
  const selected = resolveAtlasSelection(boards, 'two', previous, data([]), true);
  assert.equal(selected.id, 'shared');
  assert.equal(selected.card, second);
  assert.deepEqual(selected.locations, [
    { boardId: 'two', boardTitle: 'Board two', cardId: 'second' },
    { boardId: 'one', boardTitle: 'Board one', cardId: 'first' },
  ]);
  assert.deepEqual(boards, before);
});

void test('deleted notes and unselected memories do not become ghost selections', () => {
  const previous = memory(card('removed'));
  assert.equal(resolveAtlasSelection([board('one', [card('other')])], 'one', previous, data([]), true), undefined);
  assert.equal(resolveAtlasSelection([], 'one', null, data([]), true), undefined);
});

void test('empty-note fallback never retains another resource type', () => {
  const image = card('image', { kind: 'image' });
  assert.equal(resolveAtlasSelection([board('one', [image])], 'one', memory(image), data([]), true), undefined);
});
