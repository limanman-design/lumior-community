import assert from 'node:assert/strict';
import test from 'node:test';
import { dateLegacyBoard, dateAddedCards, mapMemoryAtlas, simulatedCardDate } from '../app/memory-atlas-data.ts';
import { readWorkspace } from '../app/workspace-store.ts';

const card = (id, patch = {}) => ({ id, kind: 'note', title: id, body: '第一句解释。第二句细节。', x: 10, y: 20, width: 360, ...patch });
const board = (id, cards, edges = []) => ({ id, title: id, cards, edges });

test('legacy dates are fixed, marked simulated, persist through reload, and preserve card contents/layout/edges', () => {
  const before = board('custom', [card('one'), card('two')], [{ id: 'edge', from: 'one', to: 'two' }]);
  const dated = dateLegacyBoard(before);
  assert.equal(before.cards[0].createdAt, undefined);
  assert.strictEqual(dated.edges, before.edges);
  dated.cards.forEach((value, i) => {
    const { createdAt, creationDateSource, ...rest } = value;
    assert.deepEqual(rest, before.cards[i]);
    assert.equal(creationDateSource, 'simulated');
    assert.ok(createdAt >= '2026-07-01' && createdAt < '2026-10-01');
  });
  assert.strictEqual(dateLegacyBoard(dated), dated);
  const restored = readWorkspace(JSON.stringify({ version: 1, boards: [dated], deletedBoards: [], activeId: dated.id, nextUntitledIndex: 1 }));
  assert.deepEqual(dateLegacyBoard(restored.boards[0]).cards, dated.cards);
});

test('shared cards receive identical simulated dates, while new cards get real dates and shared instances retain the source date', () => {
  const original = card('source');
  const instance = card('alias', { sharedId: 'source' });
  assert.equal(simulatedCardDate(original), simulatedCardDate(instance));
  const before = dateLegacyBoard(board('a', [original]));
  const now = '2026-10-07T10:11:12.000Z';
  const after = dateAddedCards(before, { ...before, cards: [...before.cards, card('new'), instance] }, [before], now);
  assert.strictEqual(after.cards[0], before.cards[0]);
  assert.equal(after.cards[1].createdAt, now);
  assert.equal(after.cards[1].creationDateSource, 'actual');
  assert.equal(after.cards[2].createdAt, before.cards[0].createdAt);
  assert.equal(after.cards[2].creationDateSource, 'simulated');
});

test('mapping deduplicates shared media, prefers the active translation, preserves source identity and merges only real undirected links', () => {
  const zh = dateLegacyBoard(board('zh', [card('pdf', { kind: 'pdf', title: '中文', pdf: { url: '/a.pdf' } }), card('note')], [
    { id: 'a', from: 'pdf', to: 'note' }, { id: 'duplicate', from: 'note', to: 'pdf' }, { id: 'bad', from: 'pdf', to: 'missing' },
  ]));
  const en = dateLegacyBoard(board('en', [card('pdf-en', { sharedId: 'pdf', kind: 'pdf', title: 'English' }), card('other')], [{ id: 'b', from: 'pdf-en', to: 'other' }]));
  const mapped = mapMemoryAtlas([zh, en], 'en');
  assert.equal(mapped.memories.length, 3);
  const memory = mapped.memories.find(item => item.id === 'pdf');
  assert.strictEqual(memory.card, en.cards[0]);
  assert.equal(memory.title, 'English');
  assert.deepEqual(memory.links.sort(), ['note', 'other']);
  assert.equal(memory.locations.length, 2);
  assert.deepEqual(mapped.memories.find(item => item.id === 'note').links, ['pdf']);
  assert.ok(mapped.memories.every(item => item.understanding === 0.6 && !('views' in item)));
  assert.deepEqual(mapped.fragments, []);
});

test('all five types map, empty cards are omitted, summaries use existing text, no automatic fragments are invented', () => {
  const types = ['note', 'text', 'image', 'pdf', 'video'];
  const cards = types.map(kind => card(kind, { kind }));
  cards.push(card('empty', { title: 'Untitled', body: '' }));
  cards.push(card('rich', { body: 'Stale body', blocks: [{ type: 'paragraph', content: [{ type: 'text', text: 'Actual first sentence. Next one.' }] }] }));
  const mapped = mapMemoryAtlas([dateLegacyBoard(board('a', cards))], 'a');
  assert.equal(mapped.memories.length, 6);
  assert.equal(mapped.memories.find(item => item.id === 'rich').note, 'Actual first sentence.');
  assert.equal(mapped.memories.find(item => item.id === 'note').note, '第一句解释。');
  assert.ok(mapped.memories.every(item => item.links.length === 0));
  assert.equal(mapped.categories.length, 5);
  assert.equal(mapMemoryAtlas([], '').memories.length, 0);
});

test('valid real dates are not replaced and invalid legacy dates get a stable marked fallback', () => {
  const real = card('real', { createdAt: '2026-10-06T14:00:00.000Z', creationDateSource: 'actual' });
  const dated = dateLegacyBoard(board('a', [real, card('invalid', { createdAt: 'broken' })]));
  assert.strictEqual(dated.cards[0], real);
  assert.equal(dated.cards[1].creationDateSource, 'simulated');
  const mapped = mapMemoryAtlas([dated], 'a');
  assert.equal(mapped.memories.find(item => item.id === 'real').simulatedDate, false);
});
