import assert from 'node:assert/strict';
import test from 'node:test';
import { pdfReadingNotes, updatePdfExcerptNote } from '../app/pdf-notes.ts';
import { reconcileWorkspacePdfNotes, pdfReadingNoteIdentity } from '../app/workspace-pdf-notes.ts';
import { contentEntryId, createWorkspaceFolder, deleteWorkspaceContent, moveWorkspaceEntry, patchWorkspaceContent, projectWorkspaceFiles, syncWorkspaceFiles, validWorkspaceFiles } from '../app/workspace-files.ts';
import { readWorkspace } from '../app/workspace-store.ts';
import { libraryInstance } from '../app/shared-cards.ts';
import { duplicateSelectedCards } from '../app/canvas-selection.ts';

const pdf = { url: 'lumior-file:paper.pdf', name: 'paper.pdf', size: 10, pages: 4, thumbnail: '' };
const source = { id: 'source', sharedId: 'paper', title: 'Paper', body: '', kind: 'pdf', pdf, x: 40, y: 60, width: 360 };
const pageNote = { id: 'page-note', text: '', note: 'My reading note', color: '#77cd82', fragments: [{ page: 2, rects: [] }] };
const passage = { ...pageNote, id: 'passage', text: 'Quoted original passage', fragments: [{ page: 3, rects: [{ x: .1, y: .2, width: .3, height: .1 }] }] };
const initialBoards = () => [{ id: 'board', title: 'Board', cards: [structuredClone(source)], edges: [] }];
const setup = () => {
  const boards = initialBoards();
  return { files: syncWorkspaceFiles(undefined, boards), boards };
};
const reconcile = (state, saved, now = '2026-10-21T08:00:00.000Z') => reconcileWorkspacePdfNotes(state.files, state.boards, saved, now);
const notes = files => files.contents.filter(content => content.card.pdfExcerpt);

test('saved page notes and annotated passages become standalone summary materials with source provenance', () => {
  const original = setup();
  original.files = createWorkspaceFolder(original.files, 'Reading', null, 'reading');
  original.files = moveWorkspaceEntry(original.files, contentEntryId('paper'), 'reading');
  const untouched = structuredClone(original);
  const saved = { [pdf.url]: [pageNote, passage, { ...passage, id: 'highlight', note: '' }, { ...pageNote, id: 'blank', note: '  ' }, { ...pageNote, id: 'invalid', fragments: [] }] };
  const next = reconcile(original, saved);
  assert.deepEqual(original, untouched);
  assert.strictEqual(next.boards, original.boards);
  assert.equal(notes(next.files).length, 2);
  for (const content of notes(next.files)) {
    assert.equal(content.role, 'summary');
    assert.equal(content.sourceContentId, 'paper');
    assert.equal(content.card.pdfExcerpt.sourceId, 'paper');
    assert.equal(content.card.pdfExcerpt.readingNote, true);
    assert.equal(content.card.body, 'My reading note');
    assert.equal(next.files.entries.find(entry => entry.contentId === content.id).folderId, 'reading');
  }
  assert.equal(notes(next.files)[0].card.title, 'My reading note');
  assert.equal(notes(next.files)[1].card.title, 'Quoted original passage');
  assert.equal(validWorkspaceFiles(next.files), true);
  assert.equal(projectWorkspaceFiles(next.files, next.boards).filter(item => item.kind === 'notePage').length, 0);
  const repeated = reconcile(next, saved, '2026-10-22T00:00:00.000Z');
  assert.strictEqual(repeated.files, next.files);
  assert.strictEqual(repeated.boards, next.boards);
});

test('existing manual excerpts are updated and never duplicated, preserving geometry across all shared references', () => {
  const excerpt = { id: 'excerpt', kind: 'note', title: 'Custom title', body: 'Old note', blocks: [{ type: 'paragraph', content: 'old' }], x: 800, y: 900, width: 600, height: 450, pdfExcerpt: { sourceId: 'source', sourceTitle: 'Paper', pdf, mark: { ...passage, note: 'Old note' } } };
  const boards = [...initialBoards(), { id: 'other', title: 'Other', cards: [excerpt, { ...excerpt, id: 'copy', sharedId: 'excerpt', x: 1500 }], edges: [{ id: 'edge', from: 'excerpt', to: 'copy' }] }];
  const original = { files: syncWorkspaceFiles(undefined, boards), boards };
  const next = reconcile(original, { [pdf.url]: [{ ...passage, color: '#aabbcc' }] });
  assert.equal(notes(next.files).length, 1);
  assert.equal(notes(next.files)[0].id, 'excerpt');
  assert.equal(notes(next.files)[0].card.title, 'Custom title');
  assert.deepEqual(next.boards[1].cards.map(card => [card.x, card.y, card.width, card.height]), [[800, 900, 600, 450], [1500, 900, 600, 450]]);
  assert.deepEqual(next.boards[1].cards.map(card => card.body), ['My reading note', 'My reading note']);
  assert.ok(next.boards[1].cards.every(card => card.blocks === undefined));
  assert.deepEqual(next.boards[1].edges, boards[1].edges);
  assert.strictEqual(reconcile(next, { [pdf.url]: [{ ...passage, color: '#aabbcc' }] }).files, next.files);
});

test('saved region excerpts without a text note are valid materials', () => {
  const next = reconcile(setup(), { [pdf.url]: [{ ...pageNote, note: '', image: 'lumior-file:region.png' }] });
  const card = notes(next.files)[0].card;
  assert.equal(card.kind, 'image');
  assert.equal(card.image, 'lumior-file:region.png');
  assert.equal(card.title, 'Paper · p.2');
});

test('deleting an annotation retires only unplaced automatic material; board notes become independent', () => {
  const saved = { [pdf.url]: [pageNote, passage] };
  const state = reconcile(setup(), saved);
  const kept = notes(state.files).find(content => content.card.pdfExcerpt.mark.id === passage.id);
  const instance = { ...kept.card, id: 'placed', sharedId: kept.id, x: 990, y: 770, width: 510 };
  state.boards = [{ ...state.boards[0], cards: [...state.boards[0].cards, instance], edges: [{ id: 'source-note', from: source.id, to: 'placed' }] }];
  state.files = syncWorkspaceFiles(state.files, state.boards);
  const next = reconcile(state, { [pdf.url]: [] });
  assert.equal(notes(next.files).length, 1);
  assert.equal(notes(next.files)[0].id, kept.id);
  assert.equal(notes(next.files)[0].card.pdfExcerpt.readingNote, undefined);
  assert.equal(notes(next.files)[0].card.pdfExcerpt.independent, true);
  assert.equal(next.boards[0].cards[1].pdfExcerpt.readingNote, undefined);
  assert.deepEqual([next.boards[0].cards[1].x, next.boards[0].cards[1].y, next.boards[0].cards[1].width], [990, 770, 510]);
  assert.deepEqual(next.boards[0].edges, state.boards[0].edges);
  assert.strictEqual(reconcile(next, { [pdf.url]: [] }).files, next.files);
  const returned = reconcile(next, saved);
  assert.equal(notes(returned.files).length, 3, 'recreated live notes coexist with preserved independent materials');
});

test('removing the source or omitting its annotation collection does not delete saved notes', () => {
  const state = reconcile(setup(), { [pdf.url]: [pageNote] });
  const removedSource = deleteWorkspaceContent(state.files, state.boards, 'paper');
  const next = reconcile(removedSource, { [pdf.url]: [pageNote] });
  assert.equal(notes(next.files).length, 1);
  assert.strictEqual(reconcile(next, {}).files, next.files);
  assert.equal(notes(reconcile(next, {}).files)[0].card.body, pageNote.note);
});

test('blank page notes retire unused material and explicit content deletions stay deleted', () => {
  const saved = { [pdf.url]: [pageNote] };
  const state = reconcile(setup(), saved);
  const empty = reconcile(state, { [pdf.url]: [{ ...pageNote, note: ' ' }] });
  assert.equal(notes(empty.files).length, 0);
  const deleted = deleteWorkspaceContent(state.files, state.boards, pdfReadingNoteIdentity(pdf.url, pageNote.id));
  assert.equal(notes(reconcile(deleted, saved).files).length, 0);
  const legacy = { id: 'legacy-excerpt', kind: 'note', title: 'Existing material', body: pageNote.note, x: 10, y: 20, width: 420, pdfExcerpt: { sourceId: 'source', sourceTitle: 'Paper', pdf, mark: pageNote } };
  const boards = [{ ...initialBoards()[0], cards: [source, legacy] }];
  const legacyFiles = syncWorkspaceFiles(undefined, boards);
  const deletedLegacy = deleteWorkspaceContent(legacyFiles, boards, legacy.id);
  assert.equal(notes(reconcile(deletedLegacy, saved).files).length, 0, 'manual excerpts must not return under a new automatic ID');
});

test('reload backfills historical notes once and preserves the canonical material on another reload', () => {
  const state = setup();
  const snapshot = { version: 1, boards: state.boards, files: state.files, deletedBoards: [], activeId: 'board', nextUntitledIndex: 1, pdfMarks: { [pdf.url]: [pageNote] } };
  const restored = readWorkspace(JSON.stringify(snapshot));
  const next = reconcile({ files: restored.files, boards: restored.boards }, restored.pdfMarks);
  const reloaded = readWorkspace(JSON.stringify({ ...restored, ...next }));
  assert.equal(notes(reloaded.files).length, 1);
  assert.strictEqual(reconcile({ files: reloaded.files, boards: reloaded.boards }, reloaded.pdfMarks).files, reloaded.files);
});

test('canvas or canonical rich text edits remain visible until the annotation note itself changes', () => {
  const saved = { [pdf.url]: [pageNote] };
  const state = reconcile(setup(), saved);
  const content = notes(state.files)[0];
  const edited = patchWorkspaceContent(state.files, state.boards, content.id, { body: 'New thought from the canvas', blocks: [{ type: 'paragraph', content: 'New thought from the canvas' }] });
  const stable = reconcile(edited, saved);
  assert.strictEqual(stable.files, edited.files);
  assert.equal(pdfReadingNotes(pdf.url, saved[pdf.url], stable.files.contents.map(item => item.card))[0].mark.note, 'New thought from the canvas');
  const changed = reconcile(stable, { [pdf.url]: [{ ...pageNote, note: 'Updated in reader' }] });
  assert.equal(notes(changed.files)[0].card.body, 'Updated in reader');
  assert.equal(notes(changed.files)[0].card.blocks, undefined);
  const cleared = patchWorkspaceContent(changed.files, changed.boards, content.id, { body: '' });
  assert.equal(pdfReadingNotes(pdf.url, [{ ...pageNote, note: 'Updated in reader' }], cleared.files.contents.map(item => item.card))[0].mark.note, '');
});

test('independent copies are never automatically retired when their source annotation is removed', () => {
  const state = reconcile(setup(), { [pdf.url]: [pageNote] });
  const original = notes(state.files)[0].card;
  const copy = libraryInstance(original, { x: 600, y: 700 }, false, 'independent');
  assert.equal(copy.pdfExcerpt.readingNote, undefined);
  assert.equal(copy.pdfExcerpt.independent, true);
  assert.equal(original.pdfExcerpt.readingNote, true);
  assert.equal(libraryInstance(original, { x: 1, y: 2 }, true, 'reference').pdfExcerpt.readingNote, true);
  const boards = [{ ...state.boards[0], cards: [...state.boards[0].cards, copy] }];
  const files = syncWorkspaceFiles(state.files, boards);
  const deleted = reconcile({ files, boards }, { [pdf.url]: [] });
  assert.equal(notes(deleted.files).length, 1);
  assert.equal(notes(deleted.files)[0].id, copy.id);
  assert.equal(deleted.boards[0].cards.find(card => card.id === copy.id).body, pageNote.note);
});

test('independent copy text and blocks survive original annotation edits, deletion and reload', () => {
  const saved = { [pdf.url]: [pageNote] };
  const state = reconcile(setup(), saved);
  const copy = libraryInstance(notes(state.files)[0].card, { x: 600, y: 700 }, false, 'independent');
  copy.body = 'Independent interpretation';
  copy.blocks = [{ type: 'paragraph', content: 'Independent interpretation' }];
  const boards = [{ ...state.boards[0], cards: [...state.boards[0].cards, copy] }];
  const files = syncWorkspaceFiles(state.files, boards);
  const changedMarks = { [pdf.url]: [{ ...pageNote, note: 'Original PDF note changed', color: '#aabbcc' }] };
  const changed = reconcile({ files, boards }, changedMarks);
  const independent = changed.files.contents.find(content => content.id === copy.id).card;
  assert.deepEqual(independent, { ...copy, sharedId: copy.id });
  assert.strictEqual(updatePdfExcerptNote(changed.boards[0], pdf.url, pageNote.id, 'Explicit reader save').cards.find(card => card.id === copy.id), changed.boards[0].cards.find(card => card.id === copy.id));
  assert.equal(pdfReadingNotes(pdf.url, [], [copy]).length, 0);
  assert.equal(pdfReadingNotes(pdf.url, changedMarks[pdf.url], [copy])[0].mark.note, 'Original PDF note changed');
  const snapshot = { version: 1, ...changed, boards: changed.boards, deletedBoards: [], activeId: 'board', nextUntitledIndex: 1, pdfMarks: changedMarks };
  const loaded = readWorkspace(JSON.stringify(snapshot));
  const removed = reconcile({ files: loaded.files, boards: loaded.boards }, { [pdf.url]: [] });
  const retained = removed.files.contents.find(content => content.id === copy.id).card;
  assert.equal(retained.pdfExcerpt.independent, true);
  assert.equal(retained.body, 'Independent interpretation');
  assert.deepEqual(retained.blocks, copy.blocks);
  assert.deepEqual([retained.x, retained.y, retained.width], [600, 700, 420]);
  const explicitRemoval = deleteWorkspaceContent(removed.files, removed.boards, copy.id);
  assert.equal(explicitRemoval.files.deletedContentIds.includes(pdfReadingNoteIdentity(pdf.url, pageNote.id)), false);
});

test('multi-selection copies detach PDF notes and keep their own saved content after reload', () => {
  const state = reconcile(setup(), { [pdf.url]: [pageNote, passage] });
  const materials = notes(state.files).map(content => content.card);
  const boards = [{ ...state.boards[0], cards: [...state.boards[0].cards, ...materials] }];
  let sequence = 0;
  const duplicated = duplicateSelectedCards(boards[0], materials.map(card => card.id), {}, { idFactory: () => `copied-${++sequence}`, now: () => '2026-10-21T09:00:00.000Z' });
  for (const id of duplicated.newIds) {
    const card = duplicated.board.cards.find(item => item.id === id);
    assert.equal(card.pdfExcerpt.readingNote, undefined);
    assert.equal(card.pdfExcerpt.independent, true);
    card.body = `My independent work ${id}`;
    card.blocks = [{ type: 'paragraph', content: card.body }];
  }
  const copiedBoards = [duplicated.board];
  const copiedFiles = syncWorkspaceFiles(state.files, copiedBoards);
  const loaded = readWorkspace(JSON.stringify({ version: 1, files: copiedFiles, boards: copiedBoards, deletedBoards: [], activeId: 'board', nextUntitledIndex: 1, pdfMarks: { [pdf.url]: [pageNote, passage] } }));
  const updated = reconcile({ files: loaded.files, boards: loaded.boards }, { [pdf.url]: [{ ...pageNote, note: 'Updated original' }, { ...passage, note: 'Updated quotation' }] });
  const deleted = reconcile(updated, { [pdf.url]: [] });
  for (const id of duplicated.newIds) {
    const content = deleted.files.contents.find(item => item.id === id);
    assert.equal(content.card.body, `My independent work ${id}`);
    assert.deepEqual(content.card.blocks, [{ type: 'paragraph', content: `My independent work ${id}` }]);
    assert.equal(content.card.pdfExcerpt.independent, true);
    assert.ok(deleted.boards[0].cards.some(card => card.id === id));
  }
});

test('first backfill preserves independently authored legacy excerpt bodies and blocks', () => {
  const legacy = { id: 'legacy', title: 'My argument', body: 'Work written on the canvas', blocks: [{ type: 'paragraph', content: 'Work written on the canvas' }], kind: 'note', x: 100, y: 200, width: 420, pdfExcerpt: { sourceId: source.id, sourceTitle: source.title, pdf, mark: { ...passage, note: 'Old embedded note' } } };
  const boards = [{ ...initialBoards()[0], cards: [source, legacy] }];
  const files = syncWorkspaceFiles(undefined, boards);
  const loaded = readWorkspace(JSON.stringify({ version: 1, files, boards, deletedBoards: [], activeId: 'board', nextUntitledIndex: 1, pdfMarks: { [pdf.url]: [{ ...passage, note: 'Different stored annotation' }] } }));
  const next = reconcile({ files: loaded.files, boards: loaded.boards }, loaded.pdfMarks);
  const card = next.files.contents.find(content => content.id === legacy.id).card;
  assert.equal(card.body, legacy.body);
  assert.deepEqual(card.blocks, legacy.blocks);
  assert.equal(card.pdfExcerpt.mark.note, 'Different stored annotation');
  assert.equal(next.boards[0].cards.find(item => item.id === legacy.id).body, legacy.body);
  assert.equal(pdfReadingNotes(pdf.url, loaded.pdfMarks[pdf.url], [card])[0].mark.note, legacy.body);
});
