/* oxlint-disable react/react-compiler -- SSR harness exercises tab callbacks across React state updates. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'vite';
import { updateDatabaseView } from '../app/database-model.ts';
import {
  createDatabaseCard,
  resolveDatabaseCard,
} from '../app/canvas-database.ts';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const noop = () => {};
const views = ['table', 'board', 'list', 'gallery'].map((type) => ({
  id: type,
  type,
  name: type,
}));
const database = {
  id: 'view-tabs-test',
  title: 'Tasks',
  activeViewId: 'table',
  view: views[0],
  views,
  properties: [],
  records: [],
  createdAt: '2026-10-20T00:00:00.000Z',
  updatedAt: '2026-10-20T00:00:00.000Z',
};
function elements(tree, predicate) {
  if (Array.isArray(tree))
    return tree.flatMap((child) => elements(child, predicate));
  if (!React.isValidElement(tree)) return [];
  return [
    ...(predicate(tree) ? [tree] : []),
    ...elements(tree.props.children, predicate),
  ];
}
const menu = (tree, id) => elements(tree, (element) => element.key === id)[0];
const tab = (tree, id) =>
  elements(tree, (element) => element.props.id === `database-view-${id}`)[0];

void test('database views separate switching from opening the active view menu', async (context) => {
  const temporary = await mkdtemp(join(root, 'tests', '.database-view-tabs-'));
  try {
    const entry = join(temporary, 'entry.ts');
    await writeFile(
      entry,
      [
        "export { DatabaseViewTabs, DatabaseViewSettings } from '../../app/database-view-settings.tsx';",
        "export { DatabaseRecordViews } from '../../app/database-record-views.tsx';",
        "export { galleryPreviewFile } from '../../app/database-gallery-preview.tsx';",
        "export { default as DatabasePage } from '../../app/database-page.tsx';",
        "export { CanvasDatabaseOverlay } from '../../app/canvas-database-overlay.tsx';",
      ].join('\n'),
    );
    await build({
      configFile: false,
      logLevel: 'silent',
      resolve: { alias: { '@': root } },
      build: {
        ssr: entry,
        outDir: temporary,
        emptyOutDir: false,
        minify: false,
        rolldownOptions: {
          output: { format: 'es', entryFileNames: 'view-tabs.mjs' },
        },
      },
    });
    const {
      DatabaseViewTabs,
      DatabaseViewSettings,
      DatabaseRecordViews,
      galleryPreviewFile,
      DatabasePage,
      CanvasDatabaseOverlay,
    } = await import(pathToFileURL(join(temporary, 'view-tabs.mjs')).href);
    function run(steps, onSelect) {
      let phase = 0;
      let cancelled = 0;
      let updates = 0;
      const details = {
        cancel() {
          cancelled++;
        },
      };
      function Harness() {
        const [current, setCurrent] = React.useState(database);
        const tree = DatabaseViewTabs({
          database: current,
          update(change) {
            updates++;
            setCurrent(change);
          },
          onEdit: noop,
          onRename: noop,
          onDelete: noop,
          onSelect,
        });
        steps[phase++]?.(tree, current, details);
        return tree;
      }
      renderToStaticMarkup(React.createElement(Harness));
      assert.equal(phase, steps.length);
      return { cancelled, updates };
    }
    await context.test(
      'first activation switches only; second activation opens the menu',
      () => {
        const result = run([
          (tree, _current, details) =>
            menu(tree, 'board').props.onOpenChange(true, details),
          (tree, current, details) => {
            assert.equal(current.activeViewId, 'board');
            assert.equal(tab(tree, 'board').props['aria-selected'], true);
            assert.equal(menu(tree, 'board').props.open, false);
            menu(tree, 'board').props.onOpenChange(true, details);
          },
          (tree) => assert.equal(menu(tree, 'board').props.open, true),
        ]);
        assert.equal(result.cancelled, 1);
      },
    );
    await context.test(
      'switching away from an open menu closes it without opening another',
      () => {
        run([
          (tree, _current, details) =>
            menu(tree, 'table').props.onOpenChange(true, details),
          (tree, _current, details) => {
            assert.equal(menu(tree, 'table').props.open, true);
            menu(tree, 'gallery').props.onOpenChange(true, details);
          },
          (tree, current) => {
            assert.equal(current.activeViewId, 'gallery');
            assert.equal(menu(tree, 'table').props.open, false);
            assert.equal(menu(tree, 'gallery').props.open, false);
          },
        ]);
      },
    );
    await context.test(
      'keyboard tab navigation selects the view without opening a menu',
      () => {
        run([
          (tree) =>
            tab(tree, 'table').props.onKeyDown({
              key: 'ArrowRight',
              preventDefault: noop,
              stopPropagation: noop,
            }),
          (tree, current) => {
            assert.equal(current.activeViewId, 'board');
            assert.equal(menu(tree, 'board').props.open, false);
            assert.equal(tab(tree, 'board').props.tabIndex, 0);
          },
        ]);
      },
    );
    await context.test(
      'a blocked selection never opens the target menu',
      () => {
        const result = run(
          [
            (tree, _current, details) =>
              menu(tree, 'board').props.onOpenChange(true, details),
          ],
          () => false,
        );
        assert.equal(result.cancelled, 1);
        assert.equal(result.updates, 0);
      },
    );
    await context.test(
      'gallery creation works alongside existing cards and in an empty gallery',
      () => {
        for (const records of [
          [],
          [
            {
              id: 'record',
              title: 'Research',
              values: {},
              createdAt: database.createdAt,
              updatedAt: database.updatedAt,
            },
          ],
        ]) {
          let tree;
          let created = 0;
          const opened = [];
          function Harness() {
            tree = DatabaseRecordViews({
              database: { ...database, view: views[3] },
              records,
              onNew: () => created++,
              onOpen: (id) => opened.push(id),
              onMove: noop,
            });
            return tree;
          }
          renderToStaticMarkup(React.createElement(Harness));
          const create = elements(
            tree,
            (element) => element.props.className === 'database-gallery-new',
          );
          assert.equal(create.length, 1);
          create[0].props.onClick();
          assert.equal(created, 1);
          if (records.length) {
            elements(
              tree,
              (element) => element.props.className === 'database-record-card',
            )[0].props.onCardClick(records[0]);
            assert.deepEqual(opened, ['record']);
          }
        }
      },
    );

    const image = {
      name: 'Cover.jpg',
      url: 'blob:cover',
      type: 'image/jpeg',
      size: 100,
    };
    const document = {
      name: 'Notes.pdf',
      url: 'blob:notes',
      type: 'application/pdf',
      size: 200,
    };
    const video = {
      name: 'Clip.mp4',
      url: 'blob:clip',
      type: 'video/mp4',
      size: 300,
    };
    const cover = { id: 'cover', name: 'Cover', type: 'files' };
    const galleryDatabase = {
      ...database,
      activeViewId: 'gallery',
      view: {
        ...views[3],
        visiblePropertyIds: [],
        cardPreview: { type: 'media', propertyId: 'cover' },
      },
      properties: [cover, { id: 'notes', name: 'Notes', type: 'text' }],
    };
    await context.test(
      'media previews select viewable attachments and handle empty or non-media fields',
      () => {
        assert.equal(galleryPreviewFile([document, image]), image);
        assert.equal(galleryPreviewFile([video, image]), video);
        assert.equal(galleryPreviewFile([document]), document);
        for (const value of [undefined, null, '', [], ['choice'], 42]) {
          assert.equal(galleryPreviewFile(value), undefined);
        }
      },
    );
    await context.test(
      'gallery renders the selected hidden field above the title and disables previews for None and other layouts',
      () => {
        const record = {
          id: 'media-record',
          title: 'Artwork',
          values: { cover: [image] },
          createdAt: database.createdAt,
          updatedAt: database.updatedAt,
        };
        const render = (view, values = record.values) =>
          renderToStaticMarkup(
            React.createElement(DatabaseRecordViews, {
              database: { ...galleryDatabase, view },
              records: [{ ...record, values }],
              onNew: noop,
              onOpen: noop,
              onMove: noop,
            }),
          );
        const markup = render(galleryDatabase.view);
        assert.match(markup, /src="blob:cover"/);
        assert.match(markup, /data-fit-media="true"/);
        assert.match(
          render({ ...galleryDatabase.view, fitMedia: false }),
          /data-fit-media="false"/,
        );
        assert.ok(
          markup.indexOf('database-gallery-preview') <
            markup.indexOf('Artwork'),
        );
        assert.match(render(galleryDatabase.view, {}), /No media/);
        assert.match(
          render(galleryDatabase.view, { cover: [video] }),
          /<video[^>]+src="blob:clip"/,
        );
        assert.match(
          render(galleryDatabase.view, { cover: [document] }),
          /Notes.pdf/,
        );
        for (const view of [
          { ...galleryDatabase.view, cardPreview: { type: 'none' } },
          { ...galleryDatabase.view, type: 'board' },
          { ...galleryDatabase.view, type: 'list' },
          {
            ...galleryDatabase.view,
            cardPreview: { type: 'media', propertyId: 'notes' },
          },
        ]) {
          assert.doesNotMatch(render(view), /database-gallery-preview/);
        }
      },
    );
    await context.test(
      'gallery preview settings navigate None → media fields and persist the selected field',
      () => {
        const row = (tree, label) => {
          const found = elements(
            tree,
            (element) =>
              element.type === 'button' &&
              elements(
                element.props.children,
                (child) =>
                  child.type === 'span' && child.props.children === label,
              ).length,
          );
          assert.equal(found.length, 1, `Expected setting ${label}`);
          return found[0];
        };
        const steps = [
          (tree) => row(tree, 'Card preview').props.onClick(),
          (tree) => row(tree, 'Media').props.onClick(),
          (tree) => {
            assert.equal(
              elements(tree, (element) => element.key === 'notes').length,
              0,
            );
            row(tree, 'Cover').props.onClick();
          },
          (tree, current, section) => {
            assert.equal(section, 'preview');
            assert.equal(current.view.cardPreview.propertyId, 'cover');
            row(tree, 'None').props.onClick();
          },
          (tree, current) => {
            assert.equal(current.view.cardPreview.type, 'none');
            assert.equal(row(tree, 'None').props['aria-pressed'], true);
            elements(
              tree,
              (element) => element.props['aria-label'] === 'Back',
            )[0].props.onClick();
          },
          (tree, _current, section) => {
            assert.equal(section, 'layout');
            const toggle = row(tree, 'Fit media');
            assert.equal(toggle.props.role, 'switch');
            assert.equal(toggle.props['aria-checked'], true);
            toggle.props.onClick();
          },
          (tree, current) => {
            assert.equal(current.view.fitMedia, false);
            assert.equal(row(tree, 'Fit media').props['aria-checked'], false);
            assert.equal(current.view.cardPreview.type, 'none');
            row(tree, 'Card preview');
          },
        ];
        let step = 0;
        function Harness() {
          const [current, setCurrent] = React.useState({
            ...galleryDatabase,
            view: { ...galleryDatabase.view, cardPreview: { type: 'none' } },
          });
          const [section, setSection] = React.useState('layout');
          const tree = DatabaseViewSettings({
            database: current,
            update: setCurrent,
            section,
            onSection: setSection,
            onClose: noop,
            onEditProperty: noop,
            onAddProperty: noop,
          });
          steps[step++]?.(tree, current, section);
          return tree;
        }
        renderToStaticMarkup(React.createElement(Harness));
        assert.equal(step, steps.length);
      },
    );
    await context.test(
      'the actual canvas overlay uses the linked view and writes its preview settings back without changing the main selected view',
      () => {
        const source = {
          ...galleryDatabase,
          view: views[0],
          activeViewId: views[0].id,
          views: views.map((view) =>
            view.id === 'gallery' ? galleryDatabase.view : view,
          ),
        };
        const linked = createDatabaseCard(source, { x: 10, y: 20 }, 'gallery');
        const steps = [
          (tree) =>
            elements(
              tree,
              (element) => element.type === DatabaseViewTabs,
            )[0].props.onEdit(),
          (tree) => {
            const settings = elements(
              tree,
              (element) => element.type === DatabaseViewSettings,
            )[0];
            assert.equal(settings.props.database.activeViewId, 'gallery');
            settings.props.update((current) =>
              updateDatabaseView(current, 'gallery', { fitMedia: false }),
            );
          },
          (tree, current) => {
            assert.equal(current.activeViewId, 'table');
            assert.equal(current.view.fitMedia, undefined);
            assert.equal(
              resolveDatabaseCard(linked, [current]).view.fitMedia,
              false,
            );
            const settings = elements(
              tree,
              (element) => element.type === DatabaseViewSettings,
            )[0];
            assert.equal(settings.props.database.view.fitMedia, false);
            settings.props.update((db) =>
              updateDatabaseView(db, 'gallery', {
                cardPreview: { type: 'none' },
              }),
            );
          },
          (tree, current) => {
            assert.equal(current.activeViewId, 'table');
            assert.equal(
              resolveDatabaseCard(linked, [current]).view.cardPreview.type,
              'none',
            );
            const settings = elements(
              tree,
              (element) => element.type === DatabaseViewSettings,
            )[0];
            settings.props.update((db) =>
              updateDatabaseView(db, 'gallery', {
                cardPreview: { type: 'media', propertyId: 'cover' },
                fitMedia: true,
              }),
            );
          },
          (_tree, current) => {
            assert.equal(current.activeViewId, 'table');
            const resolved = resolveDatabaseCard(linked, [current]);
            assert.equal(resolved.view.fitMedia, true);
            assert.equal(resolved.view.cardPreview.propertyId, 'cover');
            assert.deepEqual(linked.databaseRef, {
              databaseId: current.id,
              viewId: 'gallery',
            });
          },
        ];
        let step = 0;
        function Harness() {
          const [current, setCurrent] = React.useState(source);
          const overlay = CanvasDatabaseOverlay({
            database: current,
            initialViewId: 'gallery',
            saveStatus: 'saved',
            onUpdate: (_id, change) => setCurrent(change),
            onUpload: async () => {},
            onClose: noop,
          });
          const page = elements(
            overlay,
            (element) => element.type === DatabasePage,
          )[0];
          assert.equal(page.props.isolateViewSelection, true);
          const tree = DatabasePage(page.props);
          steps[step++]?.(tree, current);
          return tree;
        }
        renderToStaticMarkup(React.createElement(Harness));
        assert.equal(step, steps.length);
      },
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
