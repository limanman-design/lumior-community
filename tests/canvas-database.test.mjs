import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {
  createDatabaseCard,
  resolveDatabaseCard,
  projectDatabaseView,
} from '../app/canvas-database.ts';
import {
  createDatabase,
  addDatabaseView,
  databaseViews,
  selectDatabaseView,
} from '../app/database-model.ts';
import {
  syncWorkspaceFiles,
  projectWorkspaceFiles,
  addWorkspaceContent,
} from '../app/workspace-files.ts';
import { readWorkspace } from '../app/workspace-store.ts';
import {
  createWorkspaceBackup,
  readWorkspaceBackup,
  mergeRestoredWorkspace,
} from '../app/workspace-backup.ts';
import { aiContext } from '../app/ai-context.ts';
import { createGlobalCardSearchIndex } from '../app/global-card-search-model.ts';
import { mapMemoryAtlas } from '../app/memory-atlas-data.ts';
import { libraryInstance } from '../app/shared-cards.ts';

function fixture() {
  let database = createDatabase('研究计划', 'zh');
  database = addDatabaseView(database, 'list', 'zh');
  const views = databaseViews(database, 'zh');
  const linkedView = views[0];
  database = {
    ...database,
    records: [
      {
        id: 'r1',
        title: 'First',
        values: {},
        createdAt: database.createdAt,
        updatedAt: database.updatedAt,
      },
      {
        id: 'r2',
        title: 'Second',
        values: {},
        createdAt: database.createdAt,
        updatedAt: database.updatedAt,
      },
    ],
  };
  const card = createDatabaseCard(
    database,
    { x: 100, y: 200 },
    linkedView.id,
    () => 'db-card',
  );
  const board = { id: 'board', title: 'Thesis', cards: [card], edges: [] };
  const snapshot = {
    version: 1,
    boards: [board],
    deletedBoards: [],
    activeId: board.id,
    nextUntitledIndex: 1,
    databases: [database],
  };
  return { database, card, board, snapshot, linkedView };
}
const emptySource = {
  getFile: async () => undefined,
  fetch: async () => {
    throw new Error('No attachment requests expected');
  },
};

test('linked cards keep geometry and identities, resolve live data and selected view without changing table state', () => {
  const { database, card, linkedView } = fixture();
  const original = structuredClone(database);
  const result = resolveDatabaseCard(card, [database], 'zh');
  assert.equal(result.view.id, linkedView.id);
  assert.equal(result.records.length, 2);
  assert.deepEqual(database, original);
  assert.equal(card.body, '');
  assert.equal(Object.hasOwn(card, 'records'), false);
  assert.equal(card.x, 100);
  assert.equal(card.width, 480);
  const updated = {
    ...database,
    title: '新表名',
    records: [...database.records, { ...database.records[0], id: 'r3' }],
  };
  assert.equal(resolveDatabaseCard(card, [updated]).database.title, '新表名');
  assert.equal(resolveDatabaseCard(card, [updated]).records.length, 3);
  assert.equal(resolveDatabaseCard(card, []), null);
});

test('projection retains the active view latest snapshot when selecting another view', () => {
  const { database, linkedView } = fixture();
  const current = {
    ...database,
    view: {
      ...database.view,
      sorts: [{ propertyId: 'title', direction: 'desc' }],
    },
  };
  const projected = projectDatabaseView(current, linkedView.id, 'zh');
  const returned = selectDatabaseView(projected, database.activeViewId, 'zh');
  assert.deepEqual(returned.view.sorts, current.view.sorts);
});

test('missing table stays unresolved, missing view is explicit and falls back safely', () => {
  const { card, database } = fixture();
  assert.equal(resolveDatabaseCard(card, []), null);
  const result = resolveDatabaseCard(
    {
      ...card,
      databaseRef: { databaseId: database.id, viewId: 'removed-view' },
    },
    [database],
  );
  assert.equal(result.viewMissing, true);
  assert.equal(result.view.id, database.activeViewId);
});

test('database references never enter the knowledge registry, Home, library copy identity or AI content', () => {
  const { board, card } = fixture();
  const files = syncWorkspaceFiles(undefined, [board]);
  assert.equal(files.contents.length, 0);
  assert.deepEqual(
    projectWorkspaceFiles(files, [board]).map((item) => item.kind),
    ['board'],
  );
  assert.throws(
    () => addWorkspaceContent(files, card),
    /knowledge|whiteboards/,
  );
  assert.equal(aiContext([card], []).eligible, 0);
  assert.equal(aiContext([card], [card.id]).sources.length, 0);
  assert.equal(createGlobalCardSearchIndex([board]).length, 0);
  assert.equal(mapMemoryAtlas([board], board.id).memories.length, 0);
  const copy = libraryInstance(card, { x: 400, y: 600 }, true, 'copy');
  assert.deepEqual(copy.databaseRef, card.databaseRef);
  assert.equal(copy.sharedId, undefined);
  assert.deepEqual({ x: copy.x, y: copy.y }, { x: 400, y: 600 });
});

test('workspace refresh preserves references and rejects malformed reference identities', () => {
  const { snapshot, card } = fixture();
  assert.deepEqual(
    readWorkspace(JSON.stringify(snapshot)).boards[0].cards[0].databaseRef,
    card.databaseRef,
  );
  for (const databaseRef of [
    undefined,
    null,
    {},
    { databaseId: '' },
    { databaseId: 9 },
    { databaseId: 'ok', viewId: '' },
  ]) {
    const invalid = {
      ...snapshot,
      boards: [{ ...snapshot.boards[0], cards: [{ ...card, databaseRef }] }],
    };
    assert.equal(readWorkspace(JSON.stringify(invalid)), null);
  }
});

test('full backup and merge remap database and chosen view with card geometry intact', async () => {
  const { snapshot, card, database } = fixture();
  const prepared = await readWorkspaceBackup(
    await createWorkspaceBackup(snapshot, emptySource, () => {}),
    () => {},
  );
  assert.equal(prepared.files.length, 0);
  const restored = mergeRestoredWorkspace(snapshot, prepared.snapshot);
  const link = restored.boards[1].cards[0],
    table = restored.databases[1];
  assert.notEqual(table.id, database.id);
  assert.equal(link.databaseRef.databaseId, table.id);
  assert.notEqual(link.databaseRef.viewId, card.databaseRef.viewId);
  assert.ok(
    databaseViews(table).some((view) => view.id === link.databaseRef.viewId),
  );
  assert.deepEqual(
    { x: link.x, y: link.y, width: link.width, height: link.height },
    { x: card.x, y: card.y, width: card.width, height: card.height },
  );
  assert.equal(restored.files.contents.length, 0);
  assert.equal(resolveDatabaseCard(link, restored.databases).records.length, 2);
});

test('missing database and view references never reconnect to existing identities during restore', () => {
  const { snapshot, card, database } = fixture();
  const backup = {
    ...snapshot,
    databases: [],
    boards: [{ ...snapshot.boards[0], cards: [card, { ...card, id: 'copy' }] }],
  };
  const restored = mergeRestoredWorkspace(snapshot, backup);
  const links = restored.boards[1].cards;
  assert.equal(
    links[0].databaseRef.databaseId,
    links[1].databaseRef.databaseId,
  );
  assert.notEqual(links[0].databaseRef.databaseId, database.id);
  assert.equal(resolveDatabaseCard(links[0], restored.databases), null);
  const missingView = {
    ...snapshot,
    boards: [
      {
        ...snapshot.boards[0],
        cards: [
          {
            ...card,
            databaseRef: { databaseId: database.id, viewId: 'removed-view' },
          },
        ],
      },
    ],
  };
  const restoredView = mergeRestoredWorkspace(snapshot, missingView);
  assert.equal(
    resolveDatabaseCard(restoredView.boards[1].cards[0], restoredView.databases)
      .viewMissing,
    true,
  );
});

test('legacy table views and recycled board references restore to the same new source', async () => {
  const { snapshot, database } = fixture();
  const legacy = { ...database };
  delete legacy.views;
  delete legacy.activeViewId;
  const view = databaseViews(legacy)[0];
  const card = createDatabaseCard(
    legacy,
    { x: 1, y: 2 },
    view.id,
    () => 'legacy-link',
  );
  const now = Date.now();
  const archived = {
    ...snapshot,
    databases: [legacy],
    boards: [{ ...snapshot.boards[0], cards: [card] }],
    deletedBoards: [
      {
        board: {
          id: 'recycled',
          title: 'Recycled',
          edges: [],
          cards: [{ ...card, id: 'recycled-link' }],
        },
        deletedAt: now,
        expiresAt: now + 86400000,
      },
    ],
  };
  const prepared = await readWorkspaceBackup(
    await createWorkspaceBackup(archived, emptySource, () => {}),
    () => {},
  );
  const restored = mergeRestoredWorkspace(snapshot, prepared.snapshot);
  const activeLink = restored.boards[1].cards[0];
  const recycledLink = restored.deletedBoards[0].board.cards[0];
  assert.deepEqual(activeLink.databaseRef, recycledLink.databaseRef);
  assert.equal(activeLink.databaseRef.databaseId, restored.databases[1].id);
  assert.equal(
    resolveDatabaseCard(activeLink, restored.databases).viewMissing,
    false,
  );
});

test('archive validation rejects malformed linked cards before restoring any contents', async () => {
  const { snapshot } = fixture();
  const invalid = structuredClone(snapshot);
  invalid.boards[0].cards[0].databaseRef = {};
  await assert.rejects(
    createWorkspaceBackup(invalid, emptySource, () => {}),
    /database|多维表/,
  );
  const archive = await JSZip.loadAsync(
    await (
      await createWorkspaceBackup(snapshot, emptySource, () => {})
    ).arrayBuffer(),
  );
  const manifest = JSON.parse(
    await archive.file('manifest.json').async('string'),
  );
  manifest.workspace.boards[0].cards[0].databaseRef.databaseId = null;
  archive.file('manifest.json', JSON.stringify(manifest));
  await assert.rejects(
    readWorkspaceBackup(
      new Blob([await archive.generateAsync({ type: 'uint8array' })]),
      () => {},
    ),
  );
});
