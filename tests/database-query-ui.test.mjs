import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendDatabaseAdvancedFilter,
  appendDatabaseQuickFilter,
  databaseFilterChips,
  replaceDatabaseFilterNode,
} from '../app/database-query-ui.ts';
import { matchesDatabaseFilter } from '../app/database-query.ts';

const title = { id: 'title', name: 'Name', type: 'text' };
const rule = (id, value = id) => ({
  id,
  propertyId: 'title',
  operator: 'contains',
  value,
});
const group = (id, conjunction, ...rules) => ({ id, conjunction, rules });
const record = (name) => ({
  id: name,
  title: name,
  values: {},
  createdAt: '2026-10-18T00:00:00.000Z',
  updatedAt: '2026-10-18T00:00:00.000Z',
});

void test('chips preserve AND boundaries, group identity, and editable empty groups', () => {
  const first = rule('first');
  const nested = group('nested', 'or', rule('second'), rule('third'));
  const empty = group('empty', 'and');
  const filter = group('root', 'and', first, nested, empty);
  assert.deepEqual(databaseFilterChips(filter), [
    { kind: 'rule', node: first, depth: 0, root: false },
    { kind: 'group', node: nested, depth: 1, root: false },
    { kind: 'group', node: empty, depth: 1, root: false },
  ]);
  assert.equal(databaseFilterChips(filter)[1].node, nested);
  assert.deepEqual(databaseFilterChips(), []);
  assert.deepEqual(databaseFilterChips(group('none', 'and')), []);
  assert.deepEqual(databaseFilterChips(group('none', 'or')), []);
});

void test('OR roots stay one chip instead of turning their children into AND conditions', () => {
  const filter = group('root', 'or', rule('a'), rule('b'));
  assert.deepEqual(databaseFilterChips(filter), [
    { kind: 'group', node: filter, depth: 0, root: true },
  ]);
});

void test('quick filters append immutably with typed operators and unfinished values', () => {
  const first = appendDatabaseQuickFilter(undefined, title);
  assert.equal(first.conjunction, 'and');
  assert.equal(first.rules[0].propertyId, 'title');
  assert.equal(first.rules[0].operator, 'contains');
  assert.equal(first.rules[0].value, undefined);
  const checked = appendDatabaseQuickFilter(first, {
    id: 'checked',
    name: 'Checked',
    type: 'checkbox',
  });
  assert.equal(checked.id, first.id);
  assert.equal(checked.rules[0], first.rules[0]);
  assert.equal(checked.rules[1].operator, 'eq');
  assert.equal(checked.rules[1].value, true);
  assert.equal(first.rules.length, 1);
  const date = appendDatabaseQuickFilter(undefined, {
    id: 'date',
    name: 'Date',
    type: 'date',
  }).rules[0];
  assert.equal(date.operator, 'eq');
  assert.equal(date.value, undefined);
});

void test('adding a quick filter wraps OR in AND without changing its original semantics', () => {
  const source = group('root', 'or', rule('a', 'red'), rule('b', 'blue'));
  const next = appendDatabaseQuickFilter(source, title);
  assert.equal(next.conjunction, 'and');
  assert.notEqual(next.id, source.id);
  assert.equal(next.rules[0], source);
  for (const name of ['red item', 'blue item', 'green item'])
    assert.equal(
      matchesDatabaseFilter(record(name), [], next),
      matchesDatabaseFilter(record(name), [], source),
    );
  next.rules[1] = { ...next.rules[1], value: 'item' };
  assert.equal(matchesDatabaseFilter(record('red item'), [], next), true);
  assert.equal(matchesDatabaseFilter(record('red'), [], next), false);
  assert.equal(source.rules.length, 2);
});

void test('advanced filters add a separately editable AND group and retain existing IDs', () => {
  const source = group('root', 'and', rule('a'));
  const result = appendDatabaseAdvancedFilter(source);
  assert.equal(result.filter.id, source.id);
  assert.equal(result.filter.rules[0], source.rules[0]);
  const advanced = result.filter.rules[1];
  assert.equal(advanced.id, result.groupId);
  assert.equal(advanced.conjunction, 'and');
  assert.equal(advanced.rules[0].propertyId, 'title');
  assert.equal(advanced.rules[0].operator, 'contains');
  assert.equal(advanced.rules[0].value, undefined);
  const sourceOr = { ...source, conjunction: 'or' };
  assert.equal(
    appendDatabaseAdvancedFilter(sourceOr).filter.rules[0],
    sourceOr,
  );
});

void test('wrapping OR never silently exceeds two nested group levels or changes OR to AND', () => {
  const atDepthOne = group('root', 'or', group('nested', 'and', rule('a')));
  assert.ok(appendDatabaseQuickFilter(atDepthOne, title));
  assert.ok(appendDatabaseAdvancedFilter(atDepthOne));
  const atDepthTwo = group(
    'root',
    'or',
    group('nested', 'and', group('deep', 'or', rule('a'))),
  );
  assert.equal(appendDatabaseQuickFilter(atDepthTwo, title), null);
  assert.equal(appendDatabaseAdvancedFilter(atDepthTwo), null);
  assert.equal(atDepthTwo.conjunction, 'or');
  assert.equal(atDepthTwo.rules[0].rules[0].id, 'deep');
  assert.ok(
    appendDatabaseAdvancedFilter({ ...atDepthTwo, conjunction: 'and' }),
  );
});

void test('append helpers enforce 40 rules and 99 nodes including wrappers and empty groups', () => {
  const source = group(
    'root',
    'and',
    ...Array.from({ length: 39 }, (_, i) => rule(`r${i}`)),
  );
  const full = appendDatabaseQuickFilter(source, title);
  assert.equal(full.rules.length, 40);
  assert.equal(appendDatabaseQuickFilter(full, title), null);
  assert.equal(appendDatabaseAdvancedFilter(full), null);
  assert.ok(appendDatabaseAdvancedFilter(source));
  const manyNodes = group(
    'root',
    'and',
    ...Array.from({ length: 97 }, (_, i) => group(`g${i}`, 'and')),
  );
  assert.ok(appendDatabaseQuickFilter(manyNodes, title));
  assert.equal(appendDatabaseAdvancedFilter(manyNodes), null);
  assert.equal(
    appendDatabaseQuickFilter({ ...manyNodes, conjunction: 'or' }, title),
    null,
  );
});

void test('replacement preserves conjunctions, ancestor IDs, and untouched object identities', () => {
  const original = rule('a');
  const untouched = rule('b');
  const nested = group('nested', 'or', original, untouched);
  const sibling = group('sibling', 'and', rule('c'));
  const filter = group('root', 'and', nested, sibling);
  const edited = { ...original, value: 'edited' };
  const next = replaceDatabaseFilterNode(filter, original.id, edited);
  assert.equal(next.id, filter.id);
  assert.equal(next.rules[0].id, nested.id);
  assert.equal(next.rules[0].conjunction, 'or');
  assert.equal(next.rules[0].rules[0], edited);
  assert.equal(next.rules[0].rules[1], untouched);
  assert.equal(next.rules[1], sibling);
  assert.equal(original.value, 'a');
  assert.equal(replaceDatabaseFilterNode(filter, 'missing', edited), filter);
});

void test('deletion prunes only newly empty ancestors without flattening surviving groups', () => {
  const keepEmpty = group('keep-empty', 'or');
  const only = rule('only');
  const nested = group('nested', 'or', group('deep', 'and', only));
  const survivor = group('survivor', 'and', rule('other'));
  const filter = group('root', 'or', nested, keepEmpty, survivor);
  const next = replaceDatabaseFilterNode(filter, only.id, undefined);
  assert.equal(next.id, filter.id);
  assert.equal(next.conjunction, 'or');
  assert.deepEqual(next.rules, [keepEmpty, survivor]);
  assert.equal(next.rules[1], survivor);
  assert.equal(
    replaceDatabaseFilterNode(group('root', 'and', nested), only.id, undefined),
    undefined,
  );
  assert.equal(
    replaceDatabaseFilterNode(filter, filter.id, undefined),
    undefined,
  );
  const empty = group(nested.id, 'or');
  assert.equal(
    replaceDatabaseFilterNode(filter, nested.id, empty).rules[0],
    empty,
  );
});

void test('replacement refuses duplicate IDs, invalid root leaves, and over-limit trees', () => {
  const original = rule('a');
  const other = rule('b');
  const filter = group('root', 'and', original, other);
  assert.equal(replaceDatabaseFilterNode(filter, 'a', { ...other }), filter);
  assert.equal(replaceDatabaseFilterNode(filter, 'root', rule('leaf')), filter);
  const tooDeep = group(
    'one',
    'and',
    group('two', 'and', group('three', 'and', rule('last'))),
  );
  assert.equal(replaceDatabaseFilterNode(filter, 'a', tooDeep), filter);
  const tooMany = group(
    'replacement',
    'and',
    ...Array.from({ length: 40 }, (_, i) => rule(`replacement-${i}`)),
  );
  assert.equal(replaceDatabaseFilterNode(filter, 'a', tooMany), filter);
});
