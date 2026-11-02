import test from 'node:test';
import assert from 'node:assert/strict';
import { captureNoteSource, noteSourceLink, parseNoteSource, documentSources, numberedSources, sourceLabel, labelNoteSources, referenceSource } from '../app/note-source.ts';
import { remapContentLink } from '../app/content-links.ts';
import { formatNoteBibliography } from '../lib/note-bibliography.ts';
import { mergeRestoredWorkspace } from '../app/workspace-backup.ts';
import { createInitialWorkspace } from '../app/workspace-store.ts';

const note = (id, more = {}) => ({ id, kind: 'note', title: id, body: 'My analysis', width: 360, x: 0, y: 0, ...more });
const pdf = note('pdf', { kind: 'pdf', title: 'Study', bibliography: { status: 'resolved', title: 'A study of learning', authors: ['张三', '李四', '王五', '赵六'], year: 2025, journal: '学习研究', volume: '12', issue: '2', pages: '20-30', type: 'journal-article', doi: '10.1234/study' }, pdf: { url: '/source.pdf', name: 'study.pdf', pages: 8, size: 120, thumbnail: '' } });
const resolve = id => id === pdf.id ? pdf : undefined;
const excerpt = note('excerpt', { pdfExcerpt: { sourceId: pdf.id, sourceTitle: pdf.title, pdf: pdf.pdf, mark: { id: 'mark', text: 'Original evidence.', color: '', fragments: [{ page: 2, rects: [] }] } } });
const link = source => ({ type: 'link', href: noteSourceLink(source), content: [{ type: 'text', text: 'Source', styles: {} }] });

test('excerpt captures PDF identity, exact file pages and evidence, while keeping its note provenance', () => {
  const before = structuredClone(excerpt), source = captureNoteSource(excerpt, resolve);
  assert.equal(source.contentId, 'pdf'); assert.equal(source.viaId, 'excerpt');
  assert.deepEqual(source.pages, [2]); assert.equal(source.quote, 'Original evidence.');
  assert.deepEqual(source.bibliography.authors, pdf.bibliography.authors);
  assert.deepEqual(parseNoteSource(noteSourceLink(source)), source); assert.deepEqual(excerpt, before);
});
test('whole-document summaries and ordinary notes never infer pages from arbitrary prose', () => {
  const summary = captureNoteSource(note('summary', { sourceContentId: 'pdf', body: 'page 5, p. 9' }), resolve);
  assert.equal(summary.kind, 'pdf'); assert.equal(summary.contentId, 'pdf'); assert.equal(summary.pages, undefined);
  const plain = captureNoteSource(note('idea'), resolve); assert.equal(plain.kind, 'note'); assert.equal(plain.contentId, 'idea');
});
test('multi-page excerpts retain all pages without claiming a single-page text match', () => {
  const card = structuredClone(excerpt); card.pdfExcerpt.mark.fragments.push({ page: 3, rects: [] }, { page: 2, rects: [] });
  const source = captureNoteSource(card, resolve); assert.deepEqual(source.pages, [2, 3]); assert.equal(source.quote, undefined);
});
test('reference numbering follows first occurrence, deduplicates DOI copies and excludes ordinary notes', () => {
  const a = captureNoteSource(excerpt, resolve), copy = { ...a, contentId: 'another-pdf' };
  const b = { ...a, contentId: 'different', bibliography: { ...a.bibliography, doi: '10.1234/other' } };
  const sources = documentSources([{ type: 'paragraph', content: [link(b), link(a)] }, { type: 'paragraph', children: [{ content: [link(copy), link(captureNoteSource(note('idea'), resolve))] }] }]);
  assert.deepEqual([...numberedSources(sources).values()].map(entry => [entry.source.contentId, entry.number]), [['different', 1], ['pdf', 2]]);
  assert.equal(sourceLabel(a, 'zh', 2), '[2]');
  assert.equal(numberedSources(documentSources([{ content: [link(a)] }])).size, 1);
});
test('malformed or unbounded links do not become source navigation requests', () => {
  for (const href of ['javascript:alert(1)', '#lumior-source=%bad', '#lumior-source=null', '#lumior-source='+encodeURIComponent(JSON.stringify({ version: 1, contentId: 'a', title: 'A', kind: 'pdf', pages: [-1] }))]) assert.equal(parseNoteSource(href), undefined);
});
test('backup content remapping preserves source snapshots, page positions and via-note identity', () => {
  const source = captureNoteSource(excerpt, resolve), remapped = parseNoteSource(remapContentLink(noteSourceLink(source), new Map([['pdf', 'new-pdf'], ['excerpt', 'new-note']])));
  assert.equal(remapped.contentId, 'new-pdf'); assert.equal(remapped.viaId, 'new-note'); assert.deepEqual(remapped.pages, [2]); assert.deepEqual(remapped.bibliography, source.bibliography);
  const snapshot = createInitialWorkspace(); snapshot.boards = [{ id: 'b', title: 'B', edges: [], cards: [pdf, excerpt, note('target', { citationStyle: 'gbt-7714-2025', blocks: [{ type: 'paragraph', content: [link(source)] }] })] }]; snapshot.activeId = 'b';
  const restored = mergeRestoredWorkspace(createInitialWorkspace(), snapshot);
  const cards = restored.boards.at(-1).cards, target = cards.find(card => card.title === 'target');
  const restoredSource = parseNoteSource(target.blocks[0].content[0].href);
  assert.equal(restoredSource.contentId, cards.find(card => card.kind === 'pdf').id);
  assert.equal(restoredSource.viaId, cards.find(card => card.title === 'excerpt').id);
  assert.equal(target.citationStyle, 'gbt-7714-2025');
});
test('native formatter keeps printed pages separate from PDF file positions', () => {
  const source = captureNoteSource(excerpt, resolve);
  const [result] = formatNoteBibliography([source]);
  assert.equal(result.text, '[1] 张三, 李四, 王五, 等. A study of learning[J]. 学习研究, 2025, 12(2): 20-30. DOI:10.1234/study.'.replace('等.', 'et al.'));
  assert.deepEqual(result.missing, []);
  const [unknown] = formatNoteBibliography([{ ...source, bibliography: {} }]);
  assert.ok(unknown.missing.includes('authors'));
  assert.doesNotMatch(unknown.text, /2025|20-30|PDF/);
});

test('references use corrected library metadata but preserve page anchors and deleted-source snapshots', () => {
  const source = captureNoteSource(excerpt, resolve);
  const corrected = { ...pdf, bibliography: { ...pdf.bibliography, year: 2026 } };
  const result = referenceSource(source, id => id === pdf.id ? corrected : undefined);
  assert.equal(result.bibliography.year, 2026); assert.deepEqual(result.pages, [2]);
  assert.equal(source.bibliography.year, 2025);
  assert.deepEqual(referenceSource(source, () => undefined), source);
});

test('inserting a new source between citations renumbers later markers without changing anchors or duplicates', () => {
  const a = captureNoteSource(excerpt, resolve);
  const b = { ...a, contentId: 'b', bibliography: { ...a.bibliography, doi: '10.1234/b' } };
  const c = { ...a, contentId: 'c', bibliography: { ...a.bibliography, doi: '10.1234/c' } };
  const content = [link(a), { type: 'text', text: ' original paragraph ', styles: { bold: true } }, link(c), link(b), link(a)];
  const blocks = [{ type: 'paragraph', content }];
  const normalized = labelNoteSources(blocks, 'zh', true);
  assert.deepEqual(normalized[0].content.filter(x => x.type === 'link').map(x => x.content[0].text), ['[1]', '[2]', '[3]', '[1]']);
  assert.deepEqual(documentSources(normalized), documentSources(blocks));
  assert.deepEqual(normalized[0].content[1], content[1]);
  assert.deepEqual(blocks[0].content, content);
  const light = labelNoteSources(normalized, 'zh', false);
  assert.match(light[0].content[0].content[0].text, /来源：.*PDF 第 2 页/);
});
