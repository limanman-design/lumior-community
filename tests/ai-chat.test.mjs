import test from 'node:test';
import assert from 'node:assert/strict';
import { aiContext, aiResearchRefs } from '../app/ai-context.ts';
import { aiConversationHistory, aiQuestionReferences, newAiChat, restoredAiHistory } from '../app/ai-chat-store.ts';

const card = (id, text = 'Card text') => ({ id, title: `Card ${id}`, kind: 'note', body: text });

void test('board context includes every card and explicit references preserve citation order', () => {
  const cards = Array.from({ length: 18 }, (_, index) => card(String(index)));
  const board = aiContext(cards, []);
  assert.equal(board.scope, 'board'); assert.equal(board.eligible, 18); assert.equal(board.sources.length, 18);
  const selected = aiContext(cards, ['8', '2', 'deleted']);
  assert.equal(selected.scope, 'selected'); assert.equal(selected.eligible, 2);
  assert.deepEqual(selected.sources.map(source => source.id), ['8', '2']);
  assert.equal(aiContext(cards, ['deleted']).sources.length, 0); // Never silently substitute the board.
});

void test('context uses edited rich text and excerpts, with honest truncation and no media payload', () => {
  const edited = { ...card('edited', 'stale text'), blocks: [{ type: 'paragraph', content: 'Updated note' }] };
  const excerpt = { ...card('excerpt', 'Comment'), pdfExcerpt: { mark: { text: 'Original passage' } } };
  const image = { ...card('image'), kind: 'image', image: 'private-image-url' };
  const context = aiContext([edited, excerpt, image, card('long', 'x'.repeat(5000))], []);
  assert.ok(context.sources[0].text.includes('Updated note')); assert.ok(!context.sources[0].text.includes('stale text'));
  assert.ok(context.sources[1].text.includes('Original passage'));
  assert.ok(!JSON.stringify(context).includes('private-image-url'));
  assert.ok(context.sources[3].text.length > 5000); assert.equal(context.sources[3].truncated, false);
  assert.equal(context.characters, context.sources.reduce((sum, source) => sum + source.text.length, 0));
});

void test('restored conversations belong to their board and preserve partial answers, drafts and original evidence', () => {
  const chat = newAiChat('board-a', ['source'], 123);
  chat.draft = 'Next question'; chat.messages = [{ id: 'answer', role: 'assistant', live: true, text: 'Partial answer', status: 'streaming', context: aiContext([card('source')], []) }];
  const record = { version: 1, boardId: 'board-a', activeId: chat.id, chats: [chat] };
  const restored = restoredAiHistory(JSON.parse(JSON.stringify(record)), 'board-a');
  assert.equal(restored.activeId, chat.id); assert.equal(restored.chats[0].draft, 'Next question');
  assert.equal(restored.chats[0].messages[0].status, 'interrupted'); assert.equal(restored.chats[0].messages[0].text, 'Partial answer');
  assert.deepEqual(restored.chats[0].messages[0].context, chat.messages[0].context);
  assert.equal(chat.messages[0].status, 'streaming');
  assert.throws(() => restoredAiHistory(record, 'board-b'), /原记录已保留/);
  assert.equal(restoredAiHistory(null, 'board-b').chats.length, 0);
  const preparing = { ...record, chats: [{ ...chat, messages: [{ ...chat.messages[0], text: '', status: 'preparing', context: undefined }] }] };
  const interrupted = restoredAiHistory(preparing, 'board-a').chats[0].messages[0];
  assert.equal(interrupted.status, 'interrupted'); assert.equal(interrupted.context, undefined);
});

void test('regeneration does not repeat the question, incomplete responses or demo answers in history', () => {
  const chat = newAiChat('board');
  const user = (id, live = true) => ({ id, role: 'user', live, text: id });
  const answer = (id, replyTo, status = 'complete', live = true) => ({ id, replyTo, role: 'assistant', live, text: id, status });
  chat.messages = [user('q1'), answer('a1', 'q1'), answer('a1-regenerated', 'q1'), user('demo', false), answer('demo-answer', 'demo', 'complete', false), user('q2'), answer('partial', 'q2', 'stopped')];
  assert.deepEqual(aiConversationHistory(chat), [{ role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1-regenerated' }, { role: 'user', content: 'q2' }]);
  assert.deepEqual(aiConversationHistory(chat, 'q2'), [{ role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1-regenerated' }]);
  assert.deepEqual(aiConversationHistory(chat, 'missing'), []);
});

void test('restoring a finished checked answer during local presentation keeps the full answer without replay', () => {
  const chat = newAiChat('board');
  const context = { ...aiContext([card('source')], []), coverage: { task: 'summary', availableCards: 1, targetCards: 1, readCards: 1, readPassages: 1, totalPassages: 1, complete: true, verified: true } };
  const full = 'Complete checked answer [Lumior:1].';
  const answer = { id: 'answer', role: 'assistant', live: true, text: full, status: 'streaming', reason: 'stop', context };
  const restore = fields => restoredAiHistory({ version: 1, boardId: 'board', activeId: chat.id, chats: [{ ...chat, messages: [{ ...answer, ...fields }] }] }, 'board').chats[0].messages[0];
  assert.equal(restore({}).status, 'complete'); assert.equal(restore({}).text, full);
  assert.deepEqual(restore({}).context, context);
  assert.equal(restore({ reason: undefined }).status, 'interrupted', 'verification alone cannot fake a delivered completion');
  assert.equal(restore({ context: { ...context, coverage: { ...context.coverage, verified: false } } }).status, 'interrupted');
  assert.equal(answer.status, 'streaming', 'restoration does not change the original record');
});

void test('conversation context keeps complete turns and resolves followups beyond the old eight-message window', () => {
  const chat = newAiChat('board');
  chat.messages = Array.from({ length: 10 }, (_, index) => [{ id: `q${index}`, role: 'user', live: true, text: 'x'.repeat(7000) }, { id: `a${index}`, replyTo: `q${index}`, role: 'assistant', live: true, status: 'complete', text: 'y'.repeat(7000) }]).flat();
  const history = aiConversationHistory(chat);
  assert.equal(history.length, 20); assert.ok(history.every(turn => turn.content.length === 7000));
});

void test('regeneration revisits the original research scope, including previously unread cards', () => {
  const context = aiContext([card('first'), card('unread')], []);
  context.sources = context.sources.slice(0, 1); // Evidence ledger only read the first card.
  assert.deepEqual(aiResearchRefs(context, ['different-selection']), ['first', 'unread']);
  assert.equal(aiContext([card('first'), card('unread')], aiResearchRefs(context, [])).sources.length, 2);
  assert.deepEqual(aiResearchRefs({ ...context, cardIds: undefined, scope: 'selected' }, []), ['first']);
});

void test('each question keeps its own reference snapshot when later draft references change', () => {
  const chat = newAiChat('board');
  const question = { id: 'q1', role: 'user', live: true, text: 'Read this', createdAt: 1, references: [{ id: 'first', title: 'Original title', kind: 'pdf', fileKey: 'original.pdf' }] };
  chat.messages = [question]; chat.refs = ['new-selection'];
  const restored = restoredAiHistory(JSON.parse(JSON.stringify({ version: 1, boardId: 'board', activeId: chat.id, chats: [chat] })), 'board').chats[0];
  assert.deepEqual(aiQuestionReferences(restored.messages[0], restored.messages), question.references);
  assert.deepEqual(restored.refs, ['new-selection']);
  const boardQuestion = { ...question, references: [] };
  assert.deepEqual(aiQuestionReferences(boardQuestion, [boardQuestion, { id: 'a1', replyTo: 'q1', context: aiContext([card('first')], ['first']) }]), []);
});

void test('old question references come from saved answer evidence without inventing unread titles', () => {
  const question = { id: 'old-q', role: 'user', text: 'Read it' };
  const context = aiContext([card('old-source'), card('unread')], ['old-source', 'unread']);
  context.sources = context.sources.slice(0, 1);
  const answer = { id: 'old-a', role: 'assistant', replyTo: question.id, context };
  assert.deepEqual(aiQuestionReferences(question, [question, answer]), [{ id: 'old-source', title: 'Card old-source', kind: 'note', fileKey: undefined }]);
});

void test('new chats do not create a user-controlled effort preference', () => {
  const chat = newAiChat('board');
  assert.equal(Object.hasOwn(chat, 'reasoningEffort'), false);
  const history = { version: 1, boardId: 'board', activeId: chat.id, chats: [chat] };
  assert.equal(restoredAiHistory(history, 'board').chats[0].reasoningEffort, undefined);
});

void test('old legal effort values remain portable metadata without creating a preference on new chats', () => {
  for (const reasoningEffort of ['low', 'high', 'max']) {
    const chat = { ...newAiChat('board'), reasoningEffort };
    const history = { version: 1, boardId: 'board', activeId: chat.id, chats: [chat] };
    assert.equal(restoredAiHistory(JSON.parse(JSON.stringify(history)), 'board').chats[0].reasoningEffort, reasoningEffort);
  }
});

void test('real process records and legacy effort metadata survive reload while unfinished generation stops', () => {
  const chat = newAiChat('board'); chat.reasoningEffort = 'low';
  chat.messages = [{ id: 'answer', role: 'assistant', text: '', live: true, status: 'pending', createdAt: 123, process: [{ message: 'Reading page 2', elapsed: 12 }, { message: 'Checking sources', elapsed: 25 }] }];
  const history = { version: 1, boardId: 'board', activeId: chat.id, chats: [chat] };
  const restored = restoredAiHistory(JSON.parse(JSON.stringify(history)), 'board').chats[0];
  assert.equal(restored.reasoningEffort, 'low');
  assert.equal(restored.messages[0].status, 'interrupted'); assert.equal(restored.messages[0].elapsed, 25);
  assert.deepEqual(restored.messages[0].process, chat.messages[0].process);
  assert.equal(chat.messages[0].status, 'pending');
  chat.reasoningEffort = 'invalid'; assert.equal(restoredAiHistory(history, 'board').chats[0].reasoningEffort, undefined);
});

void test('new source format survives reload while legacy messages retain their own source format', () => {
  const chat = newAiChat('board');
  chat.messages = [
    { id: 'old', role: 'assistant', text: 'Old [1].', live: true, status: 'complete' },
    { id: 'new', role: 'assistant', text: 'Paper [99]; source [Lumior:1].', citationFormat: 'lumior-v1', live: true, status: 'complete' },
  ];
  const history = { version: 1, boardId: 'board', activeId: chat.id, chats: [chat] };
  const messages = restoredAiHistory(JSON.parse(JSON.stringify(history)), 'board').chats[0].messages;
  assert.equal(messages[0].citationFormat, undefined);
  assert.equal(messages[1].citationFormat, 'lumior-v1');
  assert.equal(messages[1].text, chat.messages[1].text);
  chat.messages[1].citationFormat = 'unknown-future-format';
  assert.throws(() => restoredAiHistory(history, 'board'), /原记录已保留/);
});

void test('completed history never carries another answer source marker into the new source namespace', () => {
  const chat = newAiChat('board');
  chat.messages = [
    { id: 'q1', role: 'user', text: 'Old question', live: true },
    { id: 'a1', replyTo: 'q1', role: 'assistant', text: 'Old [1].', live: true, status: 'complete' },
    { id: 'q2', role: 'user', text: 'New question', live: true },
    { id: 'a2', replyTo: 'q2', role: 'assistant', text: 'Paper [99]; source [Lumior:1].', citationFormat: 'lumior-v1', live: true, status: 'complete' },
  ];
  assert.equal(aiConversationHistory(chat)[1].content, 'Old （历史来源 1）.');
  assert.equal(aiConversationHistory(chat)[3].content, 'Paper [99]; source （历史来源 1）.');
  assert.equal(chat.messages[1].text, 'Old [1].');
  assert.equal(chat.messages[3].text, 'Paper [99]; source [Lumior:1].');
});
