import test from 'node:test';
import assert from 'node:assert/strict';
import { cardName } from '../app/card-name.ts';
import { linkedPdfNotes, pdfReadingNotes, updatePdfExcerptNote } from '../app/pdf-notes.ts';

const mark = { id: 'highlight', text: 'A passage', color: '#77cd82', fragments: [{ page: 3, rects: [] }] };
const pdf = { url: '/paper.pdf', name: 'Paper.pdf', pages: 6, size: 100, thumbnail: '' };
const excerpt = { id: 'excerpt', kind: 'note', title: mark.text, body: 'Old note', blocks: [{ type: 'paragraph' }],
  x: 12, y: 30, width: 420, pdfExcerpt: { sourceId: 'source', sourceTitle: 'Paper', pdf, mark } };

test('filename labels preserve original uploads and do not mistake a video channel for a filename', () => {
  assert.equal(cardName({ title: 'Reading', sourceName: 'Short name', pdf }), 'Paper.pdf');
  assert.equal(cardName({ kind: 'image', sourceName: 'cover.png', title: 'A caption' }), 'cover.png');
  assert.equal(cardName({ kind: 'note', title: 'A native note' }), 'A native note');
  assert.equal(cardName({ kind: 'video', sourceName: 'GDC', title: 'A Short Hike', video: { url: 'https://youtube.com/watch?v=x' } }), 'A Short Hike');
  assert.equal(cardName({ kind: 'video', sourceName: 'GDC', title: 'Lighting', video: { localUrl: '/lighting.mp4' } }), 'Lighting');
  assert.equal(cardName({ kind: 'video', sourceName: 'clip.mp4', title: 'Clip', video: { localUrl: 'blob:local' } }), 'clip.mp4');
});

test('related note cards follow actual canvas connections in either direction', () => {
  const source = { id: 'source', kind: 'pdf', pdf };
  const note = { id: 'note', kind: 'note', title: 'Reading' };
  const unlinked = { ...note, id: 'unlinked' };
  const otherPdf = { ...source, id: 'other-pdf', pdf: { ...pdf, url: '/other.pdf' } };
  const board = { cards: [source, note, excerpt, unlinked, otherPdf], edges: [
    { from: 'note', to: 'source' }, { from: 'source', to: excerpt.id }, { from: 'other-pdf', to: 'unlinked' },
  ] };
  assert.deepEqual(linkedPdfNotes(source, board), [note]);
});

test('reader combines shared excerpts and highlights once and excludes other PDFs', () => {
  const unrelated = { ...excerpt, id: 'other', pdfExcerpt: { ...excerpt.pdfExcerpt, pdf: { ...pdf, url: '/other.pdf' } } };
  const notes = pdfReadingNotes(pdf.url, [
    { ...mark, note: 'Updated annotation', color: '#b196ee' },
    { ...mark, id: 'first', fragments: [{ page: 1, rects: [] }] },
  ], [excerpt, { ...excerpt, id: 'shared-excerpt' }, unrelated]);
  assert.equal(notes.length, 2);
  assert.equal(notes[0].mark.id, 'first');
  assert.equal(notes[1].mark.note, 'Updated annotation');
  assert.equal(notes[1].mark.color, '#b196ee');
  assert.equal(pdfReadingNotes(pdf.url, [], [excerpt])[0].mark.note, 'Old note');
});

test('editing or clearing a PDF note updates every matching excerpt without touching geometry or other files', () => {
  const other = { ...excerpt, id: 'other', pdfExcerpt: { ...excerpt.pdfExcerpt, pdf: { ...pdf, url: '/other.pdf' } } };
  const board = { id: 'board', title: 'Board', cards: [excerpt, { ...excerpt, id: 'copy' }, other], edges: [] };
  const next = updatePdfExcerptNote(board, pdf.url, mark.id, 'Revised note');
  for (const card of next.cards.slice(0, 2)) {
    assert.equal(card.body, 'Revised note');
    assert.equal(card.pdfExcerpt.mark.note, 'Revised note');
    assert.equal(card.blocks, undefined);
    assert.deepEqual([card.x, card.y, card.width], [12, 30, 420]);
  }
  assert.strictEqual(next.cards[2], other);
  assert.equal(updatePdfExcerptNote(next, pdf.url, mark.id, '').cards[0].body, '');
  assert.strictEqual(updatePdfExcerptNote(board, '/absent.pdf', mark.id, 'Untouched'), board);
});
