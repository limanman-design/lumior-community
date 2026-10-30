import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
import { bibliographyFields, validBibliography } from '../lib/bibliography.ts';
import { readWorkspace } from '../app/workspace-store.ts';
import { patchWorkspaceContent, syncWorkspaceFiles, validWorkspaceFiles } from '../app/workspace-files.ts';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const card = extra => ({ id: 'pdf', kind: 'pdf', title: 'Imported paper.pdf', body: '', x: 0, y: 0, width: 360,
  pdf: { url: '/synthetic-paper.pdf', name: 'paper.pdf', size: 10, pages: 2, thumbnail: '' }, ...extra });
let temporary;
let ui;

before(async () => {
  temporary = await mkdtemp(join(root, 'tests', '.bibliography-dialog-'));
  await build({ configFile: false, resolve: { alias: { '@': root } }, logLevel: 'silent',
    build: { ssr: join(root, 'app/bibliography-dialog.tsx'), outDir: temporary, emptyOutDir: false, minify: false,
      rolldownOptions: { output: { format: 'es', entryFileNames: 'dialog.mjs' } } } });
  ui = await import(pathToFileURL(join(temporary, 'dialog.mjs')).href);
});
after(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); });

void test('legacy cards initialize author and year fields without inventing missing publication data', () => {
  const original = card({ authors: ['Legacy Author'], year: 2019, tags: ['MBA'] });
  const before = JSON.stringify(original);
  const draft = ui.bibliographyDraft(original);
  assert.equal(draft.title, 'Imported paper.pdf');
  assert.equal(draft.authors, 'Legacy Author');
  assert.equal(draft.year, '2019');
  assert.equal(draft.journal, '');
  assert.equal(draft.doi, '');
  assert.equal(draft.tags, 'MBA');
  assert.equal(JSON.stringify(original), before);
});

void test('late DOI results preserve fields typed or cleared while the request was pending', () => {
  const draft = { ...ui.bibliographyDraft(card({})), title: 'My typed title', authors: '' };
  const result = ui.mergeBibliographySuggestion(draft,
    { title: 'DOI title', authors: ['Remote Author'], journal: 'Verified Journal', year: 2020 },
    new Set(['authors']), { title: 0 }, { title: 1 });
  assert.equal(result.draft.title, 'My typed title');
  assert.equal(result.draft.authors, '');
  assert.equal(result.draft.journal, 'Verified Journal');
  assert.equal(result.draft.year, '2020');
  assert.deepEqual(result.changed.sort(), ['journal', 'year']);
  assert.equal(draft.journal, '');
});

void test('saving explicit clears retains manual protections and compatibility fields', () => {
  const original = card({ title: 'A paper', authors: ['Before'], year: 2020,
    bibliography: { title: 'A paper', authors: ['Before'], year: 2020, journal: 'Keep journal', status: 'resolved', origins: { authors: 'doi', year: 'doi' } } });
  const draft = { ...ui.bibliographyDraft(original), authors: '', year: '', doi: 'https://doi.org/10.1234/EXAMPLE' };
  const patch = ui.bibliographyDraftPatch(original, draft, new Set(['authors', 'year', 'doi']), new Set(['authors', 'year', 'doi']), {}, 'review');
  assert.equal(patch.authors, undefined);
  assert.ok(Object.hasOwn(patch, 'authors'));
  assert.ok(Object.hasOwn(patch, 'year'));
  assert.equal(patch.bibliography.authors, undefined);
  assert.equal(patch.bibliography.year, undefined);
  assert.equal(patch.bibliography.journal, 'Keep journal');
  assert.equal(patch.bibliography.doi, '10.1234/example');
  assert.deepEqual(patch.bibliography.manualFields.sort(), ['authors', 'doi', 'year']);
  assert.equal(patch.bibliography.origins.authors, 'manual');
  assert.ok(validBibliography(patch.bibliography));
  assert.deepEqual(original.authors, ['Before']);
});

void test('unmodified draft fields do not overwrite bibliography discovered in the background', () => {
  const old = card({});
  const draft = { ...ui.bibliographyDraft(old), tags: 'MBA，trust, MBA' };
  const latest = card({ title: 'Background title', authors: ['New Author'], year: 2021,
    bibliography: { title: 'Background title', authors: ['New Author'], year: 2021, journal: 'Background journal', status: 'resolved' } });
  const patch = ui.bibliographyDraftPatch(latest, draft, new Set(['tags']), new Set(), {}, 'unavailable');
  assert.deepEqual(patch, { tags: ['MBA', 'trust'] });
  const titlePatch = ui.bibliographyDraftPatch(latest, { ...draft, title: 'My title' }, new Set(['title']), new Set(['title']), { title: 'manual' }, 'review');
  assert.equal(titlePatch.title, 'My title');
  assert.equal(titlePatch.bibliography.year, 2021);
  assert.equal(titlePatch.bibliography.journal, 'Background journal');
  assert.deepEqual(titlePatch.bibliography.authors, ['New Author']);
});

void test('a lookup suggestion cannot overwrite a manual field newly saved elsewhere', () => {
  const draft = { ...ui.bibliographyDraft(card({})), journal: 'Lookup journal' };
  const latest = card({ bibliography: { journal: 'User journal', status: 'review', origins: { journal: 'manual' }, manualFields: ['journal'] } });
  const patch = ui.bibliographyDraftPatch(latest, draft, new Set(['journal']), new Set(), { journal: 'doi' }, 'resolved');
  assert.equal(patch.bibliography.journal, 'User journal');
  assert.equal(patch.bibliography.origins.journal, 'manual');
});

void test('saving reviewed DOI data does not mark untouched fields manual', () => {
  const original = card({});
  const draft = { ...ui.bibliographyDraft(original), title: 'Verified title', year: '2020', journal: 'Verified journal' };
  const patch = ui.bibliographyDraftPatch(original, draft, new Set(['title', 'year', 'journal']), new Set(), { title: 'doi', year: 'doi', journal: 'doi' }, 'resolved');
  assert.equal(patch.title, 'Verified title');
  assert.equal(patch.year, 2020);
  assert.deepEqual(patch.bibliography.manualFields, []);
  assert.equal(patch.bibliography.origins.title, 'doi');
  assert.ok(validBibliography(patch.bibliography));
});

void test('legacy author and year metadata and manual origin flags remain protected when edited elsewhere', () => {
  const draft = { ...ui.bibliographyDraft(card({})), authors: 'Lookup author', year: '2020', journal: 'Lookup journal' };
  const latest = card({ authors: ['Legacy Author'], year: 2017,
    bibliography: { journal: 'My journal', status: 'review', origins: { journal: 'manual' } } });
  const patch = ui.bibliographyDraftPatch(latest, draft, new Set(['authors', 'year', 'journal']), new Set(), { authors: 'doi', year: 'doi', journal: 'doi' }, 'resolved');
  assert.equal(patch.authors, undefined);
  assert.equal(patch.year, undefined);
  assert.equal(patch.bibliography.journal, 'My journal');
  assert.deepEqual(patch.bibliography.manualFields.sort(), ['authors', 'journal', 'year']);
  assert.deepEqual(latest.authors, ['Legacy Author']);
});

void test('pasted control whitespace is normalized before a saved patch passes validation and workspace reload', () => {
  const original = card({});
  const draft = { ...ui.bibliographyDraft(original), title: ' A\tTitle\u0000 ', authors: ' Alpha\tPerson \r\n Beta\u007fName \n',
    year: ' 2020 ', journal: 'Journal\t of\u0085 Work', doi: 'https://doi.org/10.1234/EXAMPLE',
    type: ' journal-article\t', volume: ' 12\t', issue: ' 2\n', pages: ' 10–20 ', url: 'https://example.test/article\u0000', tags: ' MBA\tThesis, Trust ' };
  const fields = new Set(bibliographyFields);
  const patch = ui.bibliographyDraftPatch(original, draft, new Set([...fields, 'tags']), fields, {}, 'review');
  assert.equal(patch.title, 'A Title');
  assert.deepEqual(patch.authors, ['Alpha Person', 'Beta Name']);
  assert.equal(patch.bibliography.journal, 'Journal of Work');
  assert.equal(patch.bibliography.url, 'https://example.test/article');
  assert.deepEqual(patch.tags, ['MBA Thesis', 'Trust']);
  assert.ok(validBibliography(patch.bibliography));

  const boards = [{ id: 'bibliography-edit', title: 'Saved literature', cards: [original], edges: [] }];
  const files = syncWorkspaceFiles(undefined, boards);
  const saved = patchWorkspaceContent(files, boards, original.id, patch);
  assert.equal(validWorkspaceFiles(saved.files), true);
  const reloaded = readWorkspace(JSON.stringify({ version: 1, boards: saved.boards, files: saved.files,
    deletedBoards: [], activeId: 'bibliography-edit', nextUntitledIndex: 1 }));
  assert.ok(reloaded, 'Saving a manual edit must never make the workspace unreadable');
  assert.deepEqual(reloaded.files.contents[0].card.bibliography, patch.bibliography);
  assert.equal(reloaded.boards[0].cards[0].pdf.url, original.pdf.url);
});

void test('the patch boundary rejects overlong, invalid numeric and invalid DOI values before persistence', () => {
  const original = card({});
  for (const [field, value] of [['title', 'x'.repeat(2001)], ['journal', 'x'.repeat(501)], ['year', '2020.5'], ['year', '3000'], ['doi', '10.1234/a\tb'], ['url', 'javascript:alert(1)'], ['authors', 'x'.repeat(301)]]) {
    const draft = { ...ui.bibliographyDraft(original), [field]: value };
    assert.throws(() => ui.bibliographyDraftPatch(original, draft, new Set([field]), new Set([field]), {}, 'review'), RangeError, `${field} must not reach onSave`);
  }
});

void test('review reasons follow accepted recognition results and clear after a verified DOI match', () => {
  const original = card({ bibliography: { status: 'unavailable', reason: 'no-text' } });
  const draft = { ...ui.bibliographyDraft(original), journal: 'Recognized journal' };
  const review = ui.bibliographyDraftPatch(original, draft, new Set(['journal']), new Set(), { journal: 'pdf' }, 'review', 'ambiguous');
  assert.equal(review.bibliography.reason, 'ambiguous');
  assert.ok(validBibliography(review.bibliography));
  const resolved = ui.bibliographyDraftPatch(original, draft, new Set(['journal']), new Set(), { journal: 'doi' }, 'resolved');
  assert.equal(resolved.bibliography.reason, undefined);
  assert.ok(validBibliography(resolved.bibliography));
});

void test('changing a DOI during lookup discards the whole previous paper result, including nonmanual fields', () => {
  const draft = { ...ui.bibliographyDraft(card({})), doi: '10.1234/paper-b' };
  const result = ui.mergeBibliographySuggestion(draft,
    { doi: '10.1234/paper-a', title: 'Paper A', authors: ['Author A'], year: 2020, journal: 'Journal A' },
    new Set(['doi']), { doi: 1 }, { doi: 2 }, { value: '10.1234/paper-a', version: 1 });
  assert.equal(result.discarded, 'doi-changed');
  assert.equal(result.draft, draft);
  assert.deepEqual(result.changed, []);
  assert.equal(result.draft.authors, '');
  assert.equal(result.draft.journal, '');
});

void test('PDF recognition also discards its whole result if the user changes or clears the DOI while waiting', () => {
  for (const [before, after] of [['', '10.1234/other'], ['10.1234/paper-a', ''], ['10.1234/paper-a', '10.1234/paper-a']]) {
    const draft = { ...ui.bibliographyDraft(card({})), doi: after };
    const result = ui.mergeBibliographySuggestion(draft, { doi: '10.1234/paper-a', title: 'PDF paper A', authors: ['PDF Author'] },
      new Set(['doi']), { doi: 0 }, { doi: 1 }, { value: before, version: 0 });
    assert.equal(result.discarded, 'doi-changed');
    assert.deepEqual(result.changed, []);
    assert.equal(result.draft.title, 'Imported paper.pdf');
  }
});

void test('unchanged request identities accept matching records and reject DOI conflicts without partial merging', () => {
  const draft = { ...ui.bibliographyDraft(card({})), doi: 'https://doi.org/10.1234/PAPER-A' };
  const accepted = ui.mergeBibliographySuggestion(draft, { doi: '10.1234/paper-a', title: 'Paper A' },
    new Set(['doi']), { doi: 1 }, { doi: 1 }, { value: '10.1234/paper-a', version: 1 });
  assert.equal(accepted.discarded, undefined);
  assert.equal(accepted.draft.title, 'Paper A');
  const rejected = ui.mergeBibliographySuggestion(draft, { doi: '10.1234/paper-b', title: 'Paper B' },
    new Set(['doi']), { doi: 1 }, { doi: 1 }, { value: draft.doi, version: 1 });
  assert.equal(rejected.discarded, 'doi-mismatch');
  assert.deepEqual(rejected.changed, []);
  assert.equal(rejected.draft.title, 'Imported paper.pdf');
});

void test('saving a manually changed DOI retains review status and clears the previous DOI reason', () => {
  const original = card({ bibliography: { doi: '10.1234/paper-a', title: 'Previous title', status: 'resolved', reason: 'no-match' } });
  const draft = { ...ui.bibliographyDraft(original), doi: '10.1234/paper-b' };
  const patch = ui.bibliographyDraftPatch(original, draft, new Set(['doi']), new Set(['doi']), { doi: 'manual' }, 'review');
  assert.equal(patch.bibliography.status, 'review');
  assert.equal(patch.bibliography.doi, '10.1234/paper-b');
  assert.equal(patch.bibliography.reason, undefined);
  assert.equal(patch.bibliography.title, 'Previous title');
});
