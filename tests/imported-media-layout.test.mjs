import test from 'node:test';
import assert from 'node:assert/strict';
import { appendImportedMediaBatch } from '../app/media-card-creation.ts';
import { importedPreviewHeight } from '../app/imported-media-layout.ts';

const pdf = (title = 'Paper', height = 509) => ({
  kind: 'pdf', title, body: '', height,
  pdf: { url: 'lumior-file:paper', name: 'paper.pdf', size: 100, pages: 1, thumbnail: 'data:image/jpeg;base64,preview' },
});
const image = (height = 215) => ({ kind: 'image', title: 'Image', body: '', image: 'lumior-file:image', height });
const video = { kind: 'video', title: 'Video', body: '', height: 360,
  video: { url: 'lumior-file:video', localUrl: 'lumior-file:video', duration: 12, poster: '' } };
const board = (cards = []) => ({ id: 'original', title: 'Edited whiteboard', cards, edges: [] });
const bodyOverlap = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x
  && a.y < b.y + b.height && a.y + a.height > b.y;
const withLabel = card => ({ ...card, y: card.y - 24, height: card.height + 24 });
function append(imports, options = {}, original = board()) {
  let id = 0;
  return appendImportedMediaBatch([original], original.id, imports, { x: 600, y: 400 }, () => `new-${++id}`, options);
}
function assertNoOverlap(cards) {
  for (let index = 0; index < cards.length; index++) {
    for (const later of cards.slice(index + 1)) {
      assert.equal(bodyOverlap(withLabel(cards[index]), withLabel(later)), false,
        `${cards[index].id} overlaps ${later.id}`);
    }
  }
}

test('six PDFs form two rows of three, including filename clearance', () => {
  const result = append(Array.from({ length: 6 }, (_, index) => pdf(`Paper ${index}`)), { availableWidth: 1200 });
  assert.equal(result.cards.length, 6);
  assert.equal(new Set(result.cards.map(card => card.y)).size, 2);
  assert.equal(result.cards.filter(card => card.y === result.cards[0].y).length, 3);
  assert.equal(result.cards[1].x - (result.cards[0].x + result.cards[0].width), 32);
  assert.equal(result.cards[3].y - 24 - (result.cards[0].y + result.cards[0].height), 32);
  assertNoOverlap(result.cards);
});

test('mixed media uses actual widths and reserves the tallest portrait preview', () => {
  const tallHeight = importedPreviewHeight(100, 600, 428);
  const result = append([image(tallHeight), pdf(), video, image(215)], { availableWidth: 1500 });
  assert.deepEqual(result.cards.slice(0, 3).map(card => card.width), [428, 360, 562]);
  assert.equal(result.cards[2].height, 377);
  assert.equal(result.cards[3].y - 24, result.cards[0].y + tallHeight + 32);
  assertNoOverlap(result.cards);
});

test('a narrow viewport wraps before a card would exceed the available world width', () => {
  const result = append([pdf(), pdf(), video, image()], { availableWidth: 800 });
  const rows = Map.groupBy(result.cards, card => card.y);
  assert.deepEqual([...rows.values()].map(row => row.length), [2, 1, 1]);
  for (const row of rows.values()) {
    assert.ok(Math.max(...row.map(card => card.x + card.width)) - Math.min(...row.map(card => card.x)) <= 800);
  }
  assertNoOverlap(result.cards);
});

test('an individual wide video remains usable when the viewport is narrower than its default width', () => {
  const result = append([video, video], { availableWidth: 400 });
  assert.equal(result.cards[0].width, 562);
  assert.notEqual(result.cards[0].y, result.cards[1].y);
  assertNoOverlap(result.cards);
});

test('placement avoids existing measured cards without changing their position or newer content', () => {
  const oldCard = { id: 'old', kind: 'note', title: 'Newer edit', body: 'Keep me', x: 200, y: 300, width: 850, height: 100 };
  const original = { ...board([oldCard]), sections: [{ id: 's', x: 1, y: 1, width: 1, height: 1, title: 'Keep section', color: '#fff' }] };
  const result = append([pdf(), image()], { measuredHeights: { old: 900 }, availableWidth: 1200 }, original);
  assert.equal(result.boards[0].cards[0], oldCard);
  assert.equal(result.boards[0].sections, original.sections);
  assert.equal(result.boards[0].title, 'Edited whiteboard');
  for (const card of result.cards) {
    assert.ok(card.y - 24 >= oldCard.y + 900 + 32);
    assert.equal(bodyOverlap(withLabel(card), { ...oldCard, height: 900 }), false);
  }
  assertNoOverlap(result.cards);
});

test('an obstacle beneath later rows is cleared even when the batch has many rows', () => {
  const oldCard = { id: 'old', kind: 'note', title: 'Existing', body: '', x: 319, y: 2100, width: 562, height: 100 };
  const result = append(Array.from({ length: 8 }, () => video), { availableWidth: 562 }, board([oldCard]));
  for (const card of result.cards) assert.equal(bodyOverlap(withLabel(card), withLabel(oldCard)), false);
  assertNoOverlap(result.cards);
});

test('a batch still belongs to its source board and does not recreate a deleted board', () => {
  const source = board(), other = { ...board(), id: 'currently-open' };
  const result = appendImportedMediaBatch([other, source], source.id, [image()], { x: 0, y: 0 }, () => 'image');
  assert.equal(result.boards[0], other);
  assert.equal(result.boards[1].cards.length, 1);
  let generated = false;
  assert.equal(appendImportedMediaBatch([other], source.id, [image()], { x: 0, y: 0 }, () => { generated = true; return 'image'; }), null);
  assert.equal(generated, false);
  const empty = appendImportedMediaBatch([source], source.id, [], { x: 0, y: 0 }, () => 'unused');
  assert.equal(empty.boards[0], source);
  assert.deepEqual(empty.cards, []);
});

test('preview heights match portrait/landscape image and PDF ratio plus card borders', () => {
  assert.equal(importedPreviewHeight(1200, 600, 428), 215);
  assert.equal(importedPreviewHeight(600, 1200, 428), 854);
  assert.equal(importedPreviewHeight(700, 990, 360), 509);
  assert.equal(importedPreviewHeight(990, 700, 360), 256);
  assert.throws(() => importedPreviewHeight(0, 10, 428));
  assert.throws(() => importedPreviewHeight(10, Infinity, 428));
});
