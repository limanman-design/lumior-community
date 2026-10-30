import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareWorkspaceContentOpen } from '../app/workspace-content-open.ts';
import { contentEntryId, markWorkspaceEntryOpened, syncWorkspaceFiles } from '../app/workspace-files.ts';

const card = (id, extra = {}) => ({ id, kind: 'note', title: id, body: 'A reading note', x: 10, y: 20, width: 360, ...extra });
const boards = [{ id: 'board', title: 'Research', cards: [card('unread'), card('recent'), card('variant', { sharedId: 'shared' })], edges: [] }];
const canvas = { page: 'canvas', boardId: 'board', readerReturnBoardId: null };
const recentTime = (files, id) => files.entries.find(entry => entry.id === contentEntryId(id))?.lastOpenedAt;
const fixture = () => markWorkspaceEntryOpened(syncWorkspaceFiles(undefined, boards), contentEntryId('recent'), 1234);

void test('expanding a canvas card neither creates a Recent record nor refreshes an existing record', () => {
  const files = fixture();
  for (const id of ['unread', 'recent']) {
    const opened = prepareWorkspaceContentOpen(files, boards, id, canvas, undefined, 9000);
    assert.equal(opened.returnBoardId, 'board');
    assert.equal(recentTime(opened.files, 'unread'), undefined);
    assert.equal(recentTime(opened.files, 'recent'), 1234);
    assert.deepEqual(opened.files.entries, files.entries);
  }
});

void test('opening related content from a canvas reader retains the source board and its Recent policy', () => {
  const first = prepareWorkspaceContentOpen(fixture(), boards, 'unread', canvas, undefined, 9000);
  const related = prepareWorkspaceContentOpen(first.files, boards, 'recent', {
    ...canvas, page: 'content:unread', readerReturnBoardId: first.returnBoardId,
  }, undefined, 10000);
  assert.equal(related.returnBoardId, 'board');
  assert.equal(recentTime(related.files, 'recent'), 1234);
  assert.equal(recentTime(related.files, 'unread'), undefined);
});

void test('Home and independent reader navigation record new files and refresh existing files', () => {
  let files = fixture();
  for (const [page, id, now] of [['boards', 'unread', 9000], ['content:unread', 'recent', 10000]]) {
    const opened = prepareWorkspaceContentOpen(files, boards, id, { ...canvas, page }, undefined, now);
    assert.equal(opened.returnBoardId, null);
    assert.equal(recentTime(opened.files, id), now);
    files = opened.files;
  }
});

void test('an explicit independent tab or Recent open leaves canvas reading and refreshes Recent', () => {
  for (const context of [canvas, { ...canvas, page: 'content:unread', readerReturnBoardId: 'board' }]) {
    const opened = prepareWorkspaceContentOpen(fixture(), boards, 'recent', context, null, 9000);
    assert.equal(opened.returnBoardId, null);
    assert.equal(recentTime(opened.files, 'recent'), 9000);
  }
});

void test('history restores the recorded reading context instead of inheriting the current page', () => {
  const files = fixture();
  const boardReader = prepareWorkspaceContentOpen(files, boards, 'recent', { ...canvas, page: 'boards' }, 'board', 9000);
  assert.equal(boardReader.returnBoardId, 'board');
  assert.equal(recentTime(boardReader.files, 'recent'), 1234);
  const independentReader = prepareWorkspaceContentOpen(files, boards, 'recent', canvas, null, 9000);
  assert.equal(independentReader.returnBoardId, null);
  assert.equal(recentTime(independentReader.files, 'recent'), 9000);
});

void test('shared canvas instance identities resolve to canonical content without creating Recent records', () => {
  const files = fixture();
  const opened = prepareWorkspaceContentOpen(files, boards, 'variant', canvas, undefined, 9000);
  assert.equal(opened.content.id, 'shared');
  assert.equal(opened.returnBoardId, 'board');
  assert.equal(recentTime(opened.files, 'shared'), undefined);
  assert.equal(prepareWorkspaceContentOpen(files, boards, 'deleted-content', canvas), null);
});
