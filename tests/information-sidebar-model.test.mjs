import test from 'node:test';
import assert from 'node:assert/strict';
import {
  informationSidebarKey, addInformationSidebarCard, removeInformationSidebarCard,
  resolveInformationSidebarEntries, readInformationSidebarReferences, searchInformationSidebarCards,
} from '../app/information-sidebar-model.ts';

const card = (id, title, body = '') => ({ id, title, body, kind: 'note', x: 0, y: 0, width: 400 });
const boards = [
  { id: 'research', title: '研究资料', cards: [card('a', '用户访谈', '用户反馈需要更清楚的来源。'), card('b', 'Next steps', 'Compare the evidence')], edges: [] },
  { id: 'ideas', title: '设计想法', cards: [card('a', '另一个同名 ID', '独立的卡片')], edges: [] },
];

void test('new entries appear first, reference originals across boards and duplicate adds are no-ops', () => {
  const first = addInformationSidebarCard([], 'research', 'a');
  assert.strictEqual(addInformationSidebarCard(first, 'research', 'a'), first);
  const second = addInformationSidebarCard(first, 'ideas', 'a');
  assert.deepEqual(second, [{ boardId: 'ideas', cardId: 'a' }, { boardId: 'research', cardId: 'a' }]);
  const entries = resolveInformationSidebarEntries(second, boards);
  assert.equal(entries.length, 2);
  assert.strictEqual(entries[0].card, boards[1].cards[0]);
  assert.strictEqual(entries[1].card, boards[0].cards[0]);
  assert.notEqual(entries[0].key, entries[1].key);
  assert.equal(entries[0].boardTitle, '设计想法');
});

void test('removing a sidebar reference leaves all original cards untouched', () => {
  const refs = [{ boardId: 'research', cardId: 'a' }, { boardId: 'ideas', cardId: 'a' }];
  const snapshot = structuredClone(boards);
  assert.deepEqual(removeInformationSidebarCard(refs, informationSidebarKey('research', 'a')), [refs[1]]);
  assert.deepEqual(boards, snapshot);
  assert.strictEqual(removeInformationSidebarCard(refs, 'missing'), refs);
});

void test('re-resolving updates the visible source and omits deleted cards', () => {
  const refs = [{ boardId: 'research', cardId: 'a' }, { boardId: 'research', cardId: 'b' }];
  const updated = [{ ...boards[0], cards: [{ ...boards[0].cards[0], body: '新的观点' }] }];
  const entries = resolveInformationSidebarEntries(refs, updated);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].card.body, '新的观点');
  assert.equal(resolveInformationSidebarEntries(refs, []).length, 0);
});

void test('persistence drops malformed and duplicate references without trusting card data', () => {
  const valid = { boardId: 'research', cardId: 'a' };
  assert.deepEqual(readInformationSidebarReferences(JSON.stringify([valid, valid, null, {}, { boardId: 1, cardId: 'b' }, { boardId: '', cardId: 'b' }])), [valid]);
  for (const raw of [null, '', '{', '{}', '"text"']) assert.deepEqual(readInformationSidebarReferences(raw), []);
});

void test('persistence preserves the saved order when removing duplicate references', () => {
  const refs = [{ boardId: 'ideas', cardId: 'a' }, { boardId: 'research', cardId: 'a' }, { boardId: 'research', cardId: 'b' }];
  assert.deepEqual(readInformationSidebarReferences(JSON.stringify([...refs, refs[0], refs[1]])), refs);
  const added = addInformationSidebarCard(refs, 'ideas', 'new');
  assert.deepEqual(readInformationSidebarReferences(JSON.stringify(added)), added);
});

void test('sidebar keys are unambiguous even when identifiers contain separators', () => {
  assert.notEqual(informationSidebarKey('a:b', 'c'), informationSidebarKey('a', 'b:c'));
  assert.notEqual(informationSidebarKey('a', 'b'), informationSidebarKey('b', 'a'));
});

void test('search matches names, source text and board with all terms and bounded results', () => {
  assert.equal(searchInformationSidebarCards(boards, '研究 来源')[0].card.id, 'a');
  assert.equal(searchInformationSidebarCards(boards, 'ＮＥＸＴ evidence')[0].card.id, 'b');
  assert.equal(searchInformationSidebarCards(boards, 'missing').length, 0);
  assert.equal(searchInformationSidebarCards(boards, '', 1).length, 1);
  const excerpt = { ...card('excerpt', '摘录'), pdfExcerpt: { sourceId: 'pdf', sourceTitle: '阅读材料', pdf: { name: 'Paper.pdf' }, mark: { text: 'A special source quotation', fragments: [{ page: 3 }], color: '#fff', id: 'mark' } } };
  const results = searchInformationSidebarCards([{ id: 'source', title: 'Sources', cards: [excerpt], edges: [] }], 'Paper quotation');
  assert.strictEqual(results[0].card, excerpt);
});
