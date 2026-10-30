import test from 'node:test';
import assert from 'node:assert/strict';
import { runResearch } from '../lib/ai-research-run.ts';
import { encodeAiEvent, readAiStream } from '../lib/ai-stream.ts';

const board = () => ({ boardId: 'board-1', cards: [
  { id: 'paper-a', title: 'Paper A', kind: 'pdf' }, { id: 'paper-b', title: 'Paper B', kind: 'pdf' },
], edges: [] });
const source = (text, page = 1) => ({ cardId: 'paper-a', title: 'Paper A', kind: 'pdf', text, page });
const result = (content = '', calls) => ({ reason: calls ? 'tool_calls' : 'stop', message: {
  role: 'assistant', content, reasoning_content: 'Private model reasoning', ...(calls ? { tool_calls: calls } : {}),
} });
const tool = (name, value, id = name) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(value) } });
const plan = boardAction => result('', [tool('plan_research', {
  task: 'question', card_ids: [], queries: ['evidence'], requirements: ['按用户要求整理'], board_action: boardAction,
})]);
const toolsNamed = tools => (tools || []).map(tool => tool.function.name);
const run = (call, extra = {}, controller = new AbortController()) => {
  const events = [];
  const completed = runResearch({ question: '请创建笔记并连接到来源卡片', sources: [], history: [], readingNotes: [],
    board: board(), operationId: 'operation-1', ...extra }, call, event => events.push(event), controller.signal);
  return { events, completed };
};
const noPublication = events => assert.ok(!events.some(event => ['board_actions', 'delta', 'done'].includes(event.type)));
const note = (extra = {}) => ({ id: 'new:1', title: '研究导读', body: '清晰的内容', ...extra });

void test('a missing board or a none plan never exposes mutation tools or publishes board actions', async () => {
  for (const extra of [{ board: undefined }, {}]) {
    let step = 0;
    const execution = run(async (messages, tools) => {
      step++;
      if (step === 1) {
        assert.deepEqual(toolsNamed(tools), ['plan_research']);
        assert.equal(Object.hasOwn(tools[0].function.parameters.properties, 'board_action'), !Object.hasOwn(extra, 'board') || !!extra.board);
        return plan('none');
      }
      assert.ok(!toolsNamed(tools).some(name => ['create_note', 'connect_cards', 'replace_board_actions'].includes(name)));
      return result(step === 2 ? '可以先明确研究问题。' : '先明确研究问题。');
    }, extra);
    await execution.completed;
    assert.equal(step, 3);
    assert.equal(execution.events.at(-1).type, 'done');
    assert.ok(!execution.events.some(event => event.type === 'board_actions'));
  }
});

void test('a forged create plan without a board still cannot expose or execute board tools', async () => {
  let step = 0;
  const execution = run(async (_messages, tools) => {
    if (++step === 1) return plan('create_and_connect');
    assert.ok(!toolsNamed(tools).includes('create_note'));
    assert.ok(!toolsNamed(tools).includes('connect_cards'));
    return result('当前没有可操作的画板。');
  }, { board: undefined });
  await execution.completed;
  assert.ok(!execution.events.some(event => event.type === 'board_actions'));
});

void test('research reads originals, stages cards and edges, then review corrects and deletes before publishing', async () => {
  let step = 0;
  const execution = run(async (messages, tools) => {
    step++;
    if (step === 1) return plan('create_and_connect');
    noPublication(execution.events);
    if (step === 2) {
      assert.ok(toolsNamed(tools).includes('create_note'));
      assert.ok(toolsNamed(tools).includes('connect_cards'));
      return result('', [tool('read_document', { card_id: 'paper-a' }, 'read-original')]);
    }
    if (step === 3) {
      const read = JSON.parse(messages.at(-1).content);
      assert.deepEqual(read.evidence.map(item => item.text), ['First original evidence.', 'Second original evidence.']);
      return result('', [
        tool('create_note', { title: '保留但待修正', body: '待修正结论 [Lumior:2]' }, 'create-1'),
        tool('create_note', { title: '删除这张', body: '重复内容 [Lumior:1]' }, 'create-2'),
      ]);
    }
    if (step === 4) {
      assert.deepEqual(messages.slice(-2).map(message => JSON.parse(message.content).id), ['new:1', 'new:2']);
      return result('', [
        tool('connect_cards', { from: 'paper-a', to: 'new:1', label: '待修正关联' }, 'connect-source'),
        tool('connect_cards', { from: 'new:1', to: 'new:2', label: '删去' }, 'connect-redundant'),
      ]);
    }
    if (step === 5) return result('已准备好导读草稿 [Lumior:1]。');
    if (step === 6) {
      const review = JSON.parse(messages.at(-1).content);
      assert.deepEqual(review.evidence.map(item => item.number), [1, 2], 'card-only citation 2 must be supplied as original review evidence');
      assert.equal(review.board_actions_to_review.notes.length, 2);
      assert.equal(review.board_actions_to_review.connections.length, 2);
      assert.ok(toolsNamed(tools).includes('replace_board_actions'));
      assert.ok(!toolsNamed(tools).some(name => ['create_note', 'connect_cards'].includes(name)));
      return result('', [tool('replace_board_actions', {
        notes: [note({ title: '已核对导读', body: '修正后的结论 [Lumior:2]' })],
        connections: [{ from: 'paper-a', to: 'new:1', label: '来源支持 [Lumior:1]' }],
      }, 'review-actions')]);
    }
    assert.equal(step, 7);
    assert.equal(messages.at(-1).tool_call_id, 'review-actions');
    assert.equal(JSON.parse(messages.at(-1).content).reviewed, true);
    return result('已准备好一张导读卡及来源关联 [Lumior:1]。');
  }, { sources: [source('First original evidence.'), source('Second original evidence.', 2)] });
  await execution.completed;
  const actions = execution.events.find(event => event.type === 'board_actions').actions;
  assert.deepEqual(actions, { id: 'operation-1', boardId: 'board-1',
    notes: [note({ title: '已核对导读', body: '修正后的结论 [Lumior:2]' })],
    connections: [{ from: 'paper-a', to: 'new:1', label: '来源支持 [Lumior:1]' }],
  });
  assert.equal(execution.events.at(-2).type, 'board_actions');
  assert.equal(execution.events.at(-1).type, 'done');
  assert.ok(!JSON.stringify(execution.events).includes('Private model reasoning'));
});

void test('a reviewer that never submits staged actions cannot publish an answer or completion', async () => {
  let step = 0;
  const execution = run(async () => {
    if (++step === 1) return plan('create_notes');
    if (step === 2) return result('', [tool('create_note', { title: '导读', body: '正文' })]);
    return result('已准备好。');
  });
  await assert.rejects(execution.completed, /核对没有完成/);
  assert.ok(step > 4, 'the reviewer receives a chance to submit before failure');
  noPublication(execution.events);
});

void test('invalid citations found only inside a card or connection cannot publish board actions', async () => {
  for (const field of ['body', 'label', 'title']) {
    let step = 0;
    const execution = run(async () => {
      if (++step === 1) return plan('create_and_connect');
      if (step === 2) return result('', [tool('create_note', { title: '导读', body: '正文' })]);
      if (step === 3) return result('已准备好。');
      if (step === 4) return result('', [tool('replace_board_actions', {
        notes: [note(field === 'body' ? { body: '无依据 [Lumior:999]' } : field === 'title' ? { title: '无依据 [Lumior:999]' } : {})],
        connections: field === 'label' ? [{ from: 'paper-a', to: 'new:1', label: '无依据 [Lumior:999]' }] : [],
      })]);
      return result('已准备好。');
    });
    await assert.rejects(execution.completed, /无法核对的引用/, field);
    noPublication(execution.events);
  }
});

void test('a review-only citation requires original evidence to be read even when it belongs to a real unread passage', async () => {
  let step = 0;
  const execution = run(async () => {
    if (++step === 1) return plan('create_notes');
    if (step === 2) return result('', [tool('read_passages', { passage_ids: [1], neighbors: 0 })]);
    if (step === 3) return result('', [tool('create_note', { title: '导读', body: '第一段 [Lumior:1]' })]);
    if (step === 4) return result('第一段 [Lumior:1]。');
    if (step === 5) return result('', [tool('replace_board_actions', { notes: [note({ body: '未读第二段 [Lumior:2]' })], connections: [] })]);
    return result('第一段 [Lumior:1]。');
  }, { sources: [source('First original evidence.'), source('Second original evidence.', 2)] });
  await assert.rejects(execution.completed, /无法核对的引用/);
  noPublication(execution.events);
});

void test('create-only authorization cannot be expanded to include connections by the reviewer', async () => {
  let step = 0;
  const execution = run(async (_messages, tools) => {
    if (++step === 1) return plan('create_notes');
    if (step === 2) {
      assert.ok(toolsNamed(tools).includes('create_note'));
      assert.ok(!toolsNamed(tools).includes('connect_cards'));
      return result('', [tool('create_note', { title: '导读', body: '正文' })]);
    }
    if (step === 3) return result('已准备好。');
    if (step === 4) return result('', [tool('replace_board_actions', {
      notes: [note()], connections: [{ from: 'paper-a', to: 'new:1' }],
    })]);
    return result('已准备好。');
  });
  await assert.rejects(execution.completed, /超出本轮要求|核对没有完成/);
  noPublication(execution.events);
});

void test('review may cancel every staged action without creating an empty board operation', async () => {
  let step = 0;
  const execution = run(async () => {
    if (++step === 1) return plan('create_notes');
    if (step === 2) return result('', [tool('create_note', { title: '待核对', body: '没有依据的草稿' })]);
    if (step === 3) return result('已准备好草稿。');
    if (step === 4) return result('', [tool('replace_board_actions', { notes: [], connections: [] })]);
    return result('依据不足，本轮没有创建卡片。');
  });
  await execution.completed;
  assert.ok(!execution.events.some(event => event.type === 'board_actions'));
  assert.equal(execution.events.at(-1).type, 'done');
});

void test('an abort after review submission cannot publish staged actions or completion', async () => {
  const controller = new AbortController();
  let step = 0;
  const execution = run(async () => {
    if (++step === 1) return plan('create_notes');
    if (step === 2) return result('', [tool('create_note', { title: '导读', body: '正文' })]);
    if (step === 3) return result('已准备好。');
    if (step === 4) return result('', [tool('replace_board_actions', { notes: [note()], connections: [] })]);
    controller.abort(new DOMException('Stopped', 'AbortError'));
    return result('已准备好。');
  }, {}, controller);
  await assert.rejects(execution.completed, { name: 'AbortError' });
  noPublication(execution.events);
});

void test('connect-only work reviews and publishes a relation between existing cards without new notes', async () => {
  let step = 0;
  const execution = run(async (messages, tools) => {
    if (++step === 1) return plan('connect_cards');
    if (step === 2) {
      assert.ok(!toolsNamed(tools).includes('create_note'));
      assert.ok(toolsNamed(tools).includes('connect_cards'));
      return result('', [tool('connect_cards', { from: 'paper-a', to: 'paper-b', label: '主题相关' })]);
    }
    if (step === 3) return result('已准备好关联。');
    if (step === 4) {
      assert.deepEqual(JSON.parse(messages.at(-1).content).board_actions_to_review.notes, []);
      return result('', [tool('replace_board_actions', { notes: [], connections: [{ from: 'paper-a', to: 'paper-b', label: '共同主题' }] })]);
    }
    return result('已准备好两篇论文之间的关联。');
  }, { question: '把这两张现有论文卡片连起来' });
  await execution.completed;
  assert.deepEqual(execution.events.find(event => event.type === 'board_actions').actions, {
    id: 'operation-1', boardId: 'board-1', notes: [], connections: [{ from: 'paper-a', to: 'paper-b', label: '共同主题' }],
  });
  assert.equal(execution.events.at(-1).type, 'done');
});

function streamedResponse(events) {
  const bytes = new Uint8Array(events.flatMap(event => [...encodeAiEvent(event)]));
  return new Response(new ReadableStream({ start(out) {
    // Split inside both Chinese UTF-8 characters and JSON/SSE tokens.
    for (let offset = 0; offset < bytes.length; offset += 3) out.enqueue(bytes.slice(offset, offset + 3));
    out.close();
  } }), { headers: { 'content-type': 'text/event-stream' } });
}

void test('the SSE client preserves validated card actions through fragmented UTF-8 and finishes after them', async () => {
  const actions = { id: 'operation-1', boardId: 'board-1', notes: [note()], connections: [{ from: 'paper-a', to: 'new:1', label: '依据' }] };
  const events = [];
  await readAiStream(streamedResponse([{ type: 'board_actions', actions }, { type: 'done', reason: 'stop' }]), event => events.push(event));
  assert.deepEqual(events, [{ type: 'board_actions', actions }, { type: 'done', reason: 'stop' }]);
});

void test('invalid SSE card actions fail closed before they can reach application callbacks', async () => {
  for (const actions of [
    { id: 'operation', boardId: 'board', notes: [note({ metadata: { file: '/private' } })], connections: [] },
    { id: 'operation', boardId: 'board', notes: [note()], connections: [{ from: 'new:2', to: 'new:1' }] },
    { id: 'operation', boardId: 'board', notes: [note({ body: 'x'.repeat(20_001) })], connections: [] },
    { id: 'operation', boardId: 'board', notes: [note()], connections: [], metadata: { dangerous: true } },
  ]) {
    const events = [];
    await assert.rejects(readAiStream(streamedResponse([{ type: 'board_actions', actions }, { type: 'done', reason: 'stop' }]), event => events.push(event)));
    assert.deepEqual(events, []);
  }
});

void test('only explicitly planned pure operations use the lightweight result; mixed requests retain conversation', async () => {
  for (const mode of ['operation', 'conversation']) {
    let step = 0;
    const execution = run(async () => {
      step++;
      if (step === 1) return result('', [tool('plan_research', {task:'question',card_ids:[],queries:[],requirements:[],board_action:'create_notes',response_mode:mode})]);
      if (step === 2) return result('', [tool('create_note', {title:'研究问题',body:'待补充'})]);
      if (step === 3) return result('已准备研究问题卡片。');
      if (step === 4) return result('', [tool('replace_board_actions', {notes:[note({title:'研究问题',body:'待补充'})],connections:[]})]);
      return result('已准备研究问题卡片。');
    });
    await execution.completed;
    const published = execution.events.find(event => event.type === 'board_actions');
    assert.equal(published.operationOnly, mode === 'operation' ? true : undefined);
    const received = [];
    await readAiStream(new Response(new ReadableStream({start(out){out.enqueue(encodeAiEvent(published));out.enqueue(encodeAiEvent({type:'done',reason:'stop'}));out.close();}}),{headers:{'content-type':'text/event-stream'}}), event => received.push(event));
    assert.deepEqual(received[0],published);
  }
});
