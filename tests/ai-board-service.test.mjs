import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiService } from '../lib/ai-service.ts';
import { readAiStream } from '../lib/ai-stream.ts';

const privateKey = 'service-test-private-api-key';
const privateUrl = 'file:///private/library/unshared-paper.pdf';
const privateFileKey = 'private-source-storage-key';
const settings = () => ({ key: privateKey, model: 'deepseek-flash' });
const board = () => ({ boardId: 'research-board', cards: [
  { id: 'paper-a', title: '原文资料', kind: 'pdf' }, { id: 'paper-b', title: '另一份资料', kind: 'pdf' },
], edges: [] });
const request = (body = {}) => new Request('http://localhost:43821/api/ai', {
  method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:43821' },
  body: JSON.stringify({ question: '根据资料创建导读卡，并连接到原文', model: 'auto', ...body }),
});
const tool = (name, value, id = name) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(value) } });
const planned = (action = 'create_and_connect', task = 'question') => ({ calls: [tool('plan_research', {
  task, card_ids: [], queries: ['Evidence'], requirements: ['基于原文整理'], board_action: action,
})] });
const toolNames = payload => (payload.tools || []).map(tool => tool.function.name);
const line = value => `data: ${JSON.stringify(value)}\n\n`;

void test('regenerating a completed operation explains existing results without enabling mutation tools', async () => {
  const mock = provider((payload, step) => {
    assert.match(payload.messages[0].content, /同一问题的画板操作此前完成并保存/);
    assert.ok(!toolNames(payload).some(name => ['create_note', 'connect_cards', 'replace_board_actions'].includes(name)));
    if (step === 1) return planned('none');
    return { text: '此前的连线已完成，本次只解释这项关联。' };
  });
  const service = createAiService(settings, mock.fetcher), events = [];
  await readAiStream(await service.POST(request({ boardOperationCompleted: true })), event => events.push(event));
  assert.equal(mock.captures.length, 3);
  assert.ok(!events.some(event => event.type === 'board_actions'));
  assert.equal(events.at(-1).type, 'done');
  for (const invalid of ['true', {}, 1, null]) {
    assert.equal((await service.POST(request({ boardOperationCompleted: invalid }))).status, 400);
  }
  assert.equal((await service.POST(request({ board: board(), operationId: 'q', boardOperationCompleted: true }))).status, 400);
  assert.equal(mock.captures.length, 3);
});

function providerResponse({ text = '', calls }) {
  const deltas = calls ? calls.flatMap((call, index) => {
    const split = Math.floor(call.function.arguments.length / 2);
    return [
      { reasoning_content: index ? '' : 'Private provider thinking', tool_calls: [{ index, id: call.id, type: 'function', function: { name: call.function.name, arguments: call.function.arguments.slice(0, split) } }] },
      { tool_calls: [{ index, function: { arguments: call.function.arguments.slice(split) } }] },
    ];
  }) : [{ content: text }];
  const frames = deltas.map(delta => line({ choices: [{ delta, finish_reason: null }] })).join('')
    + line({ choices: [{ delta: {}, finish_reason: calls ? 'tool_calls' : 'stop' }] }) + 'data: [DONE]\n\n';
  const bytes = new TextEncoder().encode(frames);
  return new Response(new ReadableStream({ start(controller) {
    for (let offset = 0; offset < bytes.length; offset += 17) controller.enqueue(bytes.slice(offset, offset + 17));
    controller.close();
  } }), { headers: { 'content-type': 'text/event-stream' } });
}

function provider(next) {
  const captures = [];
  return { captures, fetcher: async (url, options) => {
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    assert.equal(options.headers.Authorization, `Bearer ${privateKey}`);
    const payload = JSON.parse(options.body); captures.push(payload);
    assert.ok(!JSON.stringify(payload).includes(privateKey), 'credentials belong only in the provider authorization header');
    return providerResponse(await next(payload, captures.length));
  } };
}

void test('service parses a board request and completes provider-SSE research, staging, review and final publication', async () => {
  let submitted = false, finalReturned = false;
  const mock = provider((payload, step) => {
    if (step === 1) {
      assert.ok(Object.hasOwn(payload.tools[0].function.parameters.properties, 'board_action'));
      assert.match(payload.messages[0].content, /research-board/);
      return planned();
    }
    if (step === 2) {
      assert.ok(toolNames(payload).includes('create_note'));
      assert.ok(toolNames(payload).includes('connect_cards'));
      return { calls: [tool('read_document', { card_id: 'paper-a' }, 'read-source')] };
    }
    if (step === 3) {
      const read = JSON.parse(payload.messages.at(-1).content);
      assert.equal(read.evidence[0].text, 'Evidence: a bounded research question helps choose a feasible method.');
      assert.equal(read.evidence[0].page, 4);
      return { calls: [tool('create_note', { title: '待核对导读', body: '待修正文稿 [Lumior:1]' }, 'create-note')] };
    }
    if (step === 4) {
      assert.equal(JSON.parse(payload.messages.at(-1).content).id, 'new:1');
      return { calls: [tool('connect_cards', { from: 'paper-a', to: 'new:1', label: '待核对关系' }, 'connect-note')] };
    }
    if (step === 5) return { text: '已准备好导读草稿 [Lumior:1]。' };
    if (step === 6) {
      assert.ok(toolNames(payload).includes('replace_board_actions'));
      assert.ok(!toolNames(payload).includes('create_note'));
      assert.ok(!toolNames(payload).includes('connect_cards'));
      const review = JSON.parse(payload.messages.at(-1).content);
      assert.equal(review.board_actions_to_review.boardId, 'research-board');
      assert.equal(review.evidence[0].text, 'Evidence: a bounded research question helps choose a feasible method.');
      submitted = true;
      return { calls: [tool('replace_board_actions', {
        notes: [{ id: 'new:1', title: '研究问题与可行性', body: '先限定研究问题，再选择可行的方法。来源为原文第 4 页 [Lumior:1]。' }],
        connections: [{ from: 'paper-a', to: 'new:1', label: '原文依据 [Lumior:1]' }],
      }, 'review-note')] };
    }
    assert.equal(step, 7);
    assert.equal(JSON.parse(payload.messages.at(-1).content).reviewed, true);
    finalReturned = true;
    return { text: '已准备好导读卡和来源关联 [Lumior:1]。' };
  });
  const service = createAiService(settings, mock.fetcher);
  const response = await service.POST(request({ board: board(), operationId: 'operation-service-1',
    sources: [{ cardId: 'paper-a', title: '原文资料', kind: 'pdf', text: 'Evidence: a bounded research question helps choose a feasible method.', page: 4,
      url: privateUrl, fileKey: privateFileKey, apiKey: privateKey }],
    readingNotes: [{ id: 'paper-a', title: '原文资料', status: 'ready', url: privateUrl, fileKey: privateFileKey }],
    history: [{ role: 'system', content: `${privateKey} ${privateUrl}` }],
  }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const events = [];
  await readAiStream(response, event => {
    if (event.type === 'board_actions' || event.type === 'done' || (event.type === 'coverage' && event.verified)) {
      assert.equal(submitted, true);
      assert.equal(finalReturned, true);
    }
    events.push(event);
  });
  assert.equal(mock.captures.length, 7);
  assert.deepEqual(events.filter(event => event.type === 'board_actions').map(event => event.actions), [{
    id: 'operation-service-1', boardId: 'research-board',
    notes: [{ id: 'new:1', title: '研究问题与可行性', body: '先限定研究问题，再选择可行的方法。来源为原文第 4 页 [Lumior:1]。' }],
    connections: [{ from: 'paper-a', to: 'new:1', label: '原文依据 [Lumior:1]' }],
  }]);
  assert.equal(events.filter(event => event.type === 'coverage' && event.verified).length, 1);
  assert.equal(events.filter(event => event.type === 'done').length, 1);
  assert.equal(events.at(-2).type, 'board_actions');
  assert.equal(events.at(-1).type, 'done');
  const exposed = JSON.stringify({ requests: mock.captures, events });
  for (const secret of [privateKey, privateUrl, privateFileKey]) assert.ok(!exposed.includes(secret));
  assert.ok(!JSON.stringify(events).includes('Private provider thinking'));
});

void test('malformed board contexts and operation IDs fail before any provider request', async () => {
  let calls = 0;
  const service = createAiService(settings, async () => { calls++; throw new Error('must not contact provider'); });
  const valid = { board: board(), operationId: 'operation-1' };
  const invalid = [
    ['null board', { ...valid, board: null }],
    ['missing board id', { ...valid, board: { cards: [], edges: [] } }],
    ['unknown metadata', { ...valid, board: { ...board(), url: privateUrl } }],
    ['card private metadata', { ...valid, board: { ...board(), cards: [{ ...board().cards[0], fileKey: privateFileKey }] } }],
    ['duplicate card identity', { ...valid, board: { ...board(), cards: [board().cards[0], board().cards[0]] } }],
    ['reserved card id', { ...valid, board: { ...board(), cards: [{ id: 'new:old', title: '旧卡片', kind: 'note' }] } }],
    ['dangling existing edge', { ...valid, board: { ...board(), edges: [{ from: 'paper-a', to: 'outside-board' }] } }],
    ['unsupported card kind', { ...valid, board: { ...board(), cards: [{ id: 'a', title: '资料', kind: 'url' }] } }],
    ['missing operation id', { board: board() }],
    ['null operation id', { ...valid, operationId: null }],
    ['numeric operation id', { ...valid, operationId: 42 }],
    ['empty operation id', { ...valid, operationId: '' }],
    ['blank operation id', { ...valid, operationId: '   ' }],
    ['long operation id', { ...valid, operationId: 'x'.repeat(201) }],
    ['orphan operation id', { operationId: 'operation-1' }],
    ['padded operation id', { ...valid, operationId: ' operation-1 ' }],
    ['prototype operation id', { ...valid, operationId: '__proto__' }],
    ['control character operation id', { ...valid, operationId: 'operation\n1' }],
    ['NUL operation id', { ...valid, operationId: 'operation\u00001' }],
  ];
  for (const [label, body] of invalid) {
    const output = await service.POST(request(body));
    assert.equal(output.status, 400, label);
    assert.equal(typeof (await output.json()).error, 'string', label);
    assert.equal(calls, 0, label);
  }
});

void test('legacy requests without board or operationId remain compatible and keep mutation tools unavailable', async () => {
  const mock = provider((payload, step) => {
    if (step === 1) {
      assert.equal(Object.hasOwn(payload.tools[0].function.parameters.properties, 'board_action'), false);
      return planned('none', 'summary');
    }
    assert.ok(!toolNames(payload).some(name => ['create_note', 'connect_cards', 'replace_board_actions'].includes(name)));
    return { text: '原文建议限定研究问题 [Lumior:1]。' };
  });
  const service = createAiService(settings, mock.fetcher), events = [];
  await readAiStream(await service.POST(request({ question: '总结这篇资料', sources: [
    { cardId: 'paper-a', title: '原文资料', kind: 'pdf', text: 'Evidence: define a bounded research question.' },
  ] })), event => events.push(event));
  assert.equal(mock.captures.length, 3);
  assert.equal(events.find(event => event.type === 'delta').text, '原文建议限定研究问题 [Lumior:1]。');
  assert.ok(!events.some(event => event.type === 'board_actions'));
  assert.equal(events.at(-1).type, 'done');
});

void test('a model-proposed endpoint outside the board returns a tool error and cannot become a saved action', async () => {
  const mock = provider((payload, step) => {
    if (step === 1) return planned('connect_cards');
    if (step === 2) return { calls: [tool('connect_cards', { from: 'paper-a', to: 'outside-board' }, 'outside-connection')] };
    if (step === 3) {
      assert.equal(payload.messages.at(-1).tool_call_id, 'outside-connection');
      assert.match(JSON.parse(payload.messages.at(-1).content).error, /不在当前画板/);
      return { text: '另一张卡片不在当前画板，无法连接。' };
    }
    assert.equal(step, 4);
    assert.ok(!toolNames(payload).includes('replace_board_actions'));
    return { text: '目标卡片不在当前画板，本轮没有创建连线。' };
  });
  const service = createAiService(settings, mock.fetcher), events = [];
  await readAiStream(await service.POST(request({ board: board(), operationId: 'operation-1' })), event => events.push(event));
  assert.ok(!events.some(event => event.type === 'board_actions'));
  assert.equal(events.at(-1).type, 'done');
});

void test('unreviewed staged cards terminate as a service error with no actions, verified state or done', async () => {
  const mock = provider((_payload, step) => {
    if (step === 1) return planned('create_notes');
    if (step === 2) return { calls: [tool('create_note', { title: '尚未复核', body: '待核对正文' })] };
    return { text: '已准备好。' };
  });
  const service = createAiService(settings, mock.fetcher), events = [];
  await assert.rejects(readAiStream(await service.POST(request({ board: board(), operationId: 'operation-1' })), event => events.push(event)), /核对没有完成/);
  assert.ok(!events.some(event => ['board_actions', 'done', 'delta'].includes(event.type) || event.verified));
});
