import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDatabase,
  newDatabaseRecord,
  databaseViews,
  activeDatabaseView,
  selectDatabaseView,
  addDatabaseView,
  updateDatabaseView,
  updateActiveDatabaseView,
  removeDatabaseView,
  databaseRecords,
  databaseBoardGroups,
  removeDatabaseProperty,
  convertDatabaseProperty,
  duplicateDatabase,
  validDatabases,
} from '../app/database-model.ts';
import { readWorkspace } from '../app/workspace-store.ts';
import {
  createWorkspaceBackup,
  readWorkspaceBackup,
  mergeRestoredWorkspace,
} from '../app/workspace-backup.ts';
const time = '2026-10-16T08:00:00.000Z';
function fixture() {
  const db = createDatabase('Tasks', 'zh', time);
  db.properties.push({
    id: 'stage',
    name: '阶段',
    type: 'select',
    options: [
      { id: 'research', name: '研究', color: 'blue' },
      { id: 'write', name: '写作', color: 'green' },
    ],
  });
  db.records = [
    {
      ...newDatabaseRecord(db, time),
      title: 'Later',
      values: { status: 'todo', stage: 'write', date: '2026-11-01' },
    },
    {
      ...newDatabaseRecord(db, time),
      title: 'Earlier',
      values: { status: 'done', stage: 'research', date: '2026-10-20' },
    },
  ];
  return db;
}
const workspace = (db) => ({
  version: 1,
  boards: [{ id: 'board', title: 'Knowledge', cards: [], edges: [] }],
  deletedBoards: [],
  activeId: 'board',
  nextUntitledIndex: 1,
  databases: [db],
  activeDatabaseId: db.id,
});
void test('create and duplicate views accept stable caller-owned identities without changing source data', () => {
  const db = fixture();
  const original = structuredClone(db);
  const added = addDatabaseView(
    db,
    'gallery',
    'zh',
    undefined,
    () => 'chosen-gallery',
  );
  assert.equal(added.activeViewId, 'chosen-gallery');
  assert.equal(activeDatabaseView(added).type, 'gallery');
  const copied = addDatabaseView(
    added,
    'gallery',
    'zh',
    'chosen-gallery',
    () => 'chosen-copy',
  );
  assert.equal(copied.activeViewId, 'chosen-copy');
  assert.equal(activeDatabaseView(copied).type, 'gallery');
  assert.equal(copied.records, db.records);
  assert.deepEqual(db, original);
  assert.ok(validDatabases([copied]));
});
void test('legacy view migration is deterministic and preserves old layout, sort, board grouping and records', () => {
  const db = fixture();
  db.view = {
    type: 'list',
    sort: { propertyId: 'date', direction: 'asc' },
    groupBy: 'stage',
  };
  const before = structuredClone(db),
    views = databaseViews(db, 'zh');
  assert.deepEqual(
    views.map((v) => v.type),
    ['table', 'board', 'list'],
  );
  assert.deepEqual(views, databaseViews(db, 'zh'));
  assert.deepEqual(db, before);
  assert.equal(activeDatabaseView(db).type, 'list');
  assert.equal(activeDatabaseView(db).groupBy, null);
  const board = selectDatabaseView(db, views[1].id, 'zh');
  assert.equal(board.view.groupBy, 'stage');
  assert.equal(board.records, db.records);
  assert.equal(board.updatedAt, time);
  assert.ok(validDatabases([board]));
  assert.deepEqual(
    readWorkspace(JSON.stringify(workspace(board))).databases[0],
    JSON.parse(JSON.stringify(board)),
  );
  assert.deepEqual(
    databaseViews(createDatabase('New', 'zh'), 'zh').map((v) => v.name),
    ['表格', '看板'],
  );
});
void test('multiple same-type views independently persist grouping, sort, visibility and names', () => {
  let db = fixture();
  const original = db.records;
  const table = databaseViews(db)[0].id;
  db = selectDatabaseView(db, table);
  db = updateActiveDatabaseView(db, {
    sort: { propertyId: 'date', direction: 'asc' },
    visiblePropertyIds: ['date'],
  });
  db = addDatabaseView(db, 'board', 'zh');
  const board = activeDatabaseView(db).id;
  db = updateDatabaseView(db, board, {
    name: '按阶段',
    groupBy: 'stage',
    sort: { propertyId: 'title', direction: 'asc' },
    visiblePropertyIds: ['status'],
  });
  assert.equal(databaseBoardGroups(db).property.id, 'stage');
  db = selectDatabaseView(db, table);
  assert.deepEqual(db.view.visiblePropertyIds, ['date']);
  assert.equal(db.view.sort.propertyId, 'date');
  assert.deepEqual(
    databaseRecords(db).map((r) => r.title),
    ['Earlier', 'Later'],
  );
  db = selectDatabaseView(db, board);
  assert.equal(activeDatabaseView(db).name, '按阶段');
  assert.equal(db.view.sort.propertyId, 'title');
  assert.equal(db.records, original);
  assert.equal(db.updatedAt, time);
  assert.ok(validDatabases([db]));
});
void test('duplicate view clones settings, shares record identities, and deleting views never deletes data or the last view', () => {
  let db = fixture();
  db = addDatabaseView(db, 'board');
  const source = activeDatabaseView(db).id;
  db = updateActiveDatabaseView(db, {
    groupBy: 'stage',
    visiblePropertyIds: ['date'],
    sort: { propertyId: 'date', direction: 'asc' },
  });
  db = addDatabaseView(db, 'board', 'en', source);
  const copy = activeDatabaseView(db).id;
  assert.notEqual(source, copy);
  assert.equal(db.records.length, 2);
  db = updateActiveDatabaseView(db, {
    visiblePropertyIds: [],
    groupBy: 'status',
  });
  db = selectDatabaseView(db, source);
  assert.deepEqual(db.view.visiblePropertyIds, ['date']);
  assert.equal(db.view.groupBy, 'stage');
  const records = db.records;
  for (const view of databaseViews(db)) db = removeDatabaseView(db, view.id);
  assert.equal(databaseViews(db).length, 1);
  assert.equal(db.records, records);
  assert.ok(validDatabases([db]));
  assert.equal(removeDatabaseView(db, activeDatabaseView(db).id), db);
});
void test('field conversion/deletion reconciles settings in every view', () => {
  let db = fixture();
  db = addDatabaseView(db, 'board');
  db = updateActiveDatabaseView(db, {
    groupBy: 'stage',
    sort: { propertyId: 'stage', direction: 'asc' },
    visiblePropertyIds: ['stage', 'date'],
  });
  db = addDatabaseView(db, 'table');
  db = updateActiveDatabaseView(db, {
    groupBy: 'stage',
    visiblePropertyIds: ['stage'],
  });
  const converted = convertDatabaseProperty(db, {
    id: 'stage',
    name: 'Stage',
    type: 'text',
  }).database;
  assert.ok(databaseViews(converted).every((v) => v.groupBy !== 'stage'));
  assert.ok(validDatabases([converted]));
  db = removeDatabaseProperty(db, 'stage');
  assert.ok(
    databaseViews(db).every(
      (v) =>
        v.groupBy !== 'stage' &&
        v.sort?.propertyId !== 'stage' &&
        !v.visiblePropertyIds?.includes('stage'),
    ),
  );
  assert.ok(validDatabases([db]));
  assert.equal(db.records.length, 2);
});
void test('invalid saved-view metadata is rejected instead of silently losing views or data', () => {
  const db = addDatabaseView(fixture(), 'table');
  for (const mutate of [
    (x) => (x.views = []),
    (x) => (x.activeViewId = 'missing'),
    (x) => x.views.push(x.views[0]),
    (x) => (x.views[0].type = 'invalid'),
    (x) => (x.views[0].name = ' '),
    (x) => (x.views[0].sort = { propertyId: 'gone', direction: 'asc' }),
    (x) => (x.views[0].groupBy = 'date'),
    (x) => (x.views[0].visiblePropertyIds = ['missing']),
    (x) => (x.views[0].visiblePropertyIds = ['date', 'date']),
    (x) => (x.views[0].cardPreview = { type: 'unknown' }),
    (x) => (x.views[0].cardPreview = { type: 'media', propertyId: 'missing' }),
    (x) => (x.view.cardPreview = { type: 'media', propertyId: 'date' }),
    (x) => (x.view.cardPreview = { type: 'media' }),
    (x) => (x.view.fitMedia = 'false'),
    (x) => (x.views[0].fitMedia = null),
  ]) {
    const next = structuredClone(db);
    mutate(next);
    assert.equal(validDatabases([next]), false);
    assert.equal(readWorkspace(JSON.stringify(workspace(next))), null);
  }
});
void test('gallery preview belongs to its view, survives duplication, and is cleared when the media field is removed or converted', () => {
  let db = fixture();
  const cover = { id: 'cover', name: 'Cover', type: 'files' };
  db.properties.push(cover);
  const original = activeDatabaseView(db).id;
  db = addDatabaseView(db, 'gallery');
  const gallery = activeDatabaseView(db).id;
  const preview = { type: 'media', propertyId: 'cover' };
  db = updateActiveDatabaseView(db, { cardPreview: preview, fitMedia: false });
  db = addDatabaseView(db, 'gallery', 'en', gallery);
  const copy = activeDatabaseView(db).id;
  assert.deepEqual(db.view.cardPreview, preview);
  assert.equal(db.view.fitMedia, false);
  db = updateActiveDatabaseView(db, {
    cardPreview: { type: 'none' },
    fitMedia: true,
  });
  assert.deepEqual(selectDatabaseView(db, gallery).view.cardPreview, preview);
  assert.equal(selectDatabaseView(db, original).view.cardPreview, undefined);
  assert.equal(selectDatabaseView(db, original).view.fitMedia, undefined);
  assert.equal(selectDatabaseView(db, gallery).view.fitMedia, false);
  assert.equal(selectDatabaseView(db, copy).view.fitMedia, true);
  assert.equal(selectDatabaseView(db, copy).view.cardPreview.type, 'none');
  db = selectDatabaseView(db, gallery);
  // Layout switching retains the preference, while rendering applies it only to galleries.
  db = updateActiveDatabaseView(db, { type: 'list' });
  assert.deepEqual(db.view.cardPreview, preview);
  db = updateActiveDatabaseView(db, { type: 'gallery' });
  assert.ok(validDatabases([db]));
  assert.deepEqual(
    convertDatabaseProperty(db, { ...cover, name: 'Artwork' }).database.view
      .cardPreview,
    preview,
  );
  for (const next of [
    removeDatabaseProperty(db, 'cover'),
    convertDatabaseProperty(db, { ...cover, type: 'text' }).database,
  ]) {
    assert.equal(next.view.cardPreview.type, 'none');
    assert.ok(
      databaseViews(next).every((view) => view.cardPreview?.type !== 'media'),
    );
    assert.ok(validDatabases([next]));
  }
});
void test('saved views round-trip through backup and receive independent IDs when duplicating/restoring', async () => {
  let db = addDatabaseView(fixture(), 'board', 'zh');
  db.properties.push({ id: 'cover', name: 'Cover', type: 'files' });
  db = updateActiveDatabaseView(db, {
    groupBy: 'stage',
    visiblePropertyIds: ['date'],
    cardPreview: { type: 'media', propertyId: 'cover' },
    fitMedia: false,
  });
  const blob = await createWorkspaceBackup(
    workspace(db),
    {
      getFile: async () => undefined,
      fetch: async () => {
        throw Error('no remote assets');
      },
    },
    () => {},
  );
  const backup = await readWorkspaceBackup(blob, () => {});
  assert.deepEqual(
    backup.snapshot.databases[0],
    JSON.parse(JSON.stringify(db)),
  );
  const merged = mergeRestoredWorkspace(workspace(db), backup.snapshot);
  const copy = merged.databases[1];
  assert.ok(
    databaseViews(copy).every(
      (v) => !databaseViews(db).some((old) => old.id === v.id),
    ),
  );
  assert.equal(copy.records.length, db.records.length);
  assert.equal(copy.view.groupBy, 'stage');
  assert.ok(validDatabases([copy]));
  const direct = duplicateDatabase(db, 'Copy');
  assert.ok(direct.views.some((v) => v.id === direct.activeViewId));
  assert.deepEqual(direct.view, db.view);
  assert.equal(merged.boards.flatMap((b) => b.cards).length, 0);
});
