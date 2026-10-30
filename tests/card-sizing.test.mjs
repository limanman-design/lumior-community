import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultVideoWidth, videoCardHeight, resizeNoteEdge, resizeImageCorner, imageResizeLimits, normalizeVideoBoard } from '../app/card-sizing.ts';

test('image corners preserve the original ratio and the opposite image corner, without changing source or notes', () => {
  const card = { id: 'picture', kind: 'image', title: 'Photo', body: 'An attached note', image: 'lumior-file:original', x: 100, y: 200, width: 402, height: 302 };
  for (const aspect of [4 / 3, 3 / 4, 1, 10, 0.1]) {
    const originalHeight = (card.width - 2) / aspect;
    for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
      const patch = resizeImageCorner(card, corner, corner.endsWith('left') ? -80 : 80, corner.startsWith('top') ? -60 : 60, aspect);
      assert.ok(Math.abs((patch.width - 2) / (patch.height - 2) - aspect) < 1e-8);
      assert.equal(patch.x + (corner.endsWith('left') ? patch.width : 0), card.x + (corner.endsWith('left') ? card.width : 0));
      assert.ok(Math.abs(patch.y + (corner.startsWith('top') ? patch.height - 2 : 0) - card.y - (corner.startsWith('top') ? originalHeight : 0)) < 1e-8);
      assert.equal(patch.image, undefined);
      assert.equal(patch.body, undefined);
    }
  }
  assert.equal(card.width, 402);
  assert.equal(card.body, 'An attached note');
});

test('image longest-side bounds apply to portrait, landscape and extreme ratios, even when dragging past the anchor', () => {
  const card = { id: 'picture', kind: 'image', title: '', body: '', x: 0, y: 0, width: 402 };
  for (const aspect of [4 / 3, 3 / 4, 1, 100, 0.01]) {
    const small = resizeImageCorner(card, 'bottom-right', -1e7, -1e7, aspect);
    const large = resizeImageCorner(card, 'top-left', -1e7, -1e7, aspect);
    assert.ok(Math.abs(Math.max(small.width - 2, small.height - 2) - imageResizeLimits.minLongEdge) < 1e-8);
    assert.ok(Math.abs(Math.max(large.width - 2, large.height - 2) - imageResizeLimits.maxLongEdge) < 1e-8);
    assert.ok(small.width > 2 && small.height > 2);
  }
  assert.deepEqual(resizeImageCorner(card, 'bottom-right', 1, 1, 0), {});
  assert.deepEqual(resizeImageCorner(card, 'bottom-right', Infinity, 1, 1), {});
});

test('database edge resize keeps rendered size and geometry consistent at its minimum dimensions', () => {
  const card = { id: 'linked', kind: 'database', databaseRef: { databaseId: 'db' }, title: 'Tasks', body: '', x: 200, y: 300, width: 480, height: 320 };
  const left = resizeNoteEdge(card, 'left', 1000, 0, card.height);
  assert.equal(left.width, 320);
  assert.equal(left.x + left.width, card.x + card.width);
  assert.equal(left.height, card.height);
  const right = resizeNoteEdge(card, 'right', -1000, 0, card.height);
  assert.equal(right.width, 320);
  assert.equal(right.x, card.x);
  const top = resizeNoteEdge(card, 'top', 0, 1000, card.height);
  assert.equal(top.height, 220);
  assert.equal(top.y + top.height, card.y + card.height);
  assert.equal(top.width, card.width);
  const bottom = resizeNoteEdge(card, 'bottom', 0, -1000, card.height);
  assert.equal(bottom.height, 220);
  assert.equal(bottom.y, card.y);
  assert.deepEqual(card, { id: 'linked', kind: 'database', databaseRef: { databaseId: 'db' }, title: 'Tasks', body: '', x: 200, y: 300, width: 480, height: 320 });
});

const note = { id: 'note', kind: 'note', title: 'Research', body: 'Keep', x: 200, y: 300, width: 420 };

test('text edges resize one axis, keep the opposite edge fixed and retain compact text height', () => {
  const text = { ...note, kind: 'text', height: 100 };
  assert.deepEqual(resizeNoteEdge(text, 'left', 50, 90, text.height), { x: 250, y: 300, width: 370, height: 100 });
  assert.deepEqual(resizeNoteEdge(text, 'right', 50, 90, text.height), { x: 200, y: 300, width: 470, height: 100 });
  assert.deepEqual(resizeNoteEdge(text, 'top', 90, 30, text.height), { x: 200, y: 330, width: 420, height: 70 });
  assert.deepEqual(resizeNoteEdge(text, 'bottom', 90, 30, text.height), { x: 200, y: 300, width: 420, height: 130 });
  const top = resizeNoteEdge(text, 'top', 0, 1000, text.height);
  assert.equal(top.height, 44);
  assert.equal(top.y + top.height, text.y + text.height);
  assert.equal(resizeNoteEdge(text, 'bottom', 0, -1000, text.height).height, 44);
});

test('each note edge ignores diagonal movement and anchors the opposite edge', () => {
  assert.deepEqual(resizeNoteEdge(note, 'right', 50, 90, 280), { x: 200, y: 300, width: 470, height: 280 });
  assert.deepEqual(resizeNoteEdge(note, 'left', 50, 90, 280), { x: 250, y: 300, width: 370, height: 280 });
  assert.deepEqual(resizeNoteEdge(note, 'bottom', 90, 50, 280), { x: 200, y: 300, width: 420, height: 330 });
  assert.deepEqual(resizeNoteEdge(note, 'top', 90, 50, 280), { x: 200, y: 350, width: 420, height: 230 });
});

test('minimum and maximum sizes do not move the anchored edge', () => {
  const left = resizeNoteEdge(note, 'left', 900, 0, 280);
  assert.equal(left.width, 160);
  assert.equal(left.x + left.width, note.x + note.width);
  const wide = resizeNoteEdge(note, 'left', -2000, 0, 280);
  assert.equal(wide.width, 1400);
  assert.equal(wide.x + wide.width, note.x + note.width);
  const top = resizeNoteEdge(note, 'top', 0, 900, 280);
  assert.equal(top.height, 120);
  assert.equal(top.y + top.height, note.y + 280);
});

test('auto-height notes use the height captured at gesture start', () => {
  const first = resizeNoteEdge(note, 'top', 0, 25, 340);
  const next = resizeNoteEdge(note, 'top', 0, 50, 340);
  assert.equal(first.y + first.height, 640);
  assert.equal(next.y + next.height, 640);
  assert.equal(next.height, 290);
});

test('default video player is 560 by 315 with caption space outside', () => {
  assert.equal(defaultVideoWidth - 2, 560);
  assert.equal(videoCardHeight(defaultVideoWidth), 315 + 60 + 2);
});

test('video migration preserves user layout, content, references and larger cards', () => {
  const video = { ...note, id: 'custom', kind: 'video', width: 430, height: 280, video: { youtubeId: 'abc', localUrl: 'lumior-file:test' } };
  const wide = { ...video, id: 'large', width: 650 };
  const board = { id: 'board', title: 'Research', cards: [note, video, wide], edges: [{ id: 'edge', from: 'note', to: 'custom' }] };
  const migrated = normalizeVideoBoard(board);
  assert.strictEqual(migrated.cards[0], note);
  assert.deepEqual(migrated.cards[1], { ...video, width: 562, height: 377 });
  assert.equal(migrated.cards[2].width, 650);
  assert.equal(migrated.cards[2].height, 427);
  assert.strictEqual(migrated.edges, board.edges);
  assert.strictEqual(normalizeVideoBoard(migrated), migrated);
});

test('untouched demo grid grows without overlapping; user-moved demo cards stay put', () => {
  const board = { id: 'game', title: 'Research', edges: [], sections: [{ id: 'game-video-en', x: 1180, y: 1510, width: 980, height: 730 }], cards: [
    { ...note, kind: 'video', id: 'game-video-hike-en', x: 1220, y: 1570, width: 430, height: 280 },
    { ...note, kind: 'video', id: 'game-video-guidance-en', x: 1690, y: 1570, width: 430, height: 280 },
    { ...note, kind: 'video', id: 'game-video-hike-trailer-en', x: 1220, y: 1910, width: 430, height: 280 },
    { ...note, kind: 'video', id: 'game-video-firewatch-en', x: 1700, y: 1910, width: 430, height: 280 },
  ] };
  const migrated = normalizeVideoBoard(board);
  const [left, right, bottom, moved] = migrated.cards;
  assert.equal(right.x - left.x - left.width, 40);
  assert.equal(bottom.y - left.y - left.height, 60);
  assert.equal(moved.x, 1700);
  assert.equal(moved.y, 1910);
  assert.deepEqual(migrated.sections[0], { id: 'game-video-en', x: 1100, y: 1510, width: 1204, height: 924 });
  assert.strictEqual(normalizeVideoBoard(migrated), migrated);
});
