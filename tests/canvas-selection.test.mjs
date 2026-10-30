import test from 'node:test';
import assert from 'node:assert/strict';
import {
  alignSelectedCards,
  duplicateSelectedCards,
  gridSelectedCards,
  selectionBounds,
  selectionGridGap,
} from '../app/canvas-selection.ts';

const card = (id, extra = {}) => ({ id, kind: 'note', title: id, body: 'Keep content', x: 0, y: 0, width: 100, ...extra });
const board = cards => ({ id: 'board', title: 'Research', cards, edges: [], sections: [] });
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
const heights = { a: 80 };
const geometry = () => board([
  card('a', { x: 20, y: 50, width: 100, height: 200 }),
  card('b', { x: -30, y: 10, width: 150, height: 40 }),
  card('outside', { x: 900, y: 800 }),
]);

test('selection bounds use measured height and tolerate stale and duplicate selected IDs', () => {
  const source = freeze(geometry());
  assert.equal(selectionBounds(source.cards, []), null);
  assert.equal(selectionBounds(source.cards, ['deleted']), null);
  assert.deepEqual(selectionBounds(source.cards, ['b', 'a', 'a', 'deleted'], heights), { x: -30, y: 10, width: 150, height: 120 });
  assert.deepEqual(selectionBounds(source.cards, ['a'], heights), { x: 20, y: 50, width: 100, height: 80 });
  for (const height of [0, -1, NaN, Infinity]) {
    assert.deepEqual(selectionBounds(source.cards, ['a'], { a: height }), { x: 20, y: 50, width: 100, height: 200 });
  }
  assert.equal(selectionBounds([card('unset')], ['unset']).height, 300);
});

test('all six alignments respect different card sizes and preserve unrelated metadata, edges and source geometry', () => {
  const source = geometry();
  source.cards[0].blocks = [{ type: 'paragraph', content: 'Immutable document' }];
  source.edges.push({ id: 'link', from: 'a', to: 'b', color: '#fff' });
  freeze(source);
  const expected = {
    left: [[-30, 50], [-30, 10]],
    hcenter: [[-5, 50], [-30, 10]],
    right: [[20, 50], [-30, 10]],
    top: [[20, 10], [-30, 10]],
    vcenter: [[20, 30], [-30, 50]],
    bottom: [[20, 50], [-30, 90]],
  };
  for (const [alignment, positions] of Object.entries(expected)) {
    const next = alignSelectedCards(source, ['a', 'deleted', 'b'], alignment, heights);
    assert.deepEqual(next.cards.slice(0, 2).map(({ x, y }) => [x, y]), positions, alignment);
    assert.equal(next.cards[2], source.cards[2]);
    assert.equal(next.cards[0].blocks, source.cards[0].blocks);
    assert.equal(next.cards[0].height, 200);
    assert.equal(next.edges, source.edges);
    assert.equal(next.sections, source.sections);
  }
  assert.deepEqual(source.cards.slice(0, 2).map(({ x, y }) => [x, y]), [[20, 50], [-30, 10]]);
  assert.equal(alignSelectedCards(source, ['a', 'b'], 'right', heights), source);
});

test('grid uses stable visual order, widest columns and measured tallest rows without overlap', () => {
  const source = freeze(board([
    card('last', { x: 400, y: 600, width: 120, height: 80 }),
    card('first', { x: 0, y: 0, width: 110, height: 20 }),
    card('second', { x: 120, y: 0, width: 190, height: 40 }),
    card('third', { x: 0, y: 400, width: 350, height: 140 }),
    card('outside', { x: 2000, y: 2000 }),
  ]));
  const sizes = { first: 300, third: 50 };
  const selected = ['third', 'second', 'last', 'first', 'deleted', 'first'];
  const next = gridSelectedCards(source, selected, sizes);
  const positions = Object.fromEntries(next.cards.map(({ id, x, y }) => [id, [x, y]]));
  assert.deepEqual(positions.first, [0, 0]);
  assert.deepEqual(positions.second, [350 + selectionGridGap, 0]);
  assert.deepEqual(positions.third, [0, 300 + selectionGridGap]);
  assert.deepEqual(positions.last, [350 + selectionGridGap, 300 + selectionGridGap]);
  assert.deepEqual(next.cards.map(({ id }) => id), source.cards.map(({ id }) => id));
  assert.equal(next.cards[4], source.cards[4]);
  assert.equal(next.edges, source.edges);
  assert.equal(next.sections, source.sections);
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      const a = next.cards[i], b = next.cards[j];
      const ah = sizes[a.id] || a.height || 300, bh = sizes[b.id] || b.height || 300;
      assert.equal(a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + bh && a.y + ah > b.y, false);
    }
  }
  assert.equal(gridSelectedCards(next, selected, sizes), next);
});

test('grid supports explicit columns, anchored negative coordinates and stable paint-order ties', () => {
  const source = board([
    card('tie-first', { x: -100, y: -50, height: 20 }),
    card('tie-second', { x: -100, y: -50, width: 200, height: 80 }),
    card('later', { x: 100, y: 40, height: 60 }),
  ]);
  const selected = ['later', 'tie-second', 'tie-first'];
  const vertical = gridSelectedCards(source, selected, {}, 1);
  assert.deepEqual(vertical.cards.map(({ x, y }) => [x, y]), [[-100, -50], [-100, 2], [-100, 114]]);
  const horizontal = gridSelectedCards(source, selected, {}, 99);
  assert.deepEqual(horizontal.cards.map(({ x, y }) => [x, y]), [[-100, -50], [32, -50], [264, -50]]);
  assert.deepEqual(gridSelectedCards(source, selected, {}, NaN), gridSelectedCards(source, selected));
  assert.deepEqual(gridSelectedCards(source, selected, {}, 0), vertical);
});

test('empty and single surviving selections make no layout or batch-copy history candidate', () => {
  const source = freeze(geometry());
  for (const ids of [[], ['deleted'], ['a'], ['a', 'deleted', 'a']]) {
    assert.equal(alignSelectedCards(source, ids, 'bottom', heights), source);
    assert.equal(gridSelectedCards(source, ids, heights), source);
    assert.deepEqual(duplicateSelectedCards(source, ids, heights, { idFactory: () => { throw new Error('No IDs needed'); } }), { board: source, newIds: [] });
  }
});

test('batch copies keep relative placement, become independent and copy only internal connections', () => {
  const pdf = { url: 'lumior-file:source', name: 'Source.pdf', size: 1, pages: 2, thumbnail: 'Keep attachment' };
  const source = board([
    card('pdf', { kind: 'pdf', x: -60, y: 40, width: 300, height: 400, sharedId: 'shared-pdf', pdf }),
    card('excerpt', { x: 400, y: 90, width: 100, sharedId: 'shared-note', createdAt: 'old', creationDateSource: 'simulated',
      blocks: [{ type: 'paragraph', content: 'Original' }], pdfExcerpt: { sourceId: 'pdf', sourceTitle: 'Source', pdf, mark: { id: 'mark', text: 'Quote', color: '#fff', fragments: [] } } }),
    card('outside', { x: 1000, y: 1000 }),
  ]);
  source.edges = [
    { id: 'internal', from: 'pdf', to: 'excerpt', color: '#abc', label: 'Evidence' },
    { id: 'external-out', from: 'excerpt', to: 'outside' },
    { id: 'external-in', from: 'outside', to: 'pdf' },
  ];
  freeze(source);
  let id = 0;
  const result = duplicateSelectedCards(source, ['excerpt', 'pdf', 'pdf', 'deleted'], {}, {
    idFactory: () => `copy-${++id}`,
    now: () => '2026-10-12T00:00:00.000Z',
  });
  assert.deepEqual(result.newIds, ['copy-1', 'copy-2']);
  const [pdfCopy, noteCopy] = result.board.cards.slice(3);
  assert.equal(pdfCopy.x - source.cards[0].x, 640);
  assert.equal(noteCopy.x - pdfCopy.x, source.cards[1].x - source.cards[0].x);
  assert.equal(noteCopy.y - pdfCopy.y, source.cards[1].y - source.cards[0].y);
  for (const copy of [pdfCopy, noteCopy]) {
    assert.equal(Object.hasOwn(copy, 'sharedId'), false);
    assert.equal(copy.title.endsWith(' — Copy'), true);
    assert.equal(copy.createdAt, '2026-10-12T00:00:00.000Z');
    assert.equal(copy.creationDateSource, 'actual');
  }
  assert.deepEqual(pdfCopy.pdf, pdf);
  assert.notEqual(pdfCopy.pdf, pdf);
  assert.deepEqual(noteCopy.blocks, source.cards[1].blocks);
  assert.notEqual(noteCopy.blocks, source.cards[1].blocks);
  assert.equal(noteCopy.pdfExcerpt.sourceId, pdfCopy.id);
  assert.equal(source.cards[1].pdfExcerpt.sourceId, 'pdf');
  assert.deepEqual(noteCopy.pdfExcerpt.mark, source.cards[1].pdfExcerpt.mark);
  assert.notEqual(noteCopy.pdfExcerpt.mark, source.cards[1].pdfExcerpt.mark);
  noteCopy.blocks[0].content = 'Edit only copy';
  assert.equal(source.cards[1].blocks[0].content, 'Original');
  assert.deepEqual(result.board.edges.slice(3), [{ id: 'copy-3', from: 'copy-1', to: 'copy-2', color: '#abc', label: 'Evidence' }]);
  assert.equal(result.board.sections, source.sections);
  assert.equal(result.board.cards[0], source.cards[0]);
  assert.equal(source.cards.length, 3);
  assert.equal(source.edges.length, 3);
});

test('explicit group offset keeps external excerpt sources and avoids ID collisions', () => {
  const excerpt = { sourceId: 'external-pdf', sourceTitle: 'Other source', pdf: {}, mark: { id: 'mark' } };
  const source = freeze(board([card('one', { pdfExcerpt: excerpt }), card('two', { x: 200 })]));
  const ids = ['one', '', 'two', 'fresh-one', 'fresh-one', 'fresh-two'];
  const result = duplicateSelectedCards(source, ['one', 'two'], {}, { idFactory: () => ids.shift(), offset: { x: -40, y: 100 }, now: () => 'fixed' });
  assert.deepEqual(result.newIds, ['fresh-one', 'fresh-two']);
  assert.deepEqual(result.board.cards.slice(2).map(({ x, y }) => [x, y]), [[-40, 100], [160, 100]]);
  assert.deepEqual(result.board.cards[2].pdfExcerpt, { ...excerpt, independent: true });
  assert.notEqual(result.board.cards[2].pdfExcerpt, excerpt);
  assert.equal(result.board.edges.length, 0);
});
