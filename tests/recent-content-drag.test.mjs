import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'vite';
import {
  canDragRecentContent,
  prepareRecentContentCard,
  readRecentContentDrag,
  recentContentDragType,
  writeRecentContentDrag,
} from '../app/recent-content-drag.ts';
import {
  canMoveHomeFileTransfer,
  homeFileDragType,
} from '../app/home-file-tree-model.ts';
import { addWorkspaceContent, patchWorkspaceContent } from '../app/workspace-files.ts';

function transfer() {
  const values = new Map();
  return {
    effectAllowed: 'uninitialized',
    get types() { return [...values.keys()]; },
    setData: (type, value) => values.set(type, value),
    getData: type => values.get(type) || '',
  };
}

void test('Recent content carries its entry identity for a canvas copy and retains folder moves', () => {
  for (const kind of ['literature', 'notePage', 'image', 'video']) {
    const source = { id: `content:${kind}`, title: kind, kind };
    const data = transfer();
    assert.equal(writeRecentContentDrag(data, source), true);
    assert.equal(data.effectAllowed, 'copyMove');
    assert.equal(readRecentContentDrag(data), source.id);
    assert.equal(data.getData(homeFileDragType), source.id);
    const folders = [{ id: 'folder:destination', title: 'Destination', kind: 'folder', children: [] }];
    assert.equal(canMoveHomeFileTransfer(folders, data.getData(homeFileDragType), 'folder:destination', id => id === source.id), true);
    assert.deepEqual(source, { id: `content:${kind}`, title: kind, kind }, 'Starting a drag does not alter the source.');
  }
});

void test('boards, folders and malformed identities never become Recent canvas sources', () => {
  for (const source of [
    { id: 'board:a', kind: 'board', title: 'Board' },
    { id: 'content:a', kind: 'board', title: 'Board with wrong identity' },
    { id: 'folder:a', kind: 'folder', title: 'Folder', children: [] },
    { id: 'content:', kind: 'notePage', title: 'Empty identity' },
    { id: 'wrong-prefix', kind: 'image', title: 'Wrong identity' },
    { id: 'content:' + 'a'.repeat(505), kind: 'video', title: 'Long identity' },
  ]) {
    const data = transfer();
    assert.equal(canDragRecentContent(source), false);
    assert.equal(writeRecentContentDrag(data, source), false);
    assert.deepEqual(data.types, []);
  }
});

void test('canvas reads require the Recent marker and matching valid identities', () => {
  const data = transfer();
  data.setData(homeFileDragType, 'content:note');
  assert.equal(readRecentContentDrag(data), null, 'Home/file-tree moves alone are not canvas copies.');
  for (const payload of ['board:note', 'folder:note', 'content:', 'content:' + 'a'.repeat(505)]) {
    data.setData(recentContentDragType, payload);
    data.setData(homeFileDragType, payload);
    assert.equal(readRecentContentDrag(data), null);
  }
  data.setData(recentContentDragType, 'content:note');
  data.setData(homeFileDragType, 'content:other');
  assert.equal(readRecentContentDrag(data), null);
  data.setData(homeFileDragType, 'content:note');
  assert.equal(readRecentContentDrag(data), 'content:note');
});

const originalCard = () => ({
  id: 'original', kind: 'note', contentRole: 'notePage', title: 'Research',
  body: 'Source body', blocks: [{ id: 'p', type: 'paragraph', content: 'Source body', children: [] }],
  x: 10, y: 20, width: 420, height: 500,
});
const filesFixture = () => addWorkspaceContent({ version: 1, entries: [], contents: [], folders: [] }, originalCard());

void test('dropping Recent content creates a fresh shared instance at the drop point without altering the file or its recency', () => {
  const files = filesFixture();
  files.entries[0] = { ...files.entries[0], folderId: 'research-folder', lastOpenedAt: 1000, pinnedAt: 500 };
  const before = structuredClone(files);
  const added = prepareRecentContentCard(files, 'content:original', { x: 600, y: -200 }, 'new-instance');
  assert.ok(added);
  assert.equal(added.id, 'new-instance');
  assert.equal(added.sharedId, 'original');
  assert.deepEqual({ x: added.x, y: added.y }, { x: 600, y: -200 });
  assert.equal(added.width, files.contents[0].card.width);
  assert.deepEqual(added.blocks, files.contents[0].card.blocks);
  assert.notEqual(added.blocks, files.contents[0].card.blocks, 'The new instance owns a cloned document snapshot.');
  assert.deepEqual(files, before, 'Dragging preserves original content, folder, pinned state and Recent ordering.');
});

void test('Recent drop instances share future body and media edits with the original file and other boards', () => {
  const files = filesFixture();
  const first = prepareRecentContentCard(files, 'content:original', { x: 200, y: 300 }, 'first-instance');
  const second = prepareRecentContentCard(files, 'content:original', { x: 1000, y: 2000 }, 'second-instance');
  const boards = [
    { id: 'one', title: 'One', cards: [first], edges: [] },
    { id: 'two', title: 'Two', cards: [second], edges: [] },
  ];
  const blocks = [{ id: 'image', type: 'image', props: { url: 'lumior-file:figure', name: 'figure.png' } }];
  const changed = patchWorkspaceContent(files, boards, 'original', { body: 'Changed body', blocks });
  assert.equal(changed.files.contents[0].card.body, 'Changed body');
  assert.deepEqual(changed.files.contents[0].card.blocks, blocks);
  for (const [index, board] of changed.boards.entries()) {
    assert.equal(board.cards[0].body, 'Changed body');
    assert.deepEqual(board.cards[0].blocks, blocks);
    for (const key of ['id', 'sharedId', 'x', 'y', 'width', 'height'])
      assert.equal(board.cards[0][key], boards[index].cards[0][key], `${key} remains local`);
  }
  assert.equal(files.contents[0].card.body, 'Source body', 'The source undo snapshot remains intact.');
});

void test('Recent card preparation rejects board entries, stale content, database links and invalid drops', () => {
  const files = filesFixture();
  files.entries.push({ id: 'board:one', kind: 'board', boardId: 'one', folderId: null });
  files.entries.push({ id: 'content:stale', kind: 'content', contentId: 'missing', folderId: null });
  files.entries.push({ id: 'content:wrong-kind', kind: 'board', boardId: 'one', folderId: null });
  files.entries.push({ id: 'content:database', kind: 'content', contentId: 'database', folderId: null });
  files.contents.push({ id: 'database', role: 'note', card: { ...originalCard(), id: 'database', kind: 'database' } });
  for (const id of ['board:one', 'folder:one', 'content:stale', 'content:wrong-kind', 'content:database', 'content:missing'])
    assert.equal(prepareRecentContentCard(files, id, { x: 1, y: 2 }, 'new'), null, id);
  assert.equal(prepareRecentContentCard(files, 'content:original', { x: NaN, y: 2 }, 'new'), null);
  assert.equal(prepareRecentContentCard(files, 'content:original', { x: 1, y: 2 }, ''), null);
});

void test('the sidebar exposes drag only for Recent content while boards and Pinned stay navigation rows', async () => {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const temporary = await mkdtemp(join(root, 'tests', '.recent-content-sidebar-'));
  try {
    await build({
      configFile: false,
      logLevel: 'silent',
      resolve: { alias: { '@': root } },
      build: {
        ssr: join(root, 'app', 'workspace-file-sidebar.tsx'),
        outDir: temporary,
        emptyOutDir: false,
        minify: false,
        rolldownOptions: { output: { format: 'es', entryFileNames: 'sidebar.mjs' } },
      },
    });
    const { WorkspaceFileSidebar } = await import(pathToFileURL(join(temporary, 'sidebar.mjs')).href);
    const noop = () => {};
    const recent = [
      ...['literature', 'notePage', 'image', 'video'].map(kind => ({ id: `content:${kind}`, title: `Recent ${kind}`, kind })),
      { id: 'board:recent', title: 'Recent board', kind: 'board' },
    ];
    const html = renderToStaticMarkup(React.createElement(WorkspaceFileSidebar, {
      nodes: [], expandedIds: [], selectedId: null,
      pinned: [{ id: 'content:pinned', title: 'Pinned image', kind: 'image' }],
      recent, onToggle: noop, onSelect: noop, onOpen: noop,
    }));
    for (const item of recent) {
      assert.match(html, new RegExp(`title="${item.title}"[^>]*draggable="${item.kind !== 'board'}"`));
    }
    assert.match(html, /title="Pinned image"[^>]*draggable="false"/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
