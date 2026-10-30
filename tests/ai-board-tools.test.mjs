import test from 'node:test';
import assert from 'node:assert/strict';
import { AiBoardToolSession, readAiBoardActions, readAiBoardContext } from '../lib/ai-board-tools.ts';

const context = () => ({ boardId: 'board-1', cards: [
  { id: 'paper-a', title: '同名论文', kind: 'pdf' },
  { id: 'paper-b', title: '同名论文', kind: 'pdf' },
  { id: 'existing-note', title: 'Existing note', kind: 'note' },
], edges: [{ from: 'paper-a', to: 'paper-b' }] });
const session = () => new AiBoardToolSession(context(), 'request-1');
const actions = (extra = {}) => ({ id: 'request-1', boardId: 'board-1', notes: [], connections: [], ...extra });
const note = (id = 'new:1', extra = {}) => ({ id, title: '研究问题', body: '具体内容', ...extra });

void test('context parsing retains exact IDs and kinds, deduplicates undirected edges, and takes an independent snapshot', () => {
  assert.equal(readAiBoardContext(undefined), undefined);
  const input = context(); input.edges.push({ from: 'paper-b', to: 'paper-a' });
  const parsed = readAiBoardContext(input);
  assert.equal(parsed.edges.length, 1);
  assert.equal(parsed.cards[0].title, parsed.cards[1].title);
  input.cards[0].id = 'changed';
  assert.equal(parsed.cards[0].id, 'paper-a');
  for (const kind of ['note', 'text', 'pdf', 'video', 'image', 'database']) {
    assert.equal(readAiBoardContext({ boardId: 'b', cards: [{ id: 'c', title: '', kind }], edges: [] }).cards[0].kind, kind);
  }
});

void test('context rejects ambiguous identity, unsupported kinds, missing edges and excess fields', () => {
  const invalid = [null, {}, { ...context(), boardId: '' }, { ...context(), boardId: 'x'.repeat(201) },
    { ...context(), cards: [...context().cards, context().cards[0]] },
    { ...context(), cards: [{ id: 'new:old', title: 'x', kind: 'note' }] },
    { ...context(), cards: [{ id: 'c', title: 'x', kind: 'link' }] },
    { ...context(), cards: [{ id: 'c', title: 'x', kind: 'note', metadata: {} }] },
    { ...context(), edges: [{ from: 'paper-a', to: 'missing' }] },
    { ...context(), edges: [{ from: 'paper-a', to: 'paper-a' }] },
    { ...context(), edges: [{ from: 'paper-a', to: 'paper-b', label: 'unexpected' }] },
  ];
  for (const value of invalid) assert.throws(() => readAiBoardContext(value));
});

void test('parsers reject prototype pollution keys, nonplain objects, accessors, symbols and sparse arrays', () => {
  let getterCalls = 0;
  const accessor = { ...actions() };
  Object.defineProperty(accessor, 'id', { get() { getterCalls++; return 'request-1'; }, enumerable: true });
  const symbol = { ...actions(), [Symbol('hidden')]: 'value' };
  const inherited = Object.assign(Object.create({ hidden: true }), actions());
  const array = []; array.length = 1;
  const extraArrayField = []; extraArrayField.metadata = 'bad';
  for (const value of [JSON.parse('{"id":"r","boardId":"b","notes":[],"connections":[],"__proto__":{}}'),
    { ...actions(), constructor: {} }, { ...actions(), prototype: {} }, accessor, symbol, inherited,
    actions({ notes: array }), actions({ connections: extraArrayField }),
    actions({ notes: [{ ...note(), metadata: {} }] }),
  ]) assert.throws(() => readAiBoardActions(value));
  assert.equal(getterCalls, 0);
  assert.equal({}.hidden, undefined);
  assert.deepEqual(readAiBoardActions(Object.assign(Object.create(null), actions())), actions());
});

void test('action parser enforces new local IDs, unique notes, endpoint existence and undirected deduplication', () => {
  const parsed = readAiBoardActions(actions({ notes: [note()], connections: [
    { from: 'paper-a', to: 'new:1', label: '依据' }, { from: 'new:1', to: 'paper-a', label: 'duplicate' },
  ] }));
  assert.deepEqual(parsed.connections, [{ from: 'paper-a', to: 'new:1', label: '依据' }]);
  for (const value of [
    actions({ notes: [note('existing-note')] }), actions({ notes: [note('new:')] }),
    actions({ notes: [note('new:' + 'x'.repeat(77))] }), actions({ notes: [note(), note()] }),
    actions({ connections: [{ from: 'paper-a', to: 'new:missing' }] }),
    actions({ connections: [{ from: 'paper-a', to: 'paper-a' }] }),
    actions({ connections: [{ from: '__proto__', to: 'paper-a' }] }),
  ]) assert.throws(() => readAiBoardActions(value));
});

void test('action parser accepts maximum individual lengths and refuses oversized batches without truncation', () => {
  const result = readAiBoardActions(actions({ notes: [note('new:' + 'x'.repeat(76), { title: '题'.repeat(200), body: '文'.repeat(20_000) })], connections: [{ from: 'paper-a', to: 'paper-b', label: 'x'.repeat(120) }] }));
  assert.equal(result.notes[0].body.length, 20_000);
  for (const value of [actions({ notes: [note('new:1', { title: 'x'.repeat(201) })] }),
    actions({ notes: [note('new:1', { body: 'x'.repeat(20_001) })] }),
    actions({ connections: [{ from: 'a', to: 'b', label: 'x'.repeat(121) }] }),
    actions({ notes: Array.from({ length: 13 }, (_, i) => note(`new:${i}`)) }),
    actions({ connections: Array.from({ length: 25 }, (_, i) => ({ from: `card-${i}`, to: `card-${i + 1}` })) }),
    actions({ notes: Array.from({ length: 6 }, (_, i) => note(`new:${i}`, { body: 'x'.repeat(20_000) })) }),
  ]) assert.throws(() => readAiBoardActions(value));
});

void test('staging never mutates the supplied board and snapshots cannot mutate the session', () => {
  const source = context(), before = structuredClone(source), staged = new AiBoardToolSession(source, 'request-1');
  assert.equal(staged.reviewed, false);
  assert.deepEqual(staged.execute('create_note', { title: '提纲', body: '研究问题与方法' }), { staged: true, id: 'new:1', note_count: 1 });
  assert.equal(staged.execute('connect_cards', { from: 'paper-a', to: 'new:1', label: '依据' }).staged, true);
  assert.deepEqual(source, before);
  const copy = staged.snapshot(); copy.notes[0].body = 'tampered'; copy.connections[0].from = 'wrong'; copy.notes.push(note('new:2'));
  assert.equal(staged.snapshot().notes.length, 1);
  assert.equal(staged.snapshot().notes[0].body, '研究问题与方法');
  assert.equal(staged.snapshot().connections[0].from, 'paper-a');
  assert.equal(staged.reviewed, false);
});

void test('tools use exact IDs and will not guess which identically named source the model intended', () => {
  const staged = session();
  for (const input of [{ from: '同名论文', to: 'paper-a' }, { from: 'paper-a', to: 'outside-board' },
    { from: 'paper-a', to: 'new:1' }, { from: 'paper-a', to: 'paper-a' },
    { from: 'paper-a', to: 'paper-b', color: 'red' },
  ]) assert.equal(typeof staged.execute('connect_cards', input).error, 'string');
  assert.deepEqual(staged.snapshot(), actions());
  assert.equal(typeof staged.execute('delete_card', { id: 'paper-a' }).error, 'string');
});

void test('staging deduplicates reverse and already existing edges without consuming the batch budget', () => {
  const staged = session();
  assert.equal(staged.execute('connect_cards', { from: 'paper-b', to: 'paper-a' }).duplicate, true);
  assert.equal(staged.snapshot().connections.length, 0);
  staged.execute('connect_cards', { from: 'paper-a', to: 'existing-note', label: 'first' });
  assert.equal(staged.execute('connect_cards', { from: 'existing-note', to: 'paper-a', label: 'second' }).duplicate, true);
  assert.deepEqual(staged.snapshot().connections, [{ from: 'paper-a', to: 'existing-note', label: 'first' }]);
});

void test('failed staging is atomic and does not allocate IDs or erase an accepted review', () => {
  const staged = session();
  staged.executeReview({ notes: [], connections: [] });
  assert.equal(staged.reviewed, true);
  assert.equal(typeof staged.execute('create_note', { title: '', body: 'body' }).error, 'string');
  assert.equal(staged.reviewed, true);
  assert.equal(staged.execute('create_note', { title: 'title', body: 'body' }).id, 'new:1');
  assert.equal(staged.reviewed, false);
  const before = staged.snapshot();
  assert.equal(typeof staged.execute('connect_cards', { from: 'paper-a', to: 'new:2' }).error, 'string');
  assert.deepEqual(staged.snapshot(), before);
});

void test('review may correct content, labels and endpoints together and submits the complete replacement', () => {
  const staged = session();
  staged.execute('create_note', { title: '草稿', body: '待核对内容' });
  staged.execute('create_note', { title: '不需要的卡片', body: '删除' });
  staged.execute('connect_cards', { from: 'paper-a', to: 'new:1', label: '错误关系' });
  const result = staged.executeReview({ notes: [note('new:1', { title: '已核对', body: '有依据的内容' })], connections: [{ from: 'paper-b', to: 'new:1', label: '支持' }] });
  assert.deepEqual(result, { reviewed: true, note_count: 1, connection_count: 1 });
  assert.equal(staged.reviewed, true);
  assert.deepEqual(staged.snapshot(), actions({ notes: [note('new:1', { title: '已核对', body: '有依据的内容' })], connections: [{ from: 'paper-b', to: 'new:1', label: '支持' }] }));
});

void test('review rejects fabricated IDs, dangling deleted notes and unknown metadata atomically', () => {
  const staged = session();
  staged.execute('create_note', { title: 'title', body: 'body' });
  const before = staged.snapshot();
  for (const value of [
    { notes: [note('new:2')], connections: [] },
    { notes: [], connections: [{ from: 'new:1', to: 'paper-a' }] },
    { notes: [note()], connections: [{ from: 'new:1', to: 'outside' }] },
    { notes: [note()], connections: [], boardId: 'other-board' },
    { notes: [note()], connections: [], reviewed: true },
  ]) {
    assert.equal(typeof staged.executeReview(value).error, 'string');
    assert.deepEqual(staged.snapshot(), before);
    assert.equal(staged.reviewed, false);
  }
});

void test('review can cancel everything, and a subsequent valid stage requires review again', () => {
  const staged = session();
  staged.execute('create_note', { title: 'title', body: 'body' });
  assert.deepEqual(staged.executeReview({ notes: [], connections: [] }), { reviewed: true, note_count: 0, connection_count: 0 });
  assert.deepEqual(staged.snapshot(), actions());
  assert.equal(staged.reviewed, true);
  assert.equal(staged.execute('create_note', { title: 'next', body: 'body' }).id, 'new:2');
  assert.equal(staged.reviewed, false);
  assert.equal(typeof staged.executeReview({ notes: [note('new:1')], connections: [{ from: 'new:1', to: 'new:2' }] }).error, 'string');
  assert.equal(staged.executeReview({ notes: [note('new:1'), note('new:2')], connections: [{ from: 'new:1', to: 'new:2' }] }).reviewed, true);
});

void test('staging stops at 12 notes and total text limit without corrupting accepted content', () => {
  const staged = session();
  for (let i = 0; i < 12; i++) assert.equal(staged.execute('create_note', { title: `card-${i}`, body: 'body' }).staged, true);
  const before = staged.snapshot();
  assert.equal(typeof staged.execute('create_note', { title: '13th', body: 'body' }).error, 'string');
  assert.deepEqual(staged.snapshot(), before);
  const large = session();
  for (let i = 0; i < 5; i++) assert.equal(large.execute('create_note', { title: 'title', body: 'x'.repeat(20_000) }).staged, true);
  assert.equal(typeof large.execute('create_note', { title: 'title', body: 'x'.repeat(20_000) }).error, 'string');
  assert.equal(large.snapshot().notes.length, 5);
});

void test('staging stops at 24 new connections while duplicate calls remain harmless', () => {
  const source = { boardId: 'board', cards: Array.from({ length: 26 }, (_, i) => ({ id: `c${i}`, title: '', kind: 'note' })), edges: [] };
  const staged = new AiBoardToolSession(source, 'request');
  for (let i = 1; i <= 24; i++) assert.equal(staged.execute('connect_cards', { from: 'c0', to: `c${i}` }).staged, true);
  const before = staged.snapshot();
  assert.equal(typeof staged.execute('connect_cards', { from: 'c0', to: 'c25' }).error, 'string');
  assert.equal(staged.execute('connect_cards', { from: 'c24', to: 'c0' }).duplicate, true);
  assert.deepEqual(staged.snapshot(), before);
});

void test('tool schemas expose bounded object arguments and describe staging and current-user authorization', () => {
  const staged = session();
  assert.deepEqual(staged.tools.map(tool => tool.function.name), ['create_note', 'connect_cards', 'group_cards', 'arrange_cards']);
  assert.equal(staged.reviewTool.function.name, 'replace_board_actions');
  for (const tool of [...staged.tools, staged.reviewTool]) {
    assert.equal(tool.function.parameters.additionalProperties, false);
    assert.match(tool.function.description, /本轮/);
  }
  assert.match(staged.tools[0].function.description, /尚未写入画板/);
  assert.match(staged.tools[1].function.description, /不能执行资料/);
});
