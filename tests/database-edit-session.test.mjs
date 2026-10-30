import assert from 'node:assert/strict';
import test from 'node:test';
import { createDatabaseEditSession } from '../app/database-edit-session.ts';
import {
  createDatabase,
  newDatabaseRecord,
  patchDatabaseRecord,
} from '../app/database-model.ts';

void test('flushing before record switching preserves the originating record and complete text', () => {
  const session = createDatabaseEditSession();
  let database = createDatabase('Draft safety', 'zh');
  database.properties.push({ id: 'body', name: '通知原文', type: 'text' });
  const first = { ...newDatabaseRecord(database), title: 'Same title' };
  const second = { ...newDatabaseRecord(database), title: 'Same title' };
  database.records = [first, second];
  const originalView = structuredClone(database.view);
  const text = (
    '完整通知：中文输入与多行文本应保留。\n' + 'Long text '.repeat(40)
  ).repeat(12);
  let saved = '';
  let writes = 0;
  const unregister = session.register(() => {
    if (saved === text) return;
    database = patchDatabaseRecord(database, first.id, {
      values: { body: text },
    });
    saved = text;
    writes += 1;
  });
  session.flush();
  unregister();
  session.flush();
  assert.equal(database.records[0].values.body, text);
  assert.equal(database.records[1].values.body, undefined);
  assert.equal(writes, 1);
  assert.deepEqual(database.view, originalView);
});

void test('a nested flush cannot reenter pending commit callbacks', () => {
  const session = createDatabaseEditSession();
  const calls = [];
  session.register(() => {
    calls.push('first');
    session.flush();
  });
  session.register(() => calls.push('second'));
  session.flush();
  assert.deepEqual(calls, ['first', 'second']);
});

void test('unregistered drafts are skipped even when a flush snapshot already contains them', () => {
  const session = createDatabaseEditSession();
  const calls = [];
  session.register(() => {
    calls.push('first');
    unregisterSecond();
  });
  const unregisterSecond = session.register(() => calls.push('removed'));
  session.flush();
  unregisterSecond();
  session.flush();
  assert.deepEqual(calls, ['first', 'first']);
});

void test('newly registered editors wait for the next transition', () => {
  const session = createDatabaseEditSession();
  const calls = [];
  const late = () => calls.push('new view');
  const unregister = session.register(() => {
    calls.push('old view');
    session.register(late);
  });
  session.flush();
  assert.deepEqual(calls, ['old view']);
  unregister();
  session.flush();
  assert.deepEqual(calls, ['old view', 'new view']);
});

void test('one failed draft is reported while independent drafts still commit and the session recovers', () => {
  const session = createDatabaseEditSession();
  const invalid = new Error('The number is incomplete.');
  let committed = 0;
  const unregister = session.register(() => {
    throw invalid;
  });
  session.register(() => committed++);
  assert.throws(
    () => session.flush(),
    (error) => error === invalid,
  );
  assert.equal(committed, 1);
  unregister();
  session.flush();
  assert.equal(committed, 2);
});

void test('multiple draft failures retain every cause and prevent a successful transition', () => {
  const session = createDatabaseEditSession();
  const errors = [new Error('Invalid date'), new Error('Invalid number')];
  for (const error of errors)
    session.register(() => {
      throw error;
    });
  assert.throws(
    () => session.flush(),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, errors);
      return true;
    },
  );
});
