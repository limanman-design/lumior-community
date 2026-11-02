import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { formatNoteBibliography } from '../lib/note-bibliography.ts';
import { validBibliography, validBibliographyDate } from '../lib/bibliography.ts';
import { findReferenceEdit, setReferenceEdit, validNoteReferenceEdits, referenceTextLimit, normalizeReferenceText } from '../app/note-reference-edits.ts';
import { noteSourceLink, parseNoteSource, referenceSource, numberedSources } from '../app/note-source.ts';
import { createInitialWorkspace, readWorkspace } from '../app/workspace-store.ts';
import { syncWorkspaceFiles, patchWorkspaceContent, validWorkspaceFiles } from '../app/workspace-files.ts';
import { mergeRestoredWorkspace } from '../app/workspace-backup.ts';
import { recycleWorkspaceContent, restoreWorkspaceContent } from '../app/workspace-file-recycle.ts';

// Fictional fixtures. Expected strings are independently specified, not copied
// from another formatting engine. Each major publication shape is exercised.
const source = (bibliography = {}, id = 'pdf') => ({ version: 1, contentId: id, title: '来源标题', kind: 'pdf', pages: [9], bibliography: { title: '学习研究', authors: ['张三'], year: 2025, ...bibliography } });
const format = fields => formatNoteBibliography([source(fields)])[0];
const note = (id, extra = {}) => ({ id, kind: 'note', title: id, body: 'Original text', x: 0, y: 0, width: 360, ...extra });

test('numeric journal entries retain publication pages, DOI and deterministic punctuation', () => {
  const fields = { type: 'journal-article', journal: '学习科学', volume: '12', issue: '2', pages: '20-30', doi: '10.1234/study', authors: ['张三', '李四', '王五', '赵六'] };
  const entry = format(fields);
  assert.equal(entry.text, '[1] 张三, 李四, 王五, 等. 学习研究[J]. 学习科学, 2025, 12(2): 20-30. DOI:10.1234/study.');
  assert.deepEqual(entry.missing, []); assert.deepEqual(entry.warnings, []);
  assert.equal(format(fields).text, entry.text);
});
test('English author names are preserved and reviewed rather than guessing surname boundaries', () => {
  const entry = format({ title: 'Learning together', type: 'review', authors: ['van der Meer, Anne', 'Li Wei', 'Learning Institute', 'Fourth Author'], journal: 'Learning', pages: 'e123' });
  assert.match(entry.text, /van der Meer, Anne, Li Wei, Learning Institute, et al\. Learning together\[J\]/);
  assert.deepEqual(entry.warnings, ['authorNames']);
});
test('book imprint, edition and optional publication pages', () => {
  const fields = { type: 'book', publisherPlace: '南京', publisher: '示例出版社', edition: '第2版', pages: '45-46' };
  assert.equal(format(fields).text, '[1] 张三. 学习研究[M]. 第2版. 南京: 示例出版社, 2025: 45-46.');
  assert.doesNotMatch(format({ ...fields, edition: '第1版' }).text, /第1版/);
  assert.deepEqual(format({ ...fields, pages: undefined }).missing, []);
});
test('chapter and conference papers keep their parent publication and imprint', () => {
  const fields = { containerTitle: '教学研究文集', containerAuthors: '李四', publisherPlace: '上海', publisher: '示例出版社', pages: '30-42' };
  assert.equal(format({ ...fields, type: 'book-chapter' }).text, '[1] 张三. 学习研究[M]//李四. 教学研究文集. 上海: 示例出版社, 2025: 30-42.');
  assert.equal(format({ ...fields, type: 'proceedings-article' }).text, '[1] 张三. 学习研究[C]//李四. 教学研究文集. 上海: 示例出版社, 2025: 30-42.');
});
test('thesis uses institution and location, report uses explicit release date', () => {
  const fields = { publisherPlace: '武汉', publisher: '示例大学' };
  assert.equal(format({ ...fields, type: 'dissertation' }).text, '[1] 张三. 学习研究[D]. 武汉: 示例大学, 2025.');
  assert.equal(format({ ...fields, type: 'report', publishedDate: '2025-02-08' }).text, '[1] 张三. 学习研究[R]. 武汉: 示例大学, 2025-02-08.');
});
test('standards and whole proceedings are not treated as journal articles', () => {
  assert.match(format({ type: 'standard' }).text, /\[S\]/);
  assert.match(format({ type: 'proceedings' }).text, /\[C\]/);
  assert.deepEqual(format({ type: 'standard' }).missing, ['publisher', 'publisherPlace']);
});
test('web entries have explicit access dates and never invent today as the access date', () => {
  const fields = { type: 'webpage', publishedDate: '2025-06-09', accessedDate: '2026-11-02', url: 'https://example.org/study' };
  assert.equal(format(fields).text, '[1] 张三. 学习研究[EB/OL]. (2025-06-09) [2026-11-02]. https://example.org/study.');
  const missing = format({ type: 'webpage' });
  assert.deepEqual(missing.missing, ['url', 'accessedDate']); assert.doesNotMatch(missing.text, /2026-11-02/);
});
test('online journal keeps J type and unknown types are explicitly marked for manual formatting', () => {
  assert.match(format({ type: 'journal-article', url: 'https://example.org/paper' }).text, /\[J\/OL\]/);
  const unknown = format({ type: 'dataset' });
  assert.match(unknown.text, /\[Z\]/); assert.ok(unknown.warnings.includes('unsupportedType'));
});
test('incomplete metadata never substitutes PDF positions or invents publication fields', () => {
  const [entry] = formatNoteBibliography([{ ...source(), bibliography: {} }]);
  assert.equal(entry.text, '[1] 来源标题[Z].');
  assert.deepEqual(entry.missing, ['title', 'authors', 'year']);
  assert.doesNotMatch(entry.text, /9|undefined|null/);
});
test('extended optional fields validate real calendar dates and retain old records', () => {
  assert.equal(validBibliography({ status: 'pending' }), true);
  const fields = { status: 'review', publisher: '示例大学', publisherPlace: '武汉', edition: '第2版', containerTitle: '论文集', containerAuthors: '责任者', publishedDate: '2024-02-29', accessedDate: '2026-11-02' };
  assert.equal(validBibliography(fields), true);
  for (const date of ['2025-02-29', '2026-13-01', '2026-11-31', '2026-2-1', '0000-01-01', '3000-01-01']) {
    assert.equal(validBibliographyDate(date), false); assert.equal(validBibliography({ ...fields, accessedDate: date }), false);
  }
  assert.equal(validBibliography({ ...fields, publisher: 1 }), false);
});
test('manual text is per-note, strips pasted numbering, normalizes whitespace and restores to automatic', () => {
  const s = source({ doi: '10.1234/study' });
  const edits = setReferenceEdit(undefined, s, '[27] 修正后的文献\n第二行');
  assert.deepEqual(edits, [{ sourceId: 'pdf', doi: '10.1234/study', text: '修正后的文献 第二行' }]);
  assert.equal(findReferenceEdit(undefined, s), undefined);
  assert.equal(findReferenceEdit(edits, { ...s, contentId: 'doi-copy' }).text, edits[0].text);
  assert.equal(setReferenceEdit(edits, s, undefined), undefined);
  assert.equal(edits[0].text, '修正后的文献 第二行');
});
test('library corrections and renumbering do not overwrite note-local edits or source anchors', () => {
  const s = source(), other = source({}, 'other');
  const edits = setReferenceEdit(undefined, s, '我的文献文字');
  const corrected = referenceSource(s, () => note('pdf', { kind: 'pdf', bibliography: { title: '更正题名', year: 2026, status: 'resolved' } }));
  assert.equal(findReferenceEdit(edits, corrected).text, '我的文献文字');
  assert.deepEqual(corrected.pages, [9]);
  assert.deepEqual([...numberedSources([other, s]).values()].map(x => x.number), [1, 2]);
  assert.equal(findReferenceEdit(edits, s).text, '我的文献文字');
});
test('invalid, unbounded and duplicate reference edit data is rejected', () => {
  for (const edits of [null, {}, [{ sourceId: '', text: 'A' }], [{ sourceId: 'a', text: '' }], [{ sourceId: 'a', text: 'A\nB' }], [{ sourceId: 'a', text: 'A', doi: 'not DOI' }], [{ sourceId: 'a', text: 'A', extra: true }], [{ sourceId: 'a', text: 'A' }, { sourceId: 'a', text: 'B' }]]) assert.equal(validNoteReferenceEdits(edits), false);
  assert.throws(() => setReferenceEdit(undefined, source(), '[2] '));
  assert.throws(() => setReferenceEdit(undefined, source(), 'x'.repeat(referenceTextLimit + 1)));
});
test('reference edits persist through shared-note updates, reload, recycle and backup with remapped IDs', () => {
  const s = source({ type: 'book', publisher: '示例出版社', publisherPlace: '南京' });
  const edits = setReferenceEdit(undefined, s, '手动条目');
  let snapshot = createInitialWorkspace();
  snapshot.boards = [{ id: 'board', title: 'Board', edges: [], cards: [note('pdf', { kind: 'pdf', bibliography: { ...s.bibliography, status: 'resolved' } }), note('target', { citationStyle: 'gbt-7714-2025', blocks: [{ type: 'paragraph', content: [{ type: 'link', href: noteSourceLink(s), content: [{ type: 'text', text: '[1]', styles: {} }] }] }] })] }];
  snapshot.activeId = 'board'; snapshot.files = syncWorkspaceFiles(undefined, snapshot.boards);
  snapshot = { ...snapshot, ...patchWorkspaceContent(snapshot.files, snapshot.boards, 'target', { citationEdits: edits }) };
  assert.equal(validWorkspaceFiles(snapshot.files), true);
  assert.equal(snapshot.boards[0].cards[0].citationEdits, undefined);
  const loaded = readWorkspace(JSON.stringify(snapshot));
  assert.deepEqual(loaded.boards[0].cards[1].citationEdits, edits);
  const removed = recycleWorkspaceContent(loaded.files, loaded.boards, 'target');
  const restored = restoreWorkspaceContent(removed.files, removed.boards, 'target');
  assert.deepEqual(restored.files.contents.find(c => c.id === 'target').card.citationEdits, edits);
  const backup = mergeRestoredWorkspace(createInitialWorkspace(), loaded);
  const target = backup.files.contents.find(c => c.card.title === 'target').card;
  const restoredSource = parseNoteSource(target.blocks[0].content[0].href);
  assert.notEqual(restoredSource.contentId, 'pdf');
  assert.equal(target.citationEdits[0].sourceId, restoredSource.contentId);
  assert.equal(findReferenceEdit(target.citationEdits, restoredSource).text, '手动条目');
  assert.equal(target.citationStyle, 'gbt-7714-2025');
  assert.throws(() => patchWorkspaceContent(loaded.files, loaded.boards, 'target', { citationEdits: [{ text: 'bad' }] }));
});
test('citation processor and license payload are removed from production dependencies and resources', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.dependencies.citeproc, undefined);
  await assert.rejects(access(new URL('../public/citation-styles/citeproc-2.4.63-source.js', import.meta.url)));
});

test('automatic reference saving normalizes pasted labels and rejects blank or oversized drafts', () => {
  assert.equal(normalizeReferenceText('[42] 张三.  研究标题[J].\n2026.'), '张三. 研究标题[J]. 2026.');
  for (const value of ['', '  ', '[42] ', 'a'.repeat(referenceTextLimit + 1), 'bad\u0000text']) assert.throws(() => normalizeReferenceText(value));
});
