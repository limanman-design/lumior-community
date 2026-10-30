import test from 'node:test';
import assert from 'node:assert/strict';
import { readAiBoardGeneration } from '../lib/ai-board-generation.ts';
import { encodeAiEvent, readAiStream } from '../lib/ai-stream.ts';
import { runResearch } from '../lib/ai-research-run.ts';

const generation = { id: 'operation', boardId: 'board', titles: ['研究问题'] };
const result = (content = '', tools) => ({ reason: tools ? 'tool_calls' : 'stop', message: { role: 'assistant', content, ...(tools ? { tool_calls: tools } : {}) } });
const tool = (name, value) => ({ id: name, type: 'function', function: { name, arguments: JSON.stringify(value) } });
const plan = board_action => result('', [tool('plan_research', { task: 'question', card_ids: [], requirements: [], queries: [], board_action })]);
const input = { question: '创建研究问题卡', sources: [], history: [], readingNotes: [], operationId: 'operation', board: { boardId: 'board', cards: [], edges: [] } };
const response = events => new Response(new ReadableStream({ start(controller) { for (const event of events) controller.enqueue(encodeAiEvent(event)); controller.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } });

test('generation progress is bounded display data and decoded from the event stream', async () => {
  assert.deepEqual(readAiBoardGeneration(generation), generation);
  for (const value of [null, [], {}, { ...generation, boardId: '' }, { ...generation, titles: [''] }, { ...generation, titles: ['x'.repeat(201)] }, { ...generation, titles: Array(13).fill('x') }]) assert.throws(() => readAiBoardGeneration(value));
  const events = [];
  await readAiStream(response([{ type: 'board_generation', generation }, { type: 'done', reason: 'stop' }]), event => events.push(event));
  assert.deepEqual(events[0], { type: 'board_generation', generation });
  await assert.rejects(readAiStream(response([{ type: 'board_generation', generation: { ...generation, titles: [17] } }]), () => {}), /生成进度格式/);
});

test('cancel after the temporary stage never publishes cards or completion', async () => {
  const controller = new AbortController(), events = [];
  let calls = 0;
  await assert.rejects(runResearch(input, async () => { calls++; return plan('create_notes'); }, event => {
    events.push(event);
    if (event.type === 'board_generation') controller.abort();
  }, controller.signal), { name: 'AbortError' });
  assert.equal(calls, 1);
  assert.deepEqual(events.find(event => event.type === 'board_generation').generation, { ...generation, titles: [] });
  assert.ok(!events.some(event => ['board_actions', 'delta', 'done'].includes(event.type)));
});

test('only validated note creation updates the temporary title; nothing is committed by progress', async () => {
  const controller = new AbortController(), events = [];
  let calls = 0;
  await assert.rejects(runResearch(input, async () => {
    if (++calls === 1) return plan('create_notes');
    if (calls === 2) return result('', [tool('create_note', { title: '', body: '' })]);
    return result('', [tool('create_note', { title: '研究问题', body: '需要核对的草稿' })]);
  }, event => {
    events.push(event);
    if (event.type === 'board_generation' && event.generation.titles.length) controller.abort();
  }, controller.signal), { name: 'AbortError' });
  assert.deepEqual(events.filter(event => event.type === 'board_generation').map(event => event.generation.titles), [[], ['研究问题']]);
  assert.ok(!events.some(event => ['board_actions', 'delta', 'done'].includes(event.type)));
});

test('ordinary questions and connection-only plans never create temporary cards', async () => {
  for (const boardAction of ['none', 'connect_cards']) {
    const events = []; let calls = 0;
    await runResearch(input, async () => ++calls === 1 ? plan(boardAction) : result('没有创建卡片。'), event => events.push(event), new AbortController().signal);
    assert.ok(!events.some(event => event.type === 'board_generation'));
  }
});
