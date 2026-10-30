import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDatabase,
  newDatabaseRecord,
  patchDatabaseRecord,
  databaseValue,
  databaseValueText,
  databaseRecords,
  convertDatabaseProperty,
  removeDatabaseProperty,
  validDatabases,
  validDatabaseDefaultValue,
  databaseBoardGroups,
  moveDatabaseRecord,
} from '../app/database-model.ts';
import { readWorkspace } from '../app/workspace-store.ts';
import {
  createWorkspaceBackup,
  readWorkspaceBackup,
  remapBackupAttachments,
} from '../app/workspace-backup.ts';
import { managedFiles, cleanupCandidates } from '../app/storage-management.ts';
import {
  fileUrl,
  serializeWorkspace,
  fileReferencePrefix,
} from '../app/workspace-assets.ts';
const created = '2026-10-16T08:00:00.000Z',
  updated = '2026-10-16T10:30:00.000Z';
function fixture() {
  const db = createDatabase('Properties', 'en', created);
  db.properties.push(
    { id: 'text', name: 'Description', type: 'text' },
    { id: 'amount', name: 'Amount', type: 'number', numberFormat: 'percent' },
    {
      id: 'select',
      name: 'Priority',
      type: 'select',
      options: [
        { id: 'high', name: 'High', color: 'red' },
        { id: 'low', name: 'Low', color: 'gray' },
      ],
    },
    {
      id: 'tags',
      name: 'Tags',
      type: 'multiSelect',
      options: [
        { id: 'a', name: 'Research', color: 'purple' },
        { id: 'b', name: 'Writing', color: 'yellow' },
      ],
    },
    {
      id: 'check',
      name: 'Checklist',
      type: 'checkbox',
      checkboxLabel: 'Submitted',
    },
    {
      id: 'created',
      name: 'Created time',
      type: 'createdAt',
      dateFormat: 'iso',
    },
    {
      id: 'updated',
      name: 'Last edited time',
      type: 'updatedAt',
      includeTime: false,
    },
    { id: 'files', name: 'Files', type: 'files' },
  );
  db.records = [
    {
      ...newDatabaseRecord(db, created),
      title: 'Paper',
      values: {
        status: 'todo',
        date: '2026-11-01T10:30',
        text: 'First line\n第二行',
        amount: 0.25,
        select: 'high',
        tags: ['a', 'b'],
        check: true,
        files: [],
      },
    },
  ];
  return db;
}
const workspace = (db) => ({
  version: 1,
  boards: [{ id: 'b', title: 'Knowledge', cards: [], edges: [] }],
  deletedBoards: [],
  activeId: 'b',
  nextUntitledIndex: 1,
  databases: [db],
});
void test('ten types and configurations persist; system properties derive from record metadata', () => {
  const db = fixture(),
    before = structuredClone(db),
    record = db.records[0];
  assert.equal(new Set(db.properties.map((p) => p.type)).size, 10);
  assert.ok(validDatabases([db]));
  assert.deepEqual(readWorkspace(JSON.stringify(workspace(db))).databases, [
    db,
  ]);
  const next = patchDatabaseRecord(
    db,
    record.id,
    { values: { tags: ['b'], text: 'Changed\n保留换行' } },
    updated,
  );
  assert.equal(
    databaseValue(
      next.records[0],
      db.properties.find((p) => p.id === 'created'),
    ),
    created,
  );
  assert.equal(
    databaseValue(
      next.records[0],
      db.properties.find((p) => p.id === 'updated'),
    ),
    updated,
  );
  assert.equal(
    patchDatabaseRecord(
      next,
      record.id,
      { values: { created: updated } },
      updated,
    ),
    next,
  );
  assert.equal(
    patchDatabaseRecord(next, record.id, { values: { tags: ['b'] } }, created),
    next,
  );
  assert.deepEqual(db, before);
  assert.equal(
    databaseValueText(
      record,
      db.properties.find((p) => p.id === 'amount'),
      'en-US',
    ),
    '25%',
  );
  assert.equal(databaseRecords(db, 'Writing').length, 1);
});
void test('invalid complex values never become reload-breaking edits', () => {
  const db = fixture();
  for (const values of [
    { tags: ['missing'] },
    { tags: ['a', 'a'] },
    { date: '2026-02-30' },
    { date: '2026-11-01T24:12' },
    { amount: Infinity },
    { files: [{ url: 'javascript:alert(1)', name: 'a', type: '', size: 1 }] },
    { files: [{ url: 'lumior-file:a', name: 'a', type: '', size: -1 }] },
  ]) {
    assert.equal(
      patchDatabaseRecord(db, db.records[0].id, { values }, updated),
      db,
    );
    const copy = structuredClone(db);
    Object.assign(copy.records[0].values, values);
    assert.equal(validDatabases([copy]), false);
  }
});
void test('option edits preserve IDs, removal previews affected records, conversion refuses lossy choices', () => {
  const db = fixture(),
    property = db.properties.find((p) => p.id === 'tags');
  const renamed = {
    ...property,
    options: property.options.map((option) => ({
      ...option,
      name: option.name + '!',
      color: 'pink',
    })),
  };
  const next = convertDatabaseProperty(db, renamed, updated);
  assert.equal(next.incompatible, 0);
  assert.deepEqual(next.database.records[0].values.tags, ['a', 'b']);
  assert.equal(next.database.records[0].updatedAt, created);
  const cleared = convertDatabaseProperty(
    db,
    { ...property, options: property.options.slice(1) },
    updated,
  );
  assert.equal(cleared.cleared, 1);
  assert.deepEqual(cleared.database.records[0].values.tags, ['b']);
  assert.equal(cleared.database.records[0].updatedAt, updated);
  const invalid = convertDatabaseProperty(
    db,
    { ...property, type: 'select' },
    updated,
  );
  assert.equal(invalid.incompatible, 1);
  assert.equal(invalid.database, db);
  const renamedNumber = convertDatabaseProperty(
    db,
    {
      ...db.properties.find((p) => p.id === 'amount'),
      name: 'Budget',
      numberFormat: 'usd',
    },
    updated,
  );
  assert.equal(renamedNumber.database.records[0].values.amount, 0.25);
});
void test('text to select keeps all distinct values and makes them available as custom board groups', () => {
  const db = fixture();
  db.records.push({
    ...newDatabaseRecord(db, created),
    title: 'Other',
    values: { text: 'Other stage' },
  });
  const conversion = convertDatabaseProperty(
    db,
    {
      ...db.properties.find((p) => p.id === 'text'),
      type: 'select',
      options: [],
    },
    updated,
  );
  assert.equal(conversion.incompatible, 0);
  const next = conversion.database;
  next.view.groupBy = 'text';
  assert.ok(validDatabases([next]));
  assert.deepEqual(
    databaseBoardGroups(next).groups.map((g) => g.count),
    [1, 1, 0],
  );
  assert.equal(
    databaseValueText(
      next.records[0],
      next.properties.find((p) => p.id === 'text'),
    ),
    'First line\n第二行',
  );
  const target = next.properties.find((p) => p.id === 'text').options[1].id;
  const moved = moveDatabaseRecord(next, next.records[0].id, target, updated);
  assert.equal(moved.records[0].values.status, 'todo');
  assert.equal(moved.records[0].values.text, target);
  const removed = removeDatabaseProperty(moved, 'text', updated);
  assert.equal(removed.view.groupBy, undefined);
  assert.ok(validDatabases([removed]));
});
void test('legacy select statuses and date-only task data remain unchanged', () => {
  const db = fixture();
  db.properties[0] = {
    ...db.properties[0],
    type: 'select',
    options: db.properties[0].options.map(
      ({ group: _group, ...option }) => option,
    ),
  };
  db.records[0].values.date = '2026-11-01';
  const loaded = readWorkspace(JSON.stringify(workspace(db)));
  assert.deepEqual(loaded.databases[0], db);
  assert.equal(databaseBoardGroups(db).property.id, 'status');
  assert.equal(newDatabaseRecord(db).values.status, 'todo');
});
void test('database-only attachments survive cleanup, portable backup, restore remapping and search', async () => {
  const db = fixture(),
    blob = new Blob(['original attachment'], { type: 'text/plain' });
  const file = {
    id: '10000000-0000-4000-8000-000000000001',
    name: 'submission.txt',
    type: blob.type,
    size: blob.size,
    blob,
    createdAt: 0,
  };
  const url = fileUrl(file);
  db.records[0].values.files = [
    { url, name: file.name, type: file.type, size: file.size },
  ];
  const snapshot = workspace(db);
  const report = managedFiles([file], { snapshot, history: [] }, Date.now());
  assert.equal(report[0].usage, 'active');
  assert.equal(cleanupCandidates(report, [file.id]).length, 0);
  assert.equal(databaseRecords(db, 'submission').length, 1);
  const archive = await createWorkspaceBackup(
    snapshot,
    {
      getFile: async (id) => (id === file.id ? file : undefined),
      fetch: async () => {
        throw Error('no network');
      },
    },
    () => {},
  );
  const backup = await readWorkspaceBackup(archive, () => {});
  assert.equal(backup.files.length, 1);
  assert.equal(await backup.files[0].blob.text(), 'original attachment');
  const serialized = serializeWorkspace(snapshot);
  assert.equal(
    serialized.databases[0].records[0].values.files[0].url,
    fileReferencePrefix + file.id,
  );
  const restored = remapBackupAttachments(
    backup.snapshot,
    new Map([[fileReferencePrefix + file.id, 'lumior-file:restored-file']]),
  );
  assert.equal(
    restored.databases[0].records[0].values.files[0].url,
    'lumior-file:restored-file',
  );
  assert.ok(readWorkspace(JSON.stringify(restored)));
  assert.equal(restored.boards[0].cards.length, 0);
});

void test('property configuration edits do not rewrite empty cells or record edit times', () => {
  const db = fixture();
  db.records.push({
    ...newDatabaseRecord(db, created),
    title: 'Empty record',
    values: {},
  });
  const property = {
    ...db.properties.find((property) => property.id === 'check'),
    checkboxLabel: 'Approved',
  };
  const result = convertDatabaseProperty(db, property, updated).database;
  assert.deepEqual(result.records, db.records);
  assert.equal(result.records[1].updatedAt, created);
  assert.ok(validDatabases([result]));
});

void test('editable field defaults persist and populate new records without touching existing records', () => {
  const db = fixture();
  const defaults = {
    status: 'done',
    date: '2026-12-01T09:30',
    text: 'New submission\n待整理',
    amount: 0,
    select: 'low',
    tags: ['a'],
    check: false,
    files: [
      {
        url: 'lumior-file:template',
        name: 'template.txt',
        type: 'text/plain',
        size: 4,
      },
    ],
  };
  for (const property of db.properties)
    if (Object.hasOwn(defaults, property.id))
      property.defaultValue = structuredClone(defaults[property.id]);
  assert.ok(validDatabases([db]));
  const loaded = readWorkspace(JSON.stringify(workspace(db))).databases[0];
  assert.deepEqual(loaded, db);
  const record = newDatabaseRecord(loaded, updated);
  assert.deepEqual(record.values, defaults);
  assert.equal(record.createdAt, updated);
  assert.equal(record.updatedAt, updated);
  assert.equal(
    databaseValue(
      record,
      loaded.properties.find((p) => p.id === 'created'),
    ),
    updated,
  );
  assert.equal(
    databaseValue(
      record,
      loaded.properties.find((p) => p.id === 'updated'),
    ),
    updated,
  );
  const changed = convertDatabaseProperty(
    loaded,
    {
      ...loaded.properties.find((p) => p.id === 'text'),
      defaultValue: 'Different default',
    },
    updated,
  ).database;
  assert.deepEqual(changed.records, db.records);
  assert.equal(newDatabaseRecord(changed).values.text, 'Different default');
});

void test('array and file defaults are isolated from other new records and property configuration', () => {
  const db = fixture();
  const tags = db.properties.find((p) => p.id === 'tags');
  const files = db.properties.find((p) => p.id === 'files');
  tags.defaultValue = ['a'];
  files.defaultValue = [
    {
      url: 'lumior-file:template',
      name: 'template.txt',
      type: 'text/plain',
      size: 4,
    },
  ];
  const first = newDatabaseRecord(db),
    second = newDatabaseRecord(db);
  first.values.tags.push('b');
  first.values.files[0].name = 'Changed';
  assert.deepEqual(second.values.tags, ['a']);
  assert.deepEqual(tags.defaultValue, ['a']);
  assert.equal(second.values.files[0].name, 'template.txt');
  assert.equal(files.defaultValue[0].name, 'template.txt');
});

void test('explicit empty defaults disable status fallback while old workspaces keep their behavior', () => {
  const db = fixture();
  assert.equal(newDatabaseRecord(db).values.status, 'todo');
  for (const empty of [null, '']) {
    db.properties[0].defaultValue = empty;
    assert.ok(validDatabases([db]));
    assert.equal(newDatabaseRecord(db).values.status, empty);
  }
  delete db.properties[0].defaultValue;
  assert.equal(newDatabaseRecord(db).values.status, 'todo');
  db.properties[0].type = 'select';
  assert.equal(newDatabaseRecord(db).values.status, 'todo');
  db.properties[0].defaultValue = null;
  assert.equal(newDatabaseRecord(db).values.status, null);
  for (const id of ['tags', 'files'])
    db.properties.find((p) => p.id === id).defaultValue = [];
  assert.deepEqual(newDatabaseRecord(db).values.tags, []);
  assert.deepEqual(newDatabaseRecord(db).values.files, []);
});

void test('invalid defaults and computed timestamp overrides are rejected before persistence', () => {
  for (const [id, value] of [
    ['status', 'missing'],
    ['date', '2026-02-30'],
    ['text', false],
    ['amount', Infinity],
    ['select', 'missing'],
    ['tags', ['a', 'a']],
    ['check', 'true'],
    ['files', [{ url: 'javascript:alert(1)', name: 'bad', type: '', size: 1 }]],
    ['created', created],
    ['updated', null],
  ]) {
    const db = fixture(),
      property = db.properties.find((p) => p.id === id);
    property.defaultValue = value;
    assert.equal(validDatabaseDefaultValue(value, property), false, id);
    assert.equal(validDatabases([db]), false, id);
    assert.equal(Object.hasOwn(newDatabaseRecord(db).values, id), false, id);
  }
  const malformed = fixture();
  malformed.properties[0].options = 42;
  malformed.properties[0].defaultValue = 'todo';
  assert.equal(validDatabases([malformed]), false);
});

void test('property conversions convert carried defaults and clear incompatible defaults', () => {
  const db = fixture();
  const text = db.properties.find((p) => p.id === 'text');
  text.defaultValue = 'New stage';
  const selected = convertDatabaseProperty(
    db,
    { ...text, type: 'select', options: [] },
    updated,
  );
  assert.equal(selected.incompatible, 0);
  const property = selected.database.properties.find((p) => p.id === text.id);
  assert.equal(
    property.options.find((o) => o.id === property.defaultValue).name,
    'New stage',
  );
  assert.equal(
    newDatabaseRecord(selected.database).values.text,
    property.defaultValue,
  );
  assert.ok(validDatabases([selected.database]));
  const asText = convertDatabaseProperty(
    selected.database,
    { ...property, type: 'text' },
    updated,
  ).database;
  assert.equal(
    asText.properties.find((p) => p.id === 'text').defaultValue,
    'New stage',
  );

  db.records[0].values.text = '12';
  text.defaultValue = '12.5';
  const numeric = convertDatabaseProperty(
    db,
    { ...text, type: 'number' },
    updated,
  );
  assert.equal(
    numeric.database.properties.find((p) => p.id === 'text').defaultValue,
    12.5,
  );
  assert.equal(numeric.database.records[0].values.text, 12);

  const tags = db.properties.find((p) => p.id === 'tags');
  tags.defaultValue = ['a', 'b'];
  db.records[0].values.tags = ['a'];
  const narrowed = convertDatabaseProperty(
    db,
    { ...tags, type: 'select' },
    updated,
  );
  assert.equal(narrowed.incompatible, 0);
  assert.equal(
    narrowed.database.properties.find((p) => p.id === 'tags').defaultValue,
    null,
  );
  assert.equal(narrowed.database.records[0].values.tags, 'a');
  assert.ok(validDatabases([narrowed.database]));
});

void test('removing options prunes defaults without re-enabling legacy status fallback', () => {
  const db = fixture();
  const tags = db.properties.find((p) => p.id === 'tags');
  tags.defaultValue = ['a', 'b'];
  const pruned = convertDatabaseProperty(
    db,
    { ...tags, options: tags.options.slice(1) },
    updated,
  );
  assert.equal(pruned.cleared, 1);
  assert.deepEqual(
    pruned.database.properties.find((p) => p.id === 'tags').defaultValue,
    ['b'],
  );
  assert.deepEqual(newDatabaseRecord(pruned.database).values.tags, ['b']);
  const status = db.properties[0];
  status.defaultValue = 'done';
  const removed = convertDatabaseProperty(
    db,
    { ...status, options: status.options.filter((o) => o.id !== 'done') },
    updated,
  );
  assert.equal(removed.cleared, 0);
  assert.deepEqual(removed.database.records, db.records);
  assert.equal(removed.database.properties[0].defaultValue, '');
  assert.equal(newDatabaseRecord(removed.database).values.status, '');
  assert.ok(validDatabases([removed.database]));
});

void test('conversion to computed timestamp fields removes defaults and keeps automatic metadata', () => {
  for (const type of ['createdAt', 'updatedAt']) {
    const db = fixture(),
      text = db.properties.find((p) => p.id === 'text');
    text.defaultValue = 'Template';
    delete db.records[0].values.text;
    const result = convertDatabaseProperty(db, { ...text, type }, updated);
    assert.equal(result.incompatible, 0);
    const property = result.database.properties.find((p) => p.id === text.id);
    assert.equal(Object.hasOwn(property, 'defaultValue'), false);
    const record = newDatabaseRecord(result.database, updated);
    assert.equal(Object.hasOwn(record.values, text.id), false);
    assert.equal(databaseValue(record, property), updated);
    assert.ok(validDatabases([result.database]));
  }
});

void test('attachments referenced only by defaults survive cleanup, backup and restore remapping', async () => {
  const db = fixture(),
    blob = new Blob(['default attachment'], { type: 'text/plain' });
  const file = {
    id: '10000000-0000-4000-8000-000000000002',
    name: 'template.txt',
    type: blob.type,
    size: blob.size,
    blob,
    createdAt: 0,
  };
  db.records = [];
  db.properties.find((p) => p.id === 'files').defaultValue = [
    { url: fileUrl(file), name: file.name, type: file.type, size: file.size },
  ];
  const snapshot = workspace(db);
  const report = managedFiles([file], { snapshot, history: [] }, Date.now());
  assert.equal(report[0].usage, 'active');
  assert.deepEqual(cleanupCandidates(report, [file.id]), []);
  const backup = await readWorkspaceBackup(
    await createWorkspaceBackup(
      snapshot,
      {
        getFile: async (id) => (id === file.id ? file : undefined),
        fetch: async () => {
          throw Error('no network');
        },
      },
      () => {},
    ),
    () => {},
  );
  assert.equal(backup.files.length, 1);
  const restored = remapBackupAttachments(
    backup.snapshot,
    new Map([[fileReferencePrefix + file.id, 'lumior-file:restored-template']]),
  );
  const restoredDb = restored.databases[0];
  assert.equal(
    newDatabaseRecord(restoredDb).values.files[0].url,
    'lumior-file:restored-template',
  );
  assert.ok(validDatabases([restoredDb]));
});
