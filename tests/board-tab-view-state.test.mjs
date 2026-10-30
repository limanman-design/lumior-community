import assert from 'node:assert/strict';
import test from 'node:test';
import { createBoardTabViewState } from '../app/board-tab-view-state.ts';

const card = id => ({ id, title: id, body: 'Saved content', kind: 'note', x: 20, y: 40, width: 360 });
const board = (id, ids) => ({ id, title: id, cards: ids.map(card), edges: [] });
const state = (patch = {}) => ({
  view: { x: 420, y: -180, zoom: 0.72 },
  readId: 'a-note',
  externalPdf: null,
  sizes: { 'a-note': 640 },
  aiMode: 'sidebar',
  informationOpen: true,
  pinnedId: 'a-note',
  ...patch,
});

test('switching A to B and back restores each board independently', () => {
  const views = createBoardTabViewState();
  const a = board('a', ['a-note']), b = board('b', ['b-note']);
  const aState = state(), bState = state({ view: { x: -80, y: 300, zoom: 1.45 }, readId: null, sizes: { 'b-note': 280 }, pinnedId: null, aiMode: 'closed', informationOpen: false });
  assert.equal(views.restore(a), undefined);
  views.remember(a.id, aState);
  views.remember(b.id, bState);
  assert.deepEqual(views.restore(a), aState);
  assert.deepEqual(views.restore(b), bState);
  views.remember(b.id, { ...bState, view: { x: 100, y: 200, zoom: 0.5 } });
  assert.deepEqual(views.restore(a), aState);
});

test('later input and restored viewport changes cannot alter a saved snapshot', () => {
  const views = createBoardTabViewState(), a = board('a', ['a-note']), outgoing = state();
  views.remember(a.id, outgoing);
  outgoing.view.x = 900;
  outgoing.sizes['a-note'] = 100;
  const restored = views.restore(a);
  assert.deepEqual(restored.view, { x: 420, y: -180, zoom: 0.72 });
  assert.equal(restored.sizes['a-note'], 640);
  restored.view.zoom = 2;
  restored.sizes['a-note'] = 800;
  assert.deepEqual(views.restore(a).view, { x: 420, y: -180, zoom: 0.72 });
  assert.equal(views.restore(a).sizes['a-note'], 640);
});

test('restoring UI state leaves the board document unchanged', () => {
  const views = createBoardTabViewState(), a = board('a', ['a-note']);
  const documentBefore = structuredClone(a);
  Object.freeze(a.cards[0]);
  Object.freeze(a.cards);
  Object.freeze(a);
  views.remember(a.id, state());
  views.restore(a);
  assert.deepEqual(a, documentBefore);
});

test('a reader deleted while its tab was inactive falls back to the same canvas view', () => {
  const views = createBoardTabViewState(), a = board('a', ['remaining']);
  const outgoing = state();
  views.remember(a.id, outgoing);
  const restored = views.restore(a);
  assert.equal(restored.readId, null);
  assert.equal(restored.pinnedId, null);
  assert.deepEqual(restored.view, outgoing.view);
});

test('closing a reader replaces its previously expanded state without moving the canvas', () => {
  const views = createBoardTabViewState(), a = board('a', ['a-note']);
  views.remember(a.id, state());
  views.remember(a.id, state({ readId: null }));
  assert.equal(views.restore(a).readId, null);
  assert.deepEqual(views.restore(a).view, state().view);
});

test('restored card measurements discard cards no longer on the board', () => {
  const views = createBoardTabViewState(), a = board('a', ['a-note', 'new-note']);
  views.remember(a.id, state({ sizes: { 'a-note': 640, removed: 900 } }));
  assert.deepEqual(views.restore(a).sizes, { 'a-note': 640 });
});

test('an expanded external PDF remains available outside the board card list', () => {
  const views = createBoardTabViewState(), a = board('a', ['a-note']);
  const externalPdf = { ...card('source-pdf'), kind: 'pdf', pdf: { url: '/synthetic.pdf', name: 'Synthetic PDF', size: 100, pages: 2, thumbnail: '' } };
  views.remember(a.id, state({ readId: externalPdf.id, pinnedId: externalPdf.id, externalPdf }));
  const restored = views.restore(a);
  assert.equal(restored.readId, externalPdf.id);
  assert.equal(restored.pinnedId, externalPdf.id);
  assert.deepEqual(restored.externalPdf, externalPdf);
  views.remember(a.id, state({ readId: 'external-reference', pinnedId: null }));
  assert.equal(views.restore(a, ['external-reference']).readId, 'external-reference');
});

test('forget, pruning removed boards, and workspace reset discard only intended sessions', () => {
  const views = createBoardTabViewState();
  const boards = ['a', 'b', 'c'].map(id => board(id, ['a-note']));
  for (const b of boards) views.remember(b.id, state());
  views.forget('b');
  assert.equal(views.restore(boards[1]), undefined);
  assert.ok(views.restore(boards[0]));
  views.prune(['c']);
  assert.equal(views.restore(boards[0]), undefined);
  assert.ok(views.restore(boards[2]));
  views.clear();
  assert.equal(views.restore(boards[2]), undefined);
});
