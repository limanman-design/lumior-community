import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'vite';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

void test('linked database preview renders the source view without editable cells', async (context) => {
  const temporary = await mkdtemp(
    join(root, 'tests', '.canvas-database-card-'),
  );
  try {
    await build({
      configFile: false,
      logLevel: 'silent',
      resolve: { alias: { '@': root } },
      build: {
        ssr: join(root, 'app', 'canvas-database-card.tsx'),
        outDir: temporary,
        emptyOutDir: false,
        minify: false,
        rolldownOptions: {
          output: { format: 'es', entryFileNames: 'database-card.mjs' },
        },
      },
    });
    const { CanvasDatabaseCard } = await import(
      pathToFileURL(join(temporary, 'database-card.mjs')).href
    );
    const firstView = { id: 'all', name: 'All literature', type: 'table' };
    const chosenView = {
      id: 'reading',
      name: 'Reading queue',
      type: 'gallery',
      visiblePropertyIds: ['author', 'year', 'private'],
      sorts: [{ propertyId: 'year', direction: 'desc' }],
      filter: {
        id: 'reading-filter',
        conjunction: 'and',
        rules: [
          { id: 'year-rule', propertyId: 'year', operator: 'gte', value: 2022 },
        ],
      },
    };
    const database = {
      id: 'literature',
      title: 'Renamed literature collection',
      createdAt: '2026-10-19T00:00:00.000Z',
      updatedAt: '2026-10-19T00:00:00.000Z',
      view: firstView,
      activeViewId: firstView.id,
      views: [firstView, chosenView],
      properties: [
        { id: 'author', name: 'Author', type: 'text' },
        { id: 'year', name: 'Publication year', type: 'number' },
        { id: 'private', name: 'Other notes', type: 'text' },
      ],
      records: Array.from({ length: 7 }, (_, index) => ({
        id: `paper-${index}`,
        title: `Paper ${index}`,
        createdAt: '2026-10-19T00:00:00.000Z',
        updatedAt: '2026-10-19T00:00:00.000Z',
        values: {
          author: `Author ${index}`,
          year: 2020 + index,
          private: 'SHOULD_NOT_PREVIEW_THIS_FIELD',
        },
      })),
    };
    const card = {
      id: 'linked',
      kind: 'database',
      title: 'Stale title',
      body: '',
      x: 0,
      y: 0,
      width: 480,
      height: 320,
      databaseRef: { databaseId: database.id, viewId: chosenView.id },
    };
    const render = (databases = [database], currentCard = card) =>
      renderToStaticMarkup(
        React.createElement(CanvasDatabaseCard, {
          card: currentCard,
          databases,
          onOpen() {},
        }),
      );
    await context.test(
      'live title, selected view and filtered count come from the original database',
      () => {
        const markup = render();
        assert.match(markup, /Renamed literature collection/);
        assert.doesNotMatch(markup, /Stale title/);
        assert.match(markup, /Reading queue/);
        assert.match(markup, /5 records/);
        assert.equal(database.activeViewId, 'all');
      },
    );
    await context.test(
      'only four sorted rows and two visible fields are shown, with no editor controls',
      () => {
        const markup = render();
        assert.equal((markup.match(/<tr>/g) || []).length, 5);
        assert.match(markup, /Paper 6/);
        assert.doesNotMatch(
          markup,
          /Paper 2|Paper 1|Paper 0|SHOULD_NOT_PREVIEW_THIS_FIELD/,
        );
        assert.equal((markup.match(/<th[ >]/g) || []).length, 3);
        assert.doesNotMatch(
          markup,
          /<input|<textarea|<select|contenteditable/i,
        );
        assert.match(markup, /Expand database: Renamed literature collection/);
      },
    );
    await context.test(
      'missing database remains an explicit unavailable reference',
      () => {
        const markup = render([]);
        assert.match(markup, /Database unavailable/);
        assert.doesNotMatch(markup, /<table|<button/);
      },
    );
    await context.test(
      'removed view falls back visibly, and filtered emptiness is not treated as an empty database',
      () => {
        const missingView = render([database], {
          ...card,
          databaseRef: { databaseId: database.id, viewId: 'removed' },
        });
        assert.match(missingView, /Linked view removed/);
        assert.match(missingView, /All literature/);
        const emptyView = {
          ...chosenView,
          filter: {
            id: 'none',
            conjunction: 'and',
            rules: [
              {
                id: 'none-rule',
                propertyId: 'year',
                operator: 'gt',
                value: 2100,
              },
            ],
          },
        };
        const empty = render([{ ...database, views: [firstView, emptyView] }]);
        assert.match(empty, /No records match this view/);
        assert.match(empty, /0 records/);
      },
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
