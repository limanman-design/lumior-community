import test from 'node:test';
import assert from 'node:assert/strict';
import { workspacePdfContext } from '../app/workspace-pdf-context.ts';
import { linkedPdfNotes } from '../app/pdf-notes.ts';
import { readWorkspace } from '../app/workspace-store.ts';
import { patchWorkspaceContent } from '../app/workspace-files.ts';

void test('file reader keeps each PDF reading note and cross-paper question after workspace restoration', () => {
  const note = id => ({ id, kind: 'note', title: id, body: 'Synthetic note', x: 0, y: 0, width: 360 });
  const pdfs = ['one', 'two'].map(id => ({ ...note(id), kind: 'pdf', pdf: { url: `/${id}.pdf`, name: `${id}.pdf`, size: 20, pages: 1 } }));
  const board = { id: 'reading', title: 'Synthetic reading board', cards: [...pdfs, note('reading-one'), note('reading-two'), note('question')],
    edges: pdfs.flatMap(pdf => [
      { id: `${pdf.id}:reading`, from: pdf.id, to: `reading-${pdf.id}` },
      { id: `${pdf.id}:question`, from: pdf.id, to: 'question' },
    ]) };
  const workspace = readWorkspace(JSON.stringify({ version: 1, boards: [board], deletedBoards: [], activeId: board.id, nextUntitledIndex: 1, pdfMarks: {} }));
  for (const pdf of pdfs) {
    const content = workspace.files.contents.find(item => item.id === pdf.id);
    const view = workspacePdfContext(content, workspace.files.contents, workspace.boards);
    assert.deepEqual(new Set(linkedPdfNotes(content.card, view).map(item => item.id)), new Set([`reading-${pdf.id}`, 'question']));
  }
  const edited = patchWorkspaceContent(workspace.files, workspace.boards, 'question', { body: 'Revised explanation' });
  for (const pdf of pdfs) {
    const content = edited.files.contents.find(item => item.id === pdf.id);
    const view = workspacePdfContext(content, edited.files.contents, edited.boards);
    assert.equal(linkedPdfNotes(content.card, view).find(item => item.id === 'question').body, 'Revised explanation');
  }
});

void test('connections resolve per-board aliases and deduplicate without reviving deleted or unrelated content', () => {
  const pdf = { id: 'pdf', card: { id: 'pdf', kind: 'pdf', title: 'PDF', pdf: { url: '/one.pdf' } } };
  const note = { id: 'note', card: { id: 'note', kind: 'note' } };
  const unrelated = { id: 'other', card: { id: 'other', kind: 'note' } };
  const board = { id: 'a', cards: [ { ...pdf.card, id: 'p', sharedId: 'pdf' }, { ...note.card, id: 'n', sharedId: 'note' } ], edges: [ { id: 'edge', from: 'p', to: 'n' }, { id: 'stale', from: 'p', to: 'deleted' } ] };
  const before = JSON.stringify(board);
  const view = workspacePdfContext(pdf, [pdf, note, unrelated], [board, { ...board, id: 'b' }]);
  assert.equal(view.edges.length, 1);
  assert.deepEqual(linkedPdfNotes(pdf.card, view), [note.card]);
  assert.equal(JSON.stringify(board), before);
  assert.deepEqual(workspacePdfContext(pdf, [pdf, unrelated], [board]).edges, []);
});
