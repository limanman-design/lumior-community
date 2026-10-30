import test from 'node:test';
import assert from 'node:assert/strict';
import { cardName, pdfExcerptSourceName } from '../app/card-name.ts';
import { editorPlaceholder } from '../app/editor-placeholder.ts';

const excerpt = {
  sourceId: 'original', sourceTitle: 'Imported paper',
  pdf: { url: '/paper.pdf', name: 'Research paper.pdf' },
  mark: {
    id: 'highlight', color: '#77cd82', text: 'The original passage.',
    fragments: [{ page: 3 }, { page: 1 }, { page: 2 }, { page: 3 }, { page: 5 }],
  },
};

test('PDF note labels identify the original file and unique sorted pages without changing card data', () => {
  const card = { kind: 'note', title: 'A title the user previously edited', body: 'My own understanding', pdfExcerpt: excerpt };
  const before = structuredClone(card);
  assert.equal(cardName(card, 'zh'), 'Research paper.pdf · 第 1–3、5 页');
  assert.equal(cardName(card, 'en'), 'Research paper.pdf · Pages 1–3, 5');
  assert.deepEqual(card, before);
});

test('single-page and region excerpts keep source labels when the quote text is empty', () => {
  const region = { ...excerpt, mark: { ...excerpt.mark, text: '', image: '/crop.png', fragments: [{ page: 4 }] } };
  assert.equal(pdfExcerptSourceName(region, 'en'), 'Research paper.pdf · Page 4');
  assert.equal(pdfExcerptSourceName(region, 'zh'), 'Research paper.pdf · 第 4 页');
});

test('missing page metadata does not invent a page and an unnamed file falls back to the source title', () => {
  const incomplete = { ...excerpt, pdf: { ...excerpt.pdf, name: '' }, mark: { ...excerpt.mark, fragments: [{ page: 0 }, { page: -1 }, { page: 1.5 }] } };
  assert.equal(pdfExcerptSourceName(incomplete, 'zh'), 'Imported paper');
});

test('ordinary note prompts explain optional formatting while PDF notes invite a response to the source', () => {
  assert.equal(editorPlaceholder('zh'), '写下你的想法，输入 / 添加标题、列表等内容');
  assert.match(editorPlaceholder('en'), /thoughts.*\/.*headings, lists/);
  assert.equal(editorPlaceholder('zh', true), '写下你对这段原文的理解…');
  assert.doesNotMatch(editorPlaceholder('en', true), /\//);
});
