import test from 'node:test';
import assert from 'node:assert/strict';
import { locatePdfCitation } from '../app/pdf-citation-location.ts';
import { pageChunks, pdfPageText } from '../app/document-reading.ts';

const viewport = { width: 600, height: 800, convertToViewportPoint: (x, y) => [x, 800 - y] };
const line = (str, x = 40, y = 700) => ({ str, transform: [12, 0, 0, 12, x, y], height: 12, width: 220, hasEOL: true });

test('marks every cited line across columns without boxing the whitespace between columns', () => {
  const items = [line('Unrelated introduction.', 40, 740), line('Evidence begins here.', 40, 300), line('Evidence continues here.', 40, 284), line('Evidence concludes here.', 330, 700), line('Unrelated ending.', 330, 680)];
  const snapshot = structuredClone(items);
  const result = locatePdfCitation(items, viewport, 'Evidence begins here.\nEvidence continues here.\nEvidence concludes here.');
  assert.equal(result.rects.length, 3);
  assert.equal(result.stops.length, 2);
  assert.ok(result.rects[0].y > result.rects[2].y);
  assert.ok(result.rects.every(rect => rect.width < 40));
  assert.deepEqual(items, snapshot);
});

test('supports whitespace and font ligatures but rejects model paraphrases and ambiguous repeated text', () => {
  assert.ok(locatePdfCitation([line('An efﬁcient method for research.')], viewport, 'An efficient method\nfor research.'));
  assert.equal(locatePdfCitation([line('An efficient method for research.')], viewport, 'A good research method.'), undefined);
  assert.equal(locatePdfCitation([line('Repeated evidence.'), line('Repeated evidence.', 40, 680)], viewport, 'Repeated evidence.'), undefined);
  assert.equal(locatePdfCitation([line('A short text.')], viewport, 'short'), undefined);
});

test('word-sized PDF items on wrapped lines remain a single navigation stop', () => {
  const items = [line('Supporting', 40, 700), line('evidence', 200, 700), line('continues', 40, 684), line('here.', 200, 684)].map(item => ({ ...item, width: 140, hasEOL: false }));
  const result = locatePdfCitation(items, viewport, pdfPageText(items));
  assert.equal(result.rects.length, 4);
  assert.equal(result.stops.length, 1);
});

test('retains the full evidence chunk beyond the old 200 character summary', () => {
  const items = Array.from({ length: 20 }, (_, i) => line(`Line ${i}: This is the supporting source text for this specific observation.`, 40, 760 - i * 20));
  const text = pdfPageText(items), chunk = pageChunks(text, 1)[0];
  const result = locatePdfCitation(items, viewport, chunk.text);
  assert.ok(chunk.text.length > 1000);
  assert.equal(result.rects.length, 20);
});

test('keeps CJK evidence and page rotation coordinates, and declines missing or invalid geometry', () => {
  const items = [line('这是引用的原文证据，不应该改写。')];
  assert.ok(locatePdfCitation(items, viewport, items[0].str));
  const rotated = { width: 800, height: 600, convertToViewportPoint: (x, y) => [y, x] };
  const result = locatePdfCitation(items, rotated, items[0].str);
  assert.ok(result.rects[0].height > result.rects[0].width);
  assert.equal(locatePdfCitation([{ ...items[0], width: NaN }], viewport, items[0].str), undefined);
  assert.equal(locatePdfCitation(items, { ...viewport, width: 0 }, items[0].str), undefined);
  assert.equal(locatePdfCitation([], viewport, items[0].str), undefined);
});
