import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'vite';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const noop = () => {};
const renderedRows = (html) =>
  [...html.matchAll(/<tr\b[^>]*aria-label="([^"]*)"/g)].map(
    (match) => match[1],
  );

void test('the actual Home list scans 100 papers without summary rows or per-row media readers', async (context) => {
  const temporary = await mkdtemp(join(root, 'tests', '.home-file-list-'));
  try {
    await build({
      configFile: false,
      logLevel: 'silent',
      build: {
        ssr: join(root, 'app', 'home-file-list.tsx'),
        outDir: temporary,
        emptyOutDir: false,
        minify: false,
        rolldownOptions: {
          output: { format: 'es', entryFileNames: 'home-list.mjs' },
        },
      },
    });
    const { HomeFileList, homeFileListKeyAction } = await import(
      pathToFileURL(join(temporary, 'home-list.mjs')).href
    );
    const papers = Array.from({ length: 100 }, (_, index) => ({
      id: `paper-${index}`,
      kind: 'literature',
      title: `Research paper ${String(index).padStart(3, '0')}`,
      authors: [`Author ${index}`],
      year: 2020 + (index % 6),
      tags: [index % 2 ? 'theory' : 'reading'],
      lastOpenedAt: index ? Date.UTC(2026, 9, 1, index % 24) : undefined,
      thumbnailUrl: '/supplied-cover.png',
    }));
    const props = {
      items: [
        ...papers,
        { id: 'board', kind: 'board', title: 'Evidence map' },
        { id: 'page', kind: 'notePage', title: 'Research plan' },
        { id: 'video', kind: 'video', title: 'Methods lecture' },
        { id: 'image', kind: 'image', title: 'Analysis diagram' },
        papers[0],
        {
          id: 'summary',
          kind: 'summary',
          title: 'SUMMARY MUST STAY IN THE LIBRARY',
        },
      ],
      query: '',
      typeFilter: 'all',
      sort: { key: 'title', direction: 'asc' },
      selectedId: 'paper-42',
      previewOpen: true,
      onQueryChange: noop,
      onTypeFilterChange: noop,
      onSortChange: noop,
      onSelect: noop,
      onOpen: noop,
      onPreviewOpenChange: noop,
    };
    const render = (patch) =>
      renderToStaticMarkup(
        React.createElement(HomeFileList, { ...props, ...patch }),
      );

    await context.test('mixed rows expose name, file type, tags and last opened while bibliography stays in the preview', () => {
      const html = render();
      const table = html.match(/<table\b[\s\S]*?<\/table>/)[0];
      assert.match(table, /aria-colcount="4"/);
      assert.equal((table.match(/<col\b/g) || []).length, 4);
      assert.equal((table.match(/<th\b/g) || []).length, 4);
      assert.match(table, />Name</);
      assert.match(table, />File type</);
      assert.match(table, /home-file-type-cell">Literature</);
      assert.match(table, /home-file-type-cell">Whiteboard</);
      assert.match(table, />Tags</);
      assert.match(table, />Last opened</);
      assert.doesNotMatch(table, /Author 42|Author \/ details|>Year</);
      for (const row of table.matchAll(/<tr\b[^>]*aria-label="[\s\S]*?<\/tr>/g))
        assert.equal((row[0].match(/<td\b/g) || []).length, 4);
      assert.match(html, /<dt>Authors<\/dt><dd>Author 42<\/dd>/);
      assert.match(html, /<dt>Publication year<\/dt><dd>2020<\/dd>/);
      const unknown = render({
        items: [{ id: 'page', kind: 'notePage', title: 'Without history', updatedAt: Date.now() }],
        selectedId: 'page',
      });
      assert.match(unknown, /home-file-tags-cell"><div><\/div>/);
      assert.match(unknown, /<time>—<\/time>/);
      assert.doesNotMatch(unknown, /<dt>Authors|<dt>Publication year/);
      const details = render({
        items: [{ id: 'video', kind: 'video', title: 'Lecture', details: [{ label: 'Duration', value: '3:45' }] }],
        selectedId: 'video',
      });
      assert.match(details, /<dt>Duration<\/dt><dd>3:45<\/dd>/);
      assert.doesNotMatch(details, /<dt>Details<\/dt>|<dt>Authors|<dt>Publication year/);
      const empty = render({ items: [], selectedId: null });
      assert.match(empty, /This folder is empty/);
      assert.equal((empty.match(/<th\b/g) || []).length, 4);
    });

    await context.test(
      'five file types count shared identities once and reject summary input',
      () => {
        const html = render();
        assert.equal(renderedRows(html).length, 104);
        assert.match(html, /104 shown/);
        assert.doesNotMatch(html, /home-file-filters|<fieldset/);
        assert.doesNotMatch(html, /SUMMARY MUST STAY IN THE LIBRARY/);
        assert.equal(
          renderedRows(render({ typeFilter: 'literature' })).length,
          104,
        );
        assert.equal(
          renderedRows(render({ typeFilter: 'notePage' })).length,
          104,
        );
      },
    );
    await context.test(
      'directory rows keep their hierarchy, folder semantics and summary exclusion',
      () => {
        const directoryRows = [
          {
            kind: 'folder',
            id: 'folder:a',
            folderId: 'a',
            title: 'Methods',
            depth: 0,
            parentId: 'root',
            expanded: true,
            hasChildren: true,
            itemCount: 2,
          },
          {
            kind: 'folder',
            id: 'folder:b',
            folderId: 'b',
            title: 'Interviews',
            depth: 1,
            parentId: 'a',
            expanded: true,
            hasChildren: true,
            itemCount: 1,
          },
          {
            kind: 'file',
            id: papers[2].id,
            item: papers[2],
            depth: 2,
            parentId: 'b',
          },
          {
            kind: 'file',
            id: papers[1].id,
            item: papers[1],
            depth: 1,
            parentId: 'a',
          },
          {
            kind: 'file',
            id: papers[0].id,
            item: papers[0],
            depth: 0,
            parentId: 'root',
          },
          {
            kind: 'file',
            id: 'summary',
            item: {
              id: 'summary',
              kind: 'summary',
              title: 'SUMMARY MUST STAY IN THE LIBRARY',
            },
            depth: 0,
            parentId: 'root',
          },
        ];
        const html = render({
          directoryRows,
          directoryScopeId: 'root',
          selectedFolderRowId: 'a',
          breadcrumbs: [
            { id: null, title: 'Home' },
            { id: 'root', title: 'Research' },
          ],
          onNavigateFolder: noop,
          onNewFolder: noop,
        });
        assert.match(html, /role="treegrid"/);
        assert.match(html, /aria-colcount="4"/);
        const folderRow = html.match(/<tr\b[^>]*aria-label="Methods · Folder"[\s\S]*?<\/tr>/)[0];
        assert.equal((folderRow.match(/<td\b/g) || []).length, 4);
        assert.doesNotMatch(folderRow, /2 files/);
        assert.match(folderRow, /home-file-type-cell">Folder</);
        assert.match(html, /aria-label="Methods · Folder"/);
        assert.match(
          html,
          /aria-level="3"[^>]*aria-selected="false"[^>]*aria-label="Research paper 002/,
        );
        assert.match(html, /3 shown/);
        assert.match(html, /2 folders/);
        assert.match(html, /Folder path/);
        assert.match(html, /Open folder/);
        assert.doesNotMatch(html, /SUMMARY MUST STAY IN THE LIBRARY/);
        assert.deepEqual(renderedRows(html), [
          'Methods · Folder',
          'Interviews · Folder',
          'Research paper 002 · Literature',
          'Research paper 001 · Literature',
          'Research paper 000 · Literature',
        ]);
        // Matching a folder can reveal descendant files whose own metadata
        // does not match the query; their preview must use the same projection.
        const folderMatch = render({
          directoryRows,
          directoryScopeId: 'root',
          query: 'Methods',
          selectedId: papers[2].id,
        });
        assert.match(folderMatch, /<h3>Research paper 002<\/h3>/);
        assert.equal((folderMatch.match(/<img\b/g) || []).length, 1);
        assert.match(
          folderMatch,
          /aria-selected="true"[^>]*aria-label="Research paper 002/,
        );
        assert.deepEqual(
          homeFileListKeyAction(directoryRows, 'folder:a', 'ArrowRight'),
          { focusId: 'folder:b' },
        );
        assert.deepEqual(
          homeFileListKeyAction(directoryRows, 'folder:a', 'ArrowLeft'),
          { toggle: { folderId: 'a', expanded: false } },
        );
        assert.deepEqual(
          homeFileListKeyAction(directoryRows, papers[2].id, 'ArrowLeft'),
          { focusId: 'folder:b' },
        );
        assert.deepEqual(
          homeFileListKeyAction(directoryRows, papers[0].id, 'ArrowLeft'),
          { parentScope: true },
        );
        assert.deepEqual(
          homeFileListKeyAction(directoryRows, 'folder:b', 'Enter'),
          { open: true },
        );
        assert.deepEqual(
          homeFileListKeyAction(
            [{ ...directoryRows[0], expanded: false }],
            'folder:a',
            'ArrowRight',
          ),
          { toggle: { folderId: 'a', expanded: true } },
        );
      },
    );
    await context.test(
      'author, year and tag searches use supplied metadata',
      () => {
        assert.deepEqual(renderedRows(render({ query: 'Author 42' })), [
          'Research paper 042 · Literature',
        ]);
        assert.equal(renderedRows(render({ query: '2023 theory' })).length, 17);
        assert.equal(
          renderedRows(render({ query: 'does-not-exist' })).length,
          0,
        );
        const html = render({
          items: [
            {
              id: 'unknown',
              kind: 'literature',
              title: 'Imported without metadata',
            },
          ],
          selectedId: 'unknown',
        });
        assert.equal(renderedRows(html).length, 1);
        assert.match(html, /Not recorded/);
      },
    );
    await context.test(
      'only the selected preview loads an image and rows never create document players',
      () => {
        const selected = render();
        assert.equal((selected.match(/<img\b/g) || []).length, 1);
        assert.equal(
          (render({ selectedId: null }).match(/<img\b/g) || []).length,
          0,
        );
        assert.equal(
          (render({ previewOpen: false }).match(/<img\b/g) || []).length,
          0,
        );
        assert.doesNotMatch(selected, /<(video|iframe|canvas|embed|object)\b/);
      },
    );
    await context.test('modified sorting exposes its own date column and puts unopened imports first', () => {
      const items = [
        { id: 'opened', kind: 'notePage', title: 'Opened earlier', updatedAt: 1000, lastOpenedAt: 9000 },
        { id: 'imported', kind: 'literature', title: 'Unopened import', updatedAt: 10000 },
        { id: 'unknown', kind: 'notePage', title: 'Without dates' },
      ];
      const html = render({ items, selectedId: 'imported', sort: { key: 'updatedAt', direction: 'desc' } });
      assert.deepEqual(renderedRows(html), ['Unopened import · Literature', 'Opened earlier · NotePage', 'Without dates · NotePage']);
      assert.match(html, />Last modified</);
      assert.match(html, /aria-label="Sort files: Last modified"/);
      assert.match(html, /dateTime="1970-01-01T00:00:10.000Z"/i);
      assert.match(html, /Created, imported or modified in Lumior/);
      const ascending = render({ items, selectedId: null, sort: { key: 'updatedAt', direction: 'asc' } });
      assert.deepEqual(renderedRows(ascending), ['Opened earlier · NotePage', 'Unopened import · Literature', 'Without dates · NotePage']);
    });

    await context.test(
      'recorded dates sort before unknown dates in either direction',
      () => {
        const items = [
          { id: 'unknown', kind: 'notePage', title: 'Unknown date' },
          {
            id: 'older',
            kind: 'notePage',
            title: 'Older opening',
            lastOpenedAt: 1000,
          },
          {
            id: 'newer',
            kind: 'notePage',
            title: 'Newer opening',
            lastOpenedAt: 2000,
          },
        ];
        assert.deepEqual(
          renderedRows(
            render({
              items,
              selectedId: null,
              sort: { key: 'lastOpenedAt', direction: 'asc' },
            }),
          ),
          [
            'Older opening · NotePage',
            'Newer opening · NotePage',
            'Unknown date · NotePage',
          ],
        );
        assert.deepEqual(
          renderedRows(
            render({
              items,
              selectedId: null,
              sort: { key: 'lastOpenedAt', direction: 'desc' },
            }),
          ),
          [
            'Newer opening · NotePage',
            'Older opening · NotePage',
            'Unknown date · NotePage',
          ],
        );
      },
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
