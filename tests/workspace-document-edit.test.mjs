import test from 'node:test';
import assert from 'node:assert/strict';
import { CardDocumentEcho } from '../app/card-document-echo.ts';
import { patchWorkspaceContent, syncWorkspaceFiles } from '../app/workspace-files.ts';

const blocks = text => [{ id: 'paragraph', type: 'paragraph', content: [{ type: 'text', text, styles: {} }] }];
const note = (id, extra = {}) => ({ id, kind: 'note', title: 'Reading note', body: 'Original', blocks: blocks('Original'), x: 40, y: 80, width: 420, ...extra });
const board = (id, cards) => ({ id, title: id, cards, edges: [] });

test('expanded edits keep local block identity through registry sync and every canvas reference', () => {
  const original = note('source');
  const other = note('unrelated');
  let boards = [board('first', [original, other]), board('second', [note('reference', { sharedId: 'source', x: 900, width: 600 })])];
  let files = syncWorkspaceFiles(undefined, boards);
  const untouched = files.contents.find(content => content.id === 'unrelated');
  const echo = new CardDocumentEcho();
  echo.receive(files.contents.find(content => content.id === 'source').card);
  for (const body of ['x', 'xin', '信', '信任', '信任与使用意愿']) {
    const document = blocks(body);
    echo.local(document, body);
    const previous = files;
    const edited = patchWorkspaceContent(syncWorkspaceFiles(files, boards), boards, 'source', { body, blocks: document });
    files = syncWorkspaceFiles(edited.files, edited.boards);
    boards = edited.boards;
    const canonical = files.contents.find(content => content.id === 'source');
    assert.equal(echo.receive(canonical.card), false);
    assert.strictEqual(canonical.card.blocks, document);
    assert.strictEqual(files, edited.files);
    assert.strictEqual(files.entries, previous.entries);
    assert.strictEqual(files.folders, previous.folders);
    assert.strictEqual(files.contents.find(content => content.id === 'unrelated'), untouched);
    assert.ok(canonical.variants.every(variant => variant.card.blocks === document));
    assert.ok(boards.every(item => item.cards[0].blocks === document));
    assert.equal(boards[1].cards[0].x, 900);
    assert.equal(boards[1].cards[0].width, 600);
  }
  assert.equal(original.body, 'Original');
  assert.equal(original.blocks[0].content[0].text, 'Original');
});

test('typing never serializes unrelated PDF metadata and reuses normalized immutable pairs', () => {
  const pdf = { url: 'lumior-file:synthetic', name: 'paper.pdf', pages: 20, size: 1, thumbnail: 'x'.repeat(700_000) };
  const boards = [board('research', [note('source'), note('paper', { kind: 'pdf', pdf })])];
  const files = syncWorkspaceFiles(undefined, boards);
  const canonicalPdf = files.contents.find(content => content.id === 'paper');
  for (const value of [pdf, canonicalPdf.card.pdf, canonicalPdf.variants[0].card.pdf]) {
    Object.defineProperty(value, 'toJSON', { value() { throw new Error('Unrelated PDF metadata must not be serialized during typing.'); } });
  }
  const edited = patchWorkspaceContent(syncWorkspaceFiles(files, boards), boards, 'source', { body: 'New thought', blocks: blocks('New thought') });
  assert.strictEqual(edited.files.contents.find(content => content.id === 'paper'), canonicalPdf);
  assert.strictEqual(edited.boards[0].cards[1], boards[0].cards[1]);
  assert.strictEqual(syncWorkspaceFiles(edited.files, edited.boards), edited.files);
});

test('changed committed boards invalidate the shortcut and reconcile removed or edited references', () => {
  const boards = [board('a', [note('source')]), board('b', [note('reference', { sharedId: 'source' })])];
  const files = syncWorkspaceFiles(undefined, boards);
  const edited = patchWorkspaceContent(files, boards, 'source', { body: 'Saved', blocks: blocks('Saved') });
  const nextBoards = [board('a', [{ ...edited.boards[0].cards[0], body: 'Canvas change', blocks: blocks('Canvas change') }])];
  const reconciled = syncWorkspaceFiles(edited.files, nextBoards);
  const canonical = reconciled.contents.find(content => content.id === 'source');
  assert.equal(canonical.card.body, 'Canvas change');
  assert.equal(canonical.variants.length, 1);
  assert.equal(canonical.variants[0].boardId, 'a');
  assert.ok(!reconciled.entries.some(entry => entry.boardId === 'b'));
  assert.equal(edited.files.contents.find(content => content.id === 'source').card.body, 'Saved');
});
