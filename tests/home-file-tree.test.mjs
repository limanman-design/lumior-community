import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'vite';
import {
  canMoveHomeFile,
  canMoveHomeFileTransfer,
  homeFileTreeAncestors,
  homeFileTreeEntries,
  homeFileTreeKeyAction,
} from '../app/home-file-tree-model.ts';

const nodes = [
  {
    id: 'project',
    title: 'Project',
    kind: 'folder',
    children: [
      {
        id: 'nested',
        title: 'Nested',
        kind: 'folder',
        children: [
          {
            id: 'reading',
            title: 'Reading',
            kind: 'folder',
            children: [{ id: 'paper', title: 'Paper', kind: 'literature' }],
          },
          { id: 'note', title: 'Note', kind: 'notePage' },
        ],
      },
      { id: 'board', title: 'Board', kind: 'board' },
    ],
  },
  { id: 'other', title: 'Other', kind: 'folder', children: [] },
];

test('nested traversal records true ancestry and hides collapsed subtrees', () => {
  const all = homeFileTreeEntries(nodes);
  assert.deepEqual(homeFileTreeAncestors(all, 'paper'), [
    'reading',
    'nested',
    'project',
  ]);
  assert.deepEqual(
    homeFileTreeEntries(nodes, ['project']).map((entry) => entry.node.id),
    ['project', 'nested', 'board', 'other'],
  );
  assert.equal(all.find((entry) => entry.node.id === 'paper').depth, 4);
});

test('folder moves reject self, descendant, nonexistent and unchanged parents', () => {
  for (const destination of [
    'project',
    'nested',
    'reading',
    'paper',
    'missing',
  ])
    assert.equal(canMoveHomeFile(nodes, 'project', destination), false);
  assert.equal(canMoveHomeFile(nodes, 'paper', 'reading'), false);
  assert.equal(canMoveHomeFile(nodes, 'missing', 'other'), false);
  assert.equal(canMoveHomeFile(nodes, 'nested', 'other'), true);
  assert.equal(canMoveHomeFile(nodes, 'paper', null), true);
  assert.equal(canMoveHomeFile(nodes, 'project', null), false);
});

test('keyboard navigation follows visible siblings and expands before entering a folder', () => {
  const expanded = ['project'],
    visible = homeFileTreeEntries(nodes, expanded);
  assert.deepEqual(
    homeFileTreeKeyAction(visible, 'nested', 'ArrowRight', expanded),
    { toggle: { id: 'nested', expanded: true } },
  );
  assert.deepEqual(
    homeFileTreeKeyAction(visible, 'project', 'ArrowRight', expanded),
    { focusId: 'nested' },
  );
  assert.deepEqual(
    homeFileTreeKeyAction(visible, 'nested', 'ArrowDown', expanded),
    { focusId: 'board' },
  );
  assert.deepEqual(
    homeFileTreeKeyAction(visible, 'nested', 'ArrowLeft', expanded),
    { focusId: 'project' },
  );
  assert.deepEqual(
    homeFileTreeKeyAction(visible, 'project', 'ArrowLeft', expanded),
    { toggle: { id: 'project', expanded: false } },
  );
  assert.deepEqual(homeFileTreeKeyAction(visible, 'nested', 'Home', expanded), {
    focusId: 'project',
  });
  assert.deepEqual(homeFileTreeKeyAction(visible, 'nested', 'End', expanded), {
    focusId: 'other',
  });
  assert.deepEqual(homeFileTreeKeyAction(visible, 'board', 'Enter', expanded), {
    selectId: 'board',
    openId: 'board',
  });
  assert.deepEqual(
    homeFileTreeKeyAction(visible, 'nested', 'Enter', expanded),
    { selectId: 'nested' },
  );
});

test('duplicate identities and malformed cycles cannot hang the tree', () => {
  const repeated = {
    id: 'repeat',
    kind: 'folder',
    title: 'Repeat',
    children: [],
  };
  repeated.children.push(repeated);
  assert.deepEqual(
    homeFileTreeEntries([repeated, repeated]).map((entry) => entry.node.id),
    ['repeat'],
  );
});

test('external list drops need explicit registry validation and cannot bypass folder cycles', () => {
  assert.equal(
    canMoveHomeFileTransfer(nodes, 'content:external', 'other'),
    false,
  );
  assert.equal(
    canMoveHomeFileTransfer(nodes, 'content:external', 'other', () => false),
    false,
  );
  assert.equal(
    canMoveHomeFileTransfer(nodes, 'content:external', 'other', () => true),
    true,
  );
  assert.equal(
    canMoveHomeFileTransfer(nodes, 'content:external', 'paper', () => true),
    false,
  );
  assert.equal(
    canMoveHomeFileTransfer(nodes, 'project', 'reading', () => true),
    false,
  );
  assert.equal(
    canMoveHomeFileTransfer(nodes, 'content:external', null, () => true),
    true,
  );
});

test('the sidebar renders only root folders, highlights their selected descendants and keeps pinned/recent entries', async () => {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const temporary = await mkdtemp(join(root, 'tests', '.workspace-file-sidebar-'));
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
    const props = {
      nodes: [...nodes, {id:'root-paper',title:'Hidden root paper',kind:'literature'}],
      expandedIds: ['project','nested','reading'],
      selectedId: 'reading',
      pinned: [{id:'pinned',title:'Pinned paper',kind:'literature',pinned:true}],
      recent: [{id:'recent',title:'Recent note',kind:'notePage'}],
      onToggle: noop, onSelect: noop, onOpen: noop, onMove: noop,
      canMove: () => true, renderMenu: noop, onNewFolder: noop,
    };
    const html = renderToStaticMarkup(React.createElement(WorkspaceFileSidebar, props));
    for (const title of ['Project','Other','Pinned paper','Recent note'])
      assert.ok(html.includes(`title="${title}"`), title);
    for (const title of ['Nested','Reading','Paper','Note','Board','Hidden root paper'])
      assert.ok(!html.includes(`title="${title}"`), title);
    assert.doesNotMatch(html, /aria-expanded|home-file-tree-toggle|role="treeitem"/);
    assert.match(html, /data-selected="true"[^]*?aria-current="page" title="Project"/);
    assert.match(html, /title="Project"[^>]*draggable="true"/);
    assert.ok(html.includes('Project 的更多选项') || html.includes('More options for Project'));
    assert.ok(html.includes('New folder') || html.includes('新建文件夹'));
    const rootSelected = renderToStaticMarkup(React.createElement(WorkspaceFileSidebar, {...props, selectedId:'other'}));
    assert.match(rootSelected, /data-selected="true"[^]*?aria-current="page" title="Other"/);
    assert.equal(nodes[0].children[0].children[0].id, 'reading', 'Presentation cannot remove the nested data.');
  } finally { await rm(temporary, {recursive:true,force:true}); }
});
