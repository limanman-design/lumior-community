import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDatabase,
  newDatabaseRecord,
  databaseRecords,
  updateActiveDatabaseView,
  activeDatabaseView,
  addDatabaseView,
  selectDatabaseView,
  removeDatabaseProperty,
  convertDatabaseProperty,
  validDatabases,
  databaseSorts,
  databaseValueText,
  databaseBoardGroups,
} from '../app/database-model.ts';
import {
  createWorkspaceBackup,
  readWorkspaceBackup,
} from '../app/workspace-backup.ts';
import {
  matchesDatabaseFilter,
  databaseFilterOperators,
  databaseActiveFilterCount,
  databaseChoiceOptions,
} from '../app/database-query.ts';
const now = '2026-10-17T10:00:00.000Z';
const rule = (propertyId, operator, value, endValue) => ({
  id: crypto.randomUUID(),
  propertyId,
  operator,
  ...(value !== undefined ? { value } : {}),
  ...(endValue !== undefined ? { endValue } : {}),
});
const group = (conjunction, ...rules) => ({
  id: crypto.randomUUID(),
  conjunction,
  rules,
});

void test('active condition count follows query evaluation for drafts, zero, false, and presence rules', () => {
  const properties = [
    { id: 'number', name: 'Number', type: 'number' },
    { id: 'checked', name: 'Checked', type: 'checkbox' },
  ];
  const filter = group(
    'and',
    rule('title', 'contains'),
    rule('title', 'contains', ''),
    rule('missing', 'notEmpty'),
    rule('number', 'between', 0),
    group('or', rule('number', 'eq', 0), rule('checked', 'eq', false)),
    rule('title', 'notEmpty'),
  );
  assert.equal(databaseActiveFilterCount(filter, properties), 3);
  assert.equal(databaseActiveFilterCount(undefined, properties), 0);
  assert.equal(
    databaseActiveFilterCount(rule('number', 'between', 0, 0), properties),
    1,
  );
});
function fixture() {
  const db = createDatabase('Tasks', 'en', now);
  db.properties.push(
    { id: 'priority', name: 'Priority', type: 'number' },
    {
      id: 'tags',
      name: 'Tags',
      type: 'multiSelect',
      options: [
        { id: 'a', name: 'Alpha', color: 'blue' },
        { id: 'b', name: 'Beta', color: 'red' },
      ],
    },
    { id: 'checked', name: 'Checked', type: 'checkbox' },
    { id: 'files', name: 'Files', type: 'files' },
    { id: 'created', name: 'Created', type: 'createdAt' },
  );
  db.records = [
    {
      ...newDatabaseRecord(db, now),
      title: 'Write notes',
      values: {
        priority: 2,
        date: '2026-10-18',
        status: 'todo',
        tags: ['a', 'b'],
        checked: false,
        files: [
          {
            url: 'lumior-file:test',
            name: 'Research.pdf',
            type: 'application/pdf',
            size: 1,
          },
        ],
      },
    },
    {
      ...newDatabaseRecord(db, now),
      title: 'Read paper',
      values: {
        priority: 2,
        date: '2026-10-17',
        status: 'done',
        tags: ['b'],
        checked: true,
      },
    },
    {
      ...newDatabaseRecord(db, now),
      title: 'Plan talk',
      values: { priority: 1, date: '2026-10-20', status: 'todo' },
    },
    { ...newDatabaseRecord(db, now), title: 'Empty', values: {} },
  ];
  return db;
}
const titles = (db) =>
  databaseRecords(db, '', new Date(2026, 9, 17, 12)).map((row) => row.title);

void test('select sorts follow visible option order, change with reordering, and survive reload without changing records', () => {
  const db = fixture();
  const labels = ['夯', '顶级', '人上人', 'NPC', '拉完了'];
  const property = { id: 'rating', name: 'Rating', type: 'select', options: labels.map((name, index) => ({ id: `option-${4 - index}`, name, color: 'gray' })) };
  db.properties.push(property);
  db.records = [4, 1, 0, 2, 1, 3].map((index, row) => ({ ...newDatabaseRecord(db, now), title: `${labels[index]}-${row}`, values: { rating: property.options[index].id } }));
  db.records.unshift({ ...newDatabaseRecord(db, now), title: 'Empty', values: {} });
  const original = structuredClone(db.records);
  const asc = ['夯-2', '顶级-1', '顶级-4', '人上人-3', 'NPC-5', '拉完了-0', 'Empty'];
  const sorted = updateActiveDatabaseView(db, { sorts: [{ propertyId: 'rating', direction: 'asc' }] });
  assert.deepEqual(titles(sorted), asc);
  assert.deepEqual(titles(JSON.parse(JSON.stringify(sorted))), asc);
  assert.deepEqual(titles(updateActiveDatabaseView(sorted, { sorts: [{ propertyId: 'rating', direction: 'desc' }] })), ['拉完了-0', 'NPC-5', '人上人-3', '顶级-1', '顶级-4', '夯-2', 'Empty']);
  const reordered = convertDatabaseProperty(sorted, { ...property, options: [property.options[4], ...property.options.slice(0, 4)] }).database;
  assert.deepEqual(titles(reordered), ['拉完了-0', ...asc.slice(0, -2), 'Empty']);
  assert.deepEqual(db.records, original);
  assert.ok(validDatabases([reordered]));
});

void test('multi-select compares displayed option positions rather than click order or option names', () => {
  const db = fixture();
  const property = { id: 'ranked', name: 'Ranked', type: 'multiSelect', options: ['Z', 'A', 'M'].map(name => ({ id: name, name, color: 'gray' })) };
  db.properties.push(property);
  const values = [['M'], ['A', 'Z'], ['Z'], ['A'], [], ['Z', 'A'], ['M', 'Z']];
  db.records = values.map((value, index) => ({ ...newDatabaseRecord(db, now), title: String(index), values: { ranked: value } }));
  assert.equal(databaseValueText(db.records[1], property), 'Z, A');
  const sorted = updateActiveDatabaseView(db, { sorts: [{ propertyId: 'ranked', direction: 'asc' }] });
  assert.deepEqual(titles(sorted), ['2', '1', '5', '6', '3', '0', '4']);
  assert.deepEqual(titles(updateActiveDatabaseView(sorted, { sorts: [{ propertyId: 'ranked', direction: 'desc' }] })), ['0', '3', '6', '1', '5', '2', '4']);
  const secondary = updateActiveDatabaseView(sorted, { sorts: [...sorted.view.sorts, { propertyId: 'title', direction: 'desc' }] });
  assert.deepEqual(titles(secondary), ['2', '5', '1', '6', '3', '0', '4']);
  assert.deepEqual(db.records.map(record => record.values.ranked), values);
});

void test('status sorting and board groups match the editor group order even if stored options are interleaved', () => {
  const db = fixture();
  const property = { id: 'status', name: 'Status', type: 'status', options: [
    { id: 'done', name: 'A done', group: 'done', color: 'green' },
    { id: 'progress', name: 'B progress', group: 'progress', color: 'blue' },
    { id: 'todo2', name: 'Z second', group: 'todo', color: 'gray' },
    { id: 'todo1', name: 'C first', color: 'gray' },
  ] };
  db.properties = db.properties.map(item => item.id === 'status' ? property : item);
  db.records = ['done', 'progress', 'todo1', 'todo2', ''].map(id => ({ ...newDatabaseRecord(db, now), title: id || 'Empty', values: { status: id } }));
  const sorted = updateActiveDatabaseView(db, { sorts: [{ propertyId: 'status', direction: 'asc' }], groupBy: 'status' });
  assert.deepEqual(databaseChoiceOptions(property).map(option => option.id), ['todo2', 'todo1', 'progress', 'done']);
  assert.deepEqual(titles(sorted), ['todo2', 'todo1', 'progress', 'done', 'Empty']);
  assert.deepEqual(databaseBoardGroups(sorted).groups.map(group => group.key), ['todo2', 'todo1', 'progress', 'done', '']);
  assert.deepEqual(property.options.map(option => option.id), ['done', 'progress', 'todo2', 'todo1']);
});

void test('other field sorts retain semantic numeric, chronological and visible text order, with empty values last', () => {
  /** @type {Array<[string, unknown[], string[]]>} */
  const cases = [
    ['number', [10, -2, 0], ['1', '2', '0']],
    ['checkbox', [true, false, true], ['1', '0', '2']],
    ['text', ['Item 10', 'Item 2', 'Item 1'], ['2', '1', '0']],
    ['date', ['2026-11-03', '2025-01-01', '2026-02-01'], ['1', '2', '0']],
    ['createdAt', ['2026-11-03T08:00:00+08:00', '2026-11-03T00:30:00Z', '2026-11-02T22:00:00Z'], ['2', '0', '1']],
    ['updatedAt', ['2026-11-03T08:00:00+08:00', '2026-11-03T00:30:00Z', '2026-11-02T22:00:00Z'], ['2', '0', '1']],
    ['files', ['File 10.pdf', 'File 2.pdf', 'File 1.pdf'].map(name => [{ name, url: 'lumior-file:file', type: 'application/pdf', size: 1 }]), ['2', '1', '0']],
  ];
  for (const [type, values, expected] of cases) {
    const db = fixture();
    db.properties.push({ id: 'checked-order', name: type, type });
    db.records = [...values, undefined].map((value, index) => ({ ...newDatabaseRecord(db, now), title: String(index), ...(type === 'createdAt' || type === 'updatedAt' ? { [type]: value } : {}), values: { 'checked-order': value } }));
    const sorted = updateActiveDatabaseView(db, { sorts: [{ propertyId: 'checked-order', direction: 'asc' }] });
    assert.deepEqual(titles(sorted), type === 'checkbox' ? ['1', '3', '0', '2'] : [...expected, '3'], type);
    // Duplicate values keep their original order even when descending.
    const descending = type === 'checkbox' ? ['0', '2', '1'] : [...expected].reverse();
    assert.deepEqual(titles(updateActiveDatabaseView(sorted, { sorts: [{ propertyId: 'checked-order', direction: 'desc' }] })), [...descending, '3'], type);
  }
});
void test('nested AND/OR filters combine with search without changing records or timestamps', () => {
  const original = fixture();
  const filter = group(
    'and',
    rule('status', 'eq', 'todo'),
    group('or', rule('priority', 'eq', 1), rule('title', 'contains', 'WRITE')),
  );
  const db = updateActiveDatabaseView(original, { filter });
  assert.deepEqual(titles(db), ['Write notes', 'Plan talk']);
  assert.deepEqual(
    databaseRecords(db, 'talk').map((r) => r.title),
    ['Plan talk'],
  );
  assert.equal(db.records, original.records);
  assert.equal(db.updatedAt, now);
  assert.ok(validDatabases([db]));
});
void test('numbers, dates, choices, checkboxes, filenames and empty values use typed predicates', () => {
  const db = fixture();
  const check = (condition, expected) =>
    assert.deepEqual(
      titles({ ...db, view: { ...db.view, filter: group('and', condition) } }),
      expected,
    );
  check(rule('priority', 'between', 1, 2), [
    'Write notes',
    'Read paper',
    'Plan talk',
  ]);
  check(rule('date', 'between', '2026-10-17', '2026-10-18'), [
    'Write notes',
    'Read paper',
  ]);
  check(rule('tags', 'eq', 'a'), ['Write notes']);
  check(rule('tags', 'neq', 'b'), ['Plan talk', 'Empty']);
  check(rule('checked', 'eq', false), ['Write notes', 'Plan talk', 'Empty']);
  check(rule('files', 'contains', 'research.PDF'), ['Write notes']);
  check(rule('files', 'empty'), ['Read paper', 'Plan talk', 'Empty']);
  check(rule('priority', 'gte', 2), ['Write notes', 'Read paper']);
  check(rule('priority', 'notEmpty'), [
    'Write notes',
    'Read paper',
    'Plan talk',
  ]);
  check(rule('title', 'endsWith', 'PAPER'), ['Read paper']);
});
void test('relative calendar ranges include today, use Monday weeks, and system dates use local time', () => {
  const db = fixture(),
    clock = new Date(2026, 9, 17, 23, 59);
  for (const [preset, expected] of [
    ['today', ['Read paper']],
    ['thisWeek', ['Write notes', 'Read paper']],
    ['next7Days', ['Write notes', 'Read paper', 'Plan talk']],
    ['past7Days', ['Read paper']],
  ]) {
    const filter = group('and', rule('date', 'relative', preset));
    assert.deepEqual(
      db.records
        .filter((r) => matchesDatabaseFilter(r, db.properties, filter, clock))
        .map((r) => r.title),
      expected,
    );
  }
  const local = new Date(2026, 9, 17, 0, 30).toISOString();
  const record = { ...db.records[0], createdAt: local };
  assert.equal(
    matchesDatabaseFilter(
      record,
      db.properties,
      group('and', rule('created', 'eq', '2026-10-17')),
      clock,
    ),
    true,
  );
});

void test('choice arrays match any selected option, negate all selections, and leave empty selections inactive', () => {
  const db = fixture();
  const check = (condition, expected) => {
    const configured = updateActiveDatabaseView(db, {
      filter: group('and', condition),
    });
    assert.deepEqual(titles(configured), expected);
    assert.ok(validDatabases([configured]));
  };
  check(rule('status', 'eq', ['todo', 'done']), [
    'Write notes',
    'Read paper',
    'Plan talk',
  ]);
  check(rule('tags', 'eq', ['a', 'b']), ['Write notes', 'Read paper']);
  check(rule('tags', 'neq', ['a', 'b']), ['Plan talk', 'Empty']);
  check(
    rule('tags', 'eq', []),
    db.records.map((record) => record.title),
  );
  assert.equal(
    databaseActiveFilterCount(rule('tags', 'eq', []), db.properties),
    0,
  );
  for (const value of [['a', 'missing'], ['a', 'a'], [1], [['a']]]) {
    const configured = updateActiveDatabaseView(db, {
      filter: group('and', rule('tags', 'eq', value)),
    });
    assert.equal(validDatabases([configured]), false);
  }
  assert.equal(
    validDatabases([
      updateActiveDatabaseView(db, {
        filter: group('and', rule('priority', 'eq', ['a'])),
      }),
    ]),
    false,
  );
});

void test('choice filters retain surviving selections across option edits, all views, and backup reloads', async () => {
  let db = updateActiveDatabaseView(fixture(), {
    filter: group('and', rule('tags', 'eq', ['a', 'b'])),
  });
  db.records.forEach((record) => delete record.values.files);
  db = addDatabaseView(db, 'table', 'en', activeDatabaseView(db).id);
  const converted = convertDatabaseProperty(db, {
    ...db.properties.find((property) => property.id === 'tags'),
    options: [{ id: 'b', name: 'Beta', color: 'blue' }],
  }).database;
  assert.deepEqual(converted.view.filter.rules[0].value, ['b']);
  assert.ok(
    converted.views
      .filter((view) => view.filter)
      .every((view) => view.filter.rules[0].value.length === 1),
  );
  assert.ok(validDatabases([converted]));
  const snapshot = {
    version: 1,
    boards: [],
    deletedBoards: [],
    activeId: '',
    nextUntitledIndex: 1,
    databases: [converted],
    activeDatabaseId: converted.id,
  };
  const backup = await readWorkspaceBackup(
    await createWorkspaceBackup(
      snapshot,
      {
        getFile: async () => undefined,
        fetch: async () => new Response('file'),
      },
      () => {},
    ),
    () => {},
  );
  assert.deepEqual(
    backup.snapshot.databases[0].view.filter,
    converted.view.filter,
  );
  assert.ok(validDatabases(backup.snapshot.databases));
  const removed = convertDatabaseProperty(converted, {
    ...converted.properties.find((property) => property.id === 'tags'),
    options: [],
  }).database;
  assert.equal(removed.view.filter.rules.length, 0);
  assert.ok(validDatabases([removed]));
});
void test('empty and unfinished groups do not change OR or AND results while conditions are being edited', () => {
  const db = fixture();
  db.view.filter = group(
    'or',
    group('and'),
    rule('priority', 'gt'),
    rule('status', 'eq', 'done'),
  );
  assert.deepEqual(titles(db), ['Read paper']);
  db.view.filter = group('and', rule('priority', 'between', 1));
  assert.equal(titles(db).length, 4);
  assert.ok(validDatabases([db]));
});
void test('multiple sorts break ties, keep missing values last in both directions, and preserve stable row order', () => {
  const db = fixture(),
    original = db.records.map((r) => r.id);
  const sorted = updateActiveDatabaseView(db, {
    sorts: [
      { propertyId: 'priority', direction: 'desc' },
      { propertyId: 'date', direction: 'asc' },
    ],
  });
  assert.deepEqual(titles(sorted), [
    'Read paper',
    'Write notes',
    'Plan talk',
    'Empty',
  ]);
  assert.deepEqual(
    db.records.map((r) => r.id),
    original,
  );
  assert.deepEqual(sorted.view.sort, sorted.view.sorts[0]);
  db.view.sort = { propertyId: 'title', direction: 'desc' };
  assert.equal(databaseSorts(db.view).length, 1);
  assert.deepEqual(
    databaseSorts(updateActiveDatabaseView(sorted, { sort: undefined }).view),
    [],
  );
  db.records[0].values.priority = undefined;
  delete db.records[0].values.priority;
  db.records[1].values.priority = undefined;
  delete db.records[1].values.priority;
  db.view = {
    type: 'table',
    sorts: [
      { propertyId: 'priority', direction: 'asc' },
      { propertyId: 'title', direction: 'asc' },
    ],
  };
  assert.deepEqual(titles(db), [
    'Plan talk',
    'Empty',
    'Read paper',
    'Write notes',
  ]);
});
void test('view switches, duplication and backup round trips preserve independent query configurations', async () => {
  let db = updateActiveDatabaseView(fixture(), {
    filter: group('and', rule('priority', 'gte', 2)),
    sorts: [
      { propertyId: 'date', direction: 'asc' },
      { propertyId: 'title', direction: 'desc' },
    ],
  });
  const id = activeDatabaseView(db).id;
  db = addDatabaseView(db, 'list');
  assert.equal(titles(db).length, 4);
  db = selectDatabaseView(db, id);
  assert.deepEqual(titles(db), ['Read paper', 'Write notes']);
  db.records.forEach((r) => delete r.values.files);
  const source = db.view.filter;
  db = addDatabaseView(db, 'table', 'en', id);
  assert.notEqual(db.view.filter, source);
  assert.deepEqual(db.view.filter, source);
  const snapshot = {
    version: 1,
    boards: [],
    deletedBoards: [],
    activeId: '',
    nextUntitledIndex: 1,
    databases: [db],
    activeDatabaseId: db.id,
  };
  const blob = await createWorkspaceBackup(
    snapshot,
    { getFile: async () => undefined, fetch: async () => new Response('file') },
    () => {},
  );
  const backup = await readWorkspaceBackup(blob, () => {});
  assert.deepEqual(
    backup.snapshot.databases[0].view,
    JSON.parse(JSON.stringify(db.view)),
  );
  assert.ok(validDatabases(backup.snapshot.databases));
});
void test('field removal and type or option changes reconcile query references across all views', () => {
  let db = fixture();
  db.records.forEach((r) => delete r.values.files);
  db = updateActiveDatabaseView(db, {
    filter: group('and', rule('tags', 'eq', 'a'), rule('priority', 'gt', 1)),
    sorts: [
      { propertyId: 'priority', direction: 'desc' },
      { propertyId: 'date', direction: 'asc' },
    ],
  });
  db = addDatabaseView(db, 'table', 'en', activeDatabaseView(db).id);
  const converted = convertDatabaseProperty(db, {
    ...db.properties.find((p) => p.id === 'tags'),
    options: [{ id: 'b', name: 'Beta', color: 'red' }],
  }).database;
  assert.ok(
    converted.views
      .filter((v) => v.filter)
      .every((v) => v.filter.rules.length === 1),
  );
  assert.ok(validDatabases([converted]));
  const removed = removeDatabaseProperty(db, 'priority');
  assert.ok(
    removed.views
      .filter((v) => v.filter)
      .every((v) => v.sorts.length === 1 && v.filter.rules.length === 1),
  );
  assert.ok(validDatabases([removed]));
  const text = convertDatabaseProperty(db, {
    id: 'priority',
    name: 'Priority',
    type: 'text',
  }).database;
  assert.ok(
    text.views
      .filter((v) => v.filter)
      .every((v) => v.filter.rules.length === 1),
  );
  assert.ok(validDatabases([text]));
});
void test('invalid imported filters and sort lists are rejected before they can corrupt saved workspaces', () => {
  const db = fixture();
  for (const filter of [
    group('xor', rule('title', 'eq', 'x')),
    group('and', rule('gone', 'eq', 'x')),
    group('and', rule('priority', 'contains', 'x')),
    group('and', rule('date', 'eq', '2026-02-30')),
    group('and', rule('tags', 'eq', 'gone')),
    group('and', rule('priority', 'gt', Infinity)),
    group('and', rule('title', 'empty', 'x')),
    group(
      'and',
      ...Array.from({ length: 100 }, () => rule('title', 'contains', 'x')),
    ),
    group(
      'and',
      group('and', group('and', group('and', rule('title', 'eq', 'x')))),
    ),
  ])
    assert.equal(
      validDatabases([{ ...db, view: { type: 'table', filter } }]),
      false,
    );
  const same = rule('title', 'eq', 'x');
  assert.equal(
    validDatabases([
      { ...db, view: { type: 'table', filter: group('and', same, same) } },
    ]),
    false,
  );
  assert.equal(
    validDatabases([
      {
        ...db,
        view: {
          type: 'table',
          sorts: [
            { propertyId: 'title', direction: 'asc' },
            { propertyId: 'title', direction: 'desc' },
          ],
        },
      },
    ]),
    false,
  );
  for (const property of db.properties)
    assert.ok(databaseFilterOperators(property).includes('empty'));
});
