import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptsMediaFile, appendImportedCard } from '../app/media-card-creation.ts';

test('media creation entries accept only their own supported file types', () => {
  assert.equal(acceptsMediaFile('image', 'PHOTO.JPG'), true);
  assert.equal(acceptsMediaFile('pdf', 'paper.PDF'), true);
  assert.equal(acceptsMediaFile('video', 'clip.mp4'), true);
  assert.equal(acceptsMediaFile('pdf', 'paper.pdf.exe'), false);
  assert.equal(acceptsMediaFile('image', 'clip.mp4'), false);
  assert.equal(acceptsMediaFile('video', 'notes.docx'), false);
  assert.equal(acceptsMediaFile(null, 'notes.docx'), true);
});

test('async media insertion keeps the source board and newer content; a deleted board is never recreated', () => {
  const target = { id: 'source', title: 'Source', cards: [{ id: 'note', title: 'Edited during upload' }], edges: [] };
  const active = { id: 'other', title: 'Other', cards: [], edges: [] };
  const video = { kind: 'video', title: 'Linked video', body: '', video: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', youtubeId: 'dQw4w9WgXcQ', poster: '', duration: 0 } };
  const result = appendImportedCard([target, active], 'source', video, { x: 600, y: 400 }, 0, 'new', '2026-10-13T00:00:00Z');
  assert.equal(result.boards[1], active);
  assert.equal(result.boards[0].cards[0], target.cards[0]);
  assert.equal(result.card.width, 562);
  assert.equal(result.card.x, 319);
  assert.equal(result.card.video.youtubeId, video.video.youtubeId);
  assert.equal(result.card.createdAt, '2026-10-13T00:00:00Z');
  assert.equal(appendImportedCard([active], 'source', video, { x: 0, y: 0 }, 0, 'missing'), null);
});
