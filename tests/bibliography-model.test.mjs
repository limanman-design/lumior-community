import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDoi, validBibliography, validBibliographyFields } from '../lib/bibliography.ts';
import { automaticBibliographyPatch, rebaseBibliographyMetadata } from '../app/bibliography-model.ts';
import { syncWorkspaceFiles, patchWorkspaceContent, validWorkspaceFiles } from '../app/workspace-files.ts';
import { reconcileShared } from '../app/shared-cards.ts';
import { readWorkspace } from '../app/workspace-store.ts';
import { mergeRestoredWorkspace } from '../app/workspace-backup.ts';

const card = fields => ({ id: 'source', kind: 'pdf', title: 'paper', body: 'paper.pdf', sourceName: 'paper.pdf', width: 360, x: 50, y: 70, pdf: { url: 'lumior-file:original', name: 'paper.pdf', size: 1000, pages: 8, thumbnail: '' }, ...fields });
const result = { title: 'A verified title', authors: ['Hannah Snyder'], year: 2019, journal: 'Journal of Business Research', doi: '10.1016/j.jbusres.2019.07.039', status: 'resolved' };

void test('DOI identity normalization accepts identifiers and DOI resolver links without arbitrary URLs or control characters', () => {
  assert.equal(normalizeDoi(' DOI: 10.1016/J.JBUSRES.2019.07.039 '), result.doi);
  assert.equal(normalizeDoi('https://doi.org/10.1016%2Fj.jbusres.2019.07.039'), result.doi);
  for (const value of ['https://evil.test/10.1234/x', 'https://doi.org/10.1234/x?file=secret', '10.1234/a\nb', '10.1234/<script>', 'not a DOI', null, {}, '10.1/x']) assert.equal(normalizeDoi(value), undefined);
});

void test('bibliography validation preserves optional legacy compatibility and rejects corrupt or executable field shapes', () => {
  assert.equal(validBibliography(result), true);
  assert.equal(validBibliography({ status: 'pending' }), true);
  assert.equal(validBibliographyFields({ doi: result.doi, year: 2019 }), true);
  for (const value of [{ ...result, authors: ['Name', 1] }, { ...result, year: 2020.5 }, { ...result, url: 'javascript:alert(1)' }, { ...result, status: 'invented' }, { ...result, manualFields: ['title', 'secret'] }, { ...result, origins: { title: 'unknown' } }, { ...result, extra: true }]) assert.equal(validBibliography(value), false);
});

void test('new imports receive fields without replacing original file bytes, body or canvas geometry', () => {
  const source = card({ bibliography: { status: 'pending' } });
  const before = structuredClone(source);
  const patch = automaticBibliographyPatch(source, result);
  assert.equal(patch.title, result.title);
  assert.deepEqual(patch.authors, result.authors);
  assert.equal(patch.year, 2019);
  assert.equal(patch.bibliography.origins.journal, 'doi');
  assert.equal(Object.hasOwn(patch, 'pdf'), false);
  assert.equal(Object.hasOwn(patch, 'body'), false);
  assert.equal(Object.hasOwn(patch, 'x'), false);
  assert.deepEqual(source, before);
});

void test('legacy authors, year and renamed titles remain authoritative during asynchronous recognition', () => {
  const source = card({ title: 'My reading copy', authors: ['My corrected author'], year: 2020 });
  const patch = automaticBibliographyPatch(source, result);
  assert.equal(Object.hasOwn(patch, 'title'), false);
  assert.equal(Object.hasOwn(patch, 'authors'), false);
  assert.equal(Object.hasOwn(patch, 'year'), false);
  assert.deepEqual(patch.bibliography.authors, source.authors);
  assert.equal(patch.bibliography.year, 2020);
  assert.equal(patch.bibliography.journal, result.journal);
});

void test('manual corrections and explicit clearing survive late DOI responses', () => {
  const source = card({ authors: [], year: undefined, bibliography: { status: 'pending', journal: 'Corrected journal', manualFields: ['authors', 'year', 'journal'], origins: { journal: 'manual' } } });
  const patch = automaticBibliographyPatch(source, result);
  assert.deepEqual(patch.bibliography.authors, []);
  assert.equal(patch.bibliography.year, undefined);
  assert.equal(patch.bibliography.journal, 'Corrected journal');
  assert.equal(Object.hasOwn(patch, 'authors'), false);
  assert.equal(Object.hasOwn(patch, 'year'), false);
});

void test('canonical bibliography edits synchronize references while preserving every board position', () => {
  const boards = [{ id: 'a', title: 'A', edges: [], cards: [card({ sharedId: 'source' })] }, { id: 'b', title: 'B', edges: [], cards: [card({ id: 'second', sharedId: 'source', x: 700, y: 800 })] }];
  const files = syncWorkspaceFiles(undefined, boards);
  const updated = patchWorkspaceContent(files, boards, 'source', automaticBibliographyPatch(files.contents[0].card, result));
  assert.equal(updated.files.contents[0].card.bibliography.doi, result.doi);
  assert.equal(updated.boards[0].cards[0].bibliography.journal, result.journal);
  assert.equal(updated.boards[1].cards[0].bibliography.journal, result.journal);
  assert.deepEqual(updated.boards.map(board => [board.cards[0].x, board.cards[0].y]), [[50, 70], [700, 800]]);
  assert.equal(validWorkspaceFiles(updated.files), true);
  assert.throws(() => patchWorkspaceContent(files, boards, 'source', { bibliography: { status: 'review', journal: 'A\tB' } }), /Invalid literature/);
});

void test('reload and add-only backup restoration retain bibliography and manual provenance', () => {
  const source = { ...card({}), ...automaticBibliographyPatch(card({}), result) };
  source.bibliography.manualFields = ['journal']; source.bibliography.origins.journal = 'manual';
  const snapshot = { version: 1, boards: [{ id: 'a', title: 'A', cards: [source], edges: [] }], deletedBoards: [], activeId: 'a', nextUntitledIndex: 1 };
  const loaded = readWorkspace(JSON.stringify(snapshot));
  assert.deepEqual(loaded.files.contents[0].card.bibliography, source.bibliography);
  const original = { version: 1, boards: [], deletedBoards: [], activeId: '', nextUntitledIndex: 1 };
  const restored = mergeRestoredWorkspace(original, loaded);
  assert.deepEqual(restored.files.contents[0].card.bibliography, source.bibliography);
  assert.equal(restored.boards[0].cards[0].pdf.url, source.pdf.url);
  assert.notEqual(restored.boards[0].cards[0].id, source.id);
  snapshot.boards[0].cards[0].bibliography.year = 'bad';
  assert.equal(readWorkspace(JSON.stringify(snapshot)), null);
});

void test('history rebasing changes only supplied metadata on the exact shared PDF while preserving canvas content', () => {
  const source = card({ bibliography: { status: 'pending' } });
  const reference = card({ id: 'reference', sharedId: 'source', x: 800, y: 900, width: 700, height: 600, body: 'Keep caption', detail: 'Keep detail', tags: ['Keep tag'], pdf: { ...source.pdf, thumbnail: 'local thumbnail' }, bibliography: { status: 'pending' } });
  const independent = card({ id: 'independent', bibliography: { status: 'pending' } });
  const replaced = card({ id: 'replaced', sharedId: 'source', pdf: { ...source.pdf, url: 'lumior-file:replacement' }, bibliography: { status: 'pending' } });
  const changedSize = card({ id: 'changed-size', sharedId: 'source', pdf: { ...source.pdf, size: 1001 }, bibliography: { status: 'pending' } });
  const note = { ...card({ id: 'note', sharedId: 'source' }), kind: 'note' };
  const board = { id: 'b', title: 'Unchanged board', cards: [reference, independent, replaced, changedSize, note], edges: [{ id: 'edge', from: reference.id, to: independent.id }], sections: [{ id: 's', title: 'Section', x: 1, y: 2, width: 3, height: 4, color: '#aaa' }] };
  const before = structuredClone(board);
  const patch = { title: result.title, authors: result.authors, year: result.year, bibliography: result, body: 'Never copy this', x: -100, tags: ['Never copy this'] };
  const rebased = rebaseBibliographyMetadata(board, source, patch);
  assert.deepEqual(board, before);
  assert.deepEqual(rebased.cards[0], { ...reference, title: result.title, authors: result.authors, year: result.year, bibliography: result });
  assert.deepEqual(rebased.cards.slice(1), board.cards.slice(1));
  for (let index = 1; index < board.cards.length; index++) assert.strictEqual(rebased.cards[index], board.cards[index]);
  assert.strictEqual(rebased.edges, board.edges);
  assert.strictEqual(rebased.sections, board.sections);
  assert.notStrictEqual(rebased.cards[0].bibliography, patch.bibliography);
  assert.notStrictEqual(rebased.cards[0].authors, patch.authors);
  assert.strictEqual(rebaseBibliographyMetadata(rebased, source, patch), rebased);
  assert.strictEqual(rebaseBibliographyMetadata(board, source, { body: 'Not metadata' }), board);
  assert.strictEqual(rebaseBibliographyMetadata({ ...board, cards: [independent, replaced] }, source, patch).cards[0], independent);
});

void test('undoing and redoing a move retain a metadata correction made after the historical snapshot', () => {
  const initial = { id: 'b', title: 'Board', cards: [card({ bibliography: { status: 'pending' } })], edges: [] };
  const moved = { ...initial, cards: [{ ...initial.cards[0], x: 800 }] };
  const files = syncWorkspaceFiles(undefined, [moved]);
  const patch = { title: 'User corrected title', authors: ['User Corrected'], year: undefined, bibliography: {
    title: 'User corrected title', authors: ['User Corrected'], status: 'review', manualFields: ['title', 'authors', 'year'], origins: { title: 'manual', authors: 'manual', year: 'manual' },
  } };
  const saved = patchWorkspaceContent(files, [moved], 'source', patch);
  const history = rebaseBibliographyMetadata(initial, files.contents[0].card, patch);
  const future = rebaseBibliographyMetadata(moved, files.contents[0].card, patch);
  const undone = reconcileShared(saved.boards[0], history, saved.boards);
  const afterUndo = syncWorkspaceFiles(saved.files, undone);
  assert.equal(undone[0].cards[0].x, initial.cards[0].x);
  assert.equal(afterUndo.contents[0].card.title, patch.title);
  assert.deepEqual(afterUndo.contents[0].card.bibliography, patch.bibliography);
  const redone = reconcileShared(undone[0], future, undone);
  const afterRedo = syncWorkspaceFiles(afterUndo, redone);
  assert.equal(redone[0].cards[0].x, 800);
  assert.equal(afterRedo.contents[0].card.title, patch.title);
  assert.deepEqual(afterRedo.contents[0].card.bibliography.manualFields, ['title', 'authors', 'year']);
});

void test('history rebasing preserves explicit clearing without changing omitted metadata', () => {
  const source = card({ title: 'Kept title', authors: ['Old Author'], year: 2020 });
  const board = { id: 'b', title: 'Board', cards: [source], edges: [] };
  const bibliography = { status: 'review', manualFields: ['authors', 'year'], origins: { authors: 'manual', year: 'manual' } };
  const rebased = rebaseBibliographyMetadata(board, source, { bibliography, authors: undefined, year: undefined });
  assert.equal(rebased.cards[0].authors, undefined);
  assert.equal(rebased.cards[0].year, undefined);
  assert.equal(rebased.cards[0].title, source.title);
  assert.deepEqual(rebased.cards[0].bibliography, bibliography);
  assert.equal(source.year, 2020);
});
