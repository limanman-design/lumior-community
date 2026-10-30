import assert from 'node:assert/strict';
import test from 'node:test';
import { createDatabase, newDatabaseRecord, patchDatabaseRecord, duplicateDatabase, databaseRecords, validDatabases, switchDatabaseView, databaseBoardGroups, moveDatabaseRecord } from '../app/database-model.ts';
import { readWorkspace } from '../app/workspace-store.ts';
import { createWorkspaceBackup, readWorkspaceBackup, mergeRestoredWorkspace } from '../app/workspace-backup.ts';
import { recordWorkspaceHistory, reconcileWorkspaceHistory, emptyWorkspaceHistory } from '../app/workspace-history-model.ts';
import { selectBoardTab, closeBoardTab, emptyBoardTabs } from '../app/board-tabs-model.ts';

const created = '2026-10-16T08:00:00.000Z';
const updated = '2026-10-16T09:00:00.000Z';
const workspace = { version: 1, boards: [{ id: 'board', title: 'Knowledge', cards: [], edges: [] }], deletedBoards: [], activeId: 'board', nextUntitledIndex: 1 };
test('mixed board and database tabs stay distinct and deleted databases leave navigation history', () => {
  const ids = ['board', 'database:one', 'database:two'];
  let tabs = selectBoardTab(emptyBoardTabs, 'board', ids);
  tabs = selectBoardTab(tabs, 'database:one', ids);
  tabs = selectBoardTab(tabs, 'database:two', ids);
  assert.equal(closeBoardTab(tabs, 'database:two').activeId, 'database:one');
  let history = recordWorkspaceHistory(emptyWorkspaceHistory, { page: 'canvas', boardId: 'board' }, ids);
  history = recordWorkspaceHistory(history, { page: 'database:one', boardId: 'board' }, ids);
  history = recordWorkspaceHistory(history, { page: 'database:two', boardId: 'board' }, ids);
  assert.deepEqual(reconcileWorkspaceHistory(history, ['board', 'database:two']).entries, [{ page: 'canvas', boardId: 'board' }, { page: 'database:two', boardId: null }]);
});
function fixture() {
  const database = createDatabase('Research schedule', 'en', created);
  const record = { ...newDatabaseRecord(database, created), title: 'Submit paper', values: { status: 'todo', date: '2026-10-30' } };
  return { ...database, records: [record] };
}

test('legacy workspaces remain compatible; multiple databases round-trip outside all board cards', () => {
  assert.deepEqual(readWorkspace(JSON.stringify(workspace)).boards, workspace.boards);
  const first = fixture(), second = createDatabase('Daily tasks', 'zh', created);
  const stored = readWorkspace(JSON.stringify({ ...workspace, databases: [first, second], activeDatabaseId: second.id }));
  assert.deepEqual(stored.databases, [first, second]);
  assert.equal(stored.activeDatabaseId, second.id);
  assert.deepEqual(stored.boards, workspace.boards);
  assert.equal(stored.boards.flatMap(board => board.cards).length, 0);
  assert.equal(stored.databases[1].properties[0].name, '状态');
});

test('record edits preserve creation dates and stamp content changes without mutating other records/databases', () => {
  const database = fixture(), before = structuredClone(database);
  const record = database.records[0];
  assert.equal(patchDatabaseRecord(database, record.id, { title: record.title }, updated), database);
  const next = patchDatabaseRecord(database, record.id, { title: 'Submit revised paper', values: { status: 'done' } }, updated);
  assert.equal(next.records[0].updatedAt, updated);
  assert.equal(next.records[0].createdAt, created);
  assert.equal(next.records[0].values.date, '2026-10-30');
  assert.equal(next.updatedAt, updated);
  assert.deepEqual(database, before);
  assert.ok(validDatabases([next]));
});

test('database duplication creates independent record identities and copies custom values', () => {
  const original = { ...fixture(), pinnedAt: 10 };
  const copy = duplicateDatabase(original, 'Copy', updated);
  assert.notEqual(copy.id, original.id);
  assert.notEqual(copy.records[0].id, original.records[0].id);
  assert.equal(copy.pinnedAt, undefined);
  copy.records[0].values.status = 'done';
  copy.properties[0].name = 'Changed';
  assert.equal(original.records[0].values.status, 'todo');
  assert.equal(original.properties[0].name, 'Status');
});

test('filter and numeric/date sorting keep empty values last without changing stored row order', () => {
  const database = fixture();
  database.properties.push({ id: 'rating', name: 'Rating', type: 'number' });
  database.records = [
    { ...newDatabaseRecord(database, created), title: 'Second', values: { rating: 2 } },
    { ...newDatabaseRecord(database, created), title: 'Empty', values: {} },
    { ...newDatabaseRecord(database, created), title: 'First', values: { rating: 12, status: 'done' } },
  ];
  database.view.sort = { propertyId: 'rating', direction: 'desc' };
  assert.deepEqual(databaseRecords(database).map(record => record.title), ['First', 'Second', 'Empty']);
  assert.equal(databaseRecords(database, 'done')[0].title, 'First');
  assert.equal(database.records[0].title, 'Second');
});

test('malformed database data is rejected, never silently removed on reload', () => {
  const source = fixture();
  for (const mutate of [
    database => database.records.push(database.records[0]),
    database => database.properties.push(database.properties[0]),
    database => database.records[0].values.date = '2026-02-30',
    database => database.records[0].values.status = 'missing-option',
    database => database.records[0].values.unrecognized = 'orphaned data',
    database => database.records[0].updatedAt = 'invalid',
    database => database.view.sort = { propertyId: 'removed', direction: 'asc' },
  ]) {
    const database = structuredClone(source); mutate(database);
    assert.equal(readWorkspace(JSON.stringify({ ...workspace, databases: [database] })), null);
  }
  assert.equal(validDatabases([source, source]), false);
});

test('portable backup round-trips databases; repeated restore never overwrites originals or pollutes boards', async () => {
  const first = fixture();
  first.view.type = 'board';
  first.pinnedAt = 123;
  first.properties.push({ id: 'budget', name: 'Budget', type: 'number' }, { id: 'checked', name: 'Checked', type: 'checkbox' });
  first.records[0].values.budget = 120;
  first.records[0].values.checked = true;
  const original = { ...workspace, databases: [first], activeDatabaseId: first.id };
  const blob = await createWorkspaceBackup(original, { getFile: async () => undefined, fetch: async () => { throw new Error('Database records have no attachments'); } }, () => {});
  const backup = await readWorkspaceBackup(blob, () => {});
  assert.deepEqual(backup.snapshot.databases, original.databases);
  const once = mergeRestoredWorkspace(original, backup.snapshot);
  const twice = mergeRestoredWorkspace(once, backup.snapshot);
  assert.equal(twice.databases.length, 3);
  assert.equal(new Set(twice.databases.map(database => database.id)).size, 3);
  assert.equal(new Set(twice.databases.flatMap(database => database.records.map(record => record.id))).size, 3);
  assert.deepEqual(twice.databases[0], first);
  assert.equal(twice.databases[1].records[0].updatedAt, created);
  assert.equal(twice.databases[1].pinnedAt, 123);
  assert.equal(twice.boards.flatMap(board => board.cards).length, 0);
  assert.ok(readWorkspace(JSON.stringify(twice)));
});

test('all layouts persist independently per database and share identities, values, timestamps, and sorting', () => {
  const first = fixture(), second = fixture();
  first.view.sort = { propertyId: 'date', direction: 'desc' };
  for (const type of ['list', 'gallery', 'board', 'table']) {
    const switched = switchDatabaseView(first, type);
    assert.equal(switched.records, first.records);
    assert.equal(switched.updatedAt, first.updatedAt);
    assert.deepEqual(switched.view.sort, first.view.sort);
    const loaded = readWorkspace(JSON.stringify({ ...workspace, databases: [switched, second] }));
    assert.equal(loaded.databases[0].view.type, type);
    assert.equal(loaded.databases[1].view.type, 'table');
    assert.deepEqual(loaded.databases[0].records, first.records);
  }
  assert.equal(switchDatabaseView(first, 'table'), first);
  const invalid = structuredClone(first); invalid.view.type = 'unknown';
  assert.equal(validDatabases([invalid]), false);
});

test('moving board records updates the same record; empty groups and missing status do not hide records', () => {
  const first = fixture();
  first.records.push({ ...newDatabaseRecord(first, created), values: { status: null }, title: 'Unassigned' });
  const before = structuredClone(first);
  const moved = moveDatabaseRecord(switchDatabaseView(first, 'board'), first.records[0].id, 'done', updated);
  assert.equal(moved.records.length, 2);
  assert.equal(moved.records[0].id, first.records[0].id);
  assert.equal(moved.records[0].values.date, '2026-10-30');
  assert.equal(moved.records[0].values.status, 'done');
  assert.equal(moved.records[0].createdAt, created);
  assert.equal(moved.records[0].updatedAt, updated);
  assert.deepEqual(first, before);
  const { groups } = databaseBoardGroups(moved);
  assert.deepEqual(groups.map(group => group.count), [0, 0, 1, 1]);
  assert.equal(databaseRecords(switchDatabaseView(moved, 'list'))[0].values.status, 'done');
  assert.equal(moveDatabaseRecord(moved, first.records[0].id, 'invalid'), moved);
  const ungrouped = moveDatabaseRecord(moved, first.records[0].id, '', updated);
  assert.equal(databaseBoardGroups(ungrouped).groups.at(-1).count, 2);
  assert.ok(validDatabases([ungrouped]));
  const noStatus = { ...moved, properties: [], records: moved.records.map(record => ({ ...record, values: {} })) };
  assert.equal(databaseBoardGroups(noStatus).groups[0].count, 2);
  assert.equal(moveDatabaseRecord(noStatus, first.records[0].id, 'done'), noStatus);
});
