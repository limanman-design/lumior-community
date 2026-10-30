import test from 'node:test';
import assert from 'node:assert/strict';
import { ResearchCorpus, executeResearchTool, researchSources } from '../lib/ai-research.ts';
import { citationNumbers, runResearch, semanticSearch } from '../lib/ai-research-run.ts';
import { deepseekResearchCall } from '../lib/ai-provider.ts';

const source = (id, text, extra = {}) => ({ cardId: id, title: id, kind: 'pdf', text, ...extra });
const result = (content = '', calls) => ({ reason: calls ? 'tool_calls' : 'stop', message: { role: 'assistant', content, reasoning_content: 'Hidden reasoning', ...(calls ? { tool_calls: calls } : {}) } });
const tool = (name, value, id = name) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(value) } });
const plan = (task, cards = [], queries = ['evidence']) => result('', [tool('plan_research', { task, card_ids: cards, queries, requirements: ['Answer with sources'] })]);
const run = (sources, call, question = 'Question', extra = {}) => {
  const events = [], controller = new AbortController();
  return runResearch({ question, sources, history: [], readingNotes: [], ...extra }, call, event => events.push(event), controller.signal).then(() => events);
};

void test('citation validation does not mistake code arrays, escaped brackets or ordinary links for evidence', () => {
  assert.deepEqual(citationNumbers('Evidence [Lumior:2]. `items[0]`\n```js\nconst x = [Lumior:99];\n```\n\\[30] [Lumior:10](https://example.com)'), [2]);
});

void test('search reaches later cards and late passages; reading includes both neighbors with stable exact citations', () => {
  const corpus = new ResearchCorpus([...Array.from({ length: 20 }, (_, i) => source(`other-${i}`, 'Unrelated background')), source('target', 'Boundary before', { page: 100 }), source('target', 'Golden feathers are required for flight', { page: 101 }), source('target', 'Only seven required; extras are optional', { page: 102 })]);
  const search = corpus.search(['golden feathers']);
  assert.equal(search.searched_cards, 21); assert.equal(search.hits[0].passage_id, 22);
  const read = corpus.readPassages([22]);
  assert.deepEqual(read.evidence.map(item => item.page), [100, 101, 102]);
  assert.deepEqual(corpus.readPassages([22]).evidence.map(item => item.number), [1, 2, 3]);
  assert.equal(corpus.ledger.length, 3);
  assert.ok(executeResearchTool(corpus, 'read_document', { card_id: 'outside' }).error);
  assert.ok(executeResearchTool(corpus, 'delete_data', {}).error);
  assert.ok(corpus.readPassages([100000]).error);
});

void test('document paging has no hidden clipping and every passage is eventually covered', () => {
  const sources = Array.from({ length: 50 }, (_, index) => source('paper', `Page ${index}: ` + 'x'.repeat(3900), { page: index + 1 }));
  const corpus = new ResearchCorpus(sources), task = corpus.plan({ task: 'summary', card_ids: ['paper'] }, 'Summarize paper');
  let cursor = 0;
  while (cursor !== null) { const output = corpus.readDocument('paper', cursor); cursor = output.next_cursor; }
  assert.equal(corpus.coverage(task).complete, true); assert.equal(corpus.ledger.length, 50);
  assert.equal(corpus.evidence().at(-1).page, 50);
  assert.equal(corpus.evidence().reduce((sum, item) => sum + item.text.length, 0), sources.reduce((sum, item) => sum + item.text.length, 0));
});

void test('uneven reading batches preserve sequence and never skip the passage that crosses the bound', () => {
  const corpus = new ResearchCorpus([source('paper', 'a'.repeat(50000)), source('paper', 'b'.repeat(20000)), source('paper', 'c'.repeat(1000))]);
  const first = corpus.readDocument('paper');
  assert.equal(first.evidence.length, 1); assert.equal(first.next_cursor, 1);
  const next = corpus.readDocument('paper', first.next_cursor);
  assert.deepEqual(next.evidence.map(item => item.text[0]), ['b', 'c']);
  assert.equal(next.next_cursor, null); assert.equal(corpus.ledger.length, 3);
});

void test('concrete questions can search again and read additional counterevidence before review', async () => {
  const sources = [source('first', 'Support for explanation'), source('second', 'Counterexample with different conditions')];
  let step = 0;
  const events = await run(sources, async messages => {
    step++;
    if (step === 1) return plan('question');
    if (step === 2) return result('', [tool('read_document', { card_id: 'first' })]);
    if (step === 3) {
      assert.equal(messages.at(-1).role, 'tool'); assert.equal(messages.at(-2).reasoning_content, 'Hidden reasoning');
      return result('', [tool('search_materials', { queries: ['Counterexample'] })]);
    }
    if (step === 4) return result('', [tool('read_passages', { passage_ids: [2], neighbors: 0 })]);
    if (step === 5) return result('Evidence differs by conditions [Lumior:1][Lumior:2].');
    const review = JSON.parse(messages.at(-1).content);
    assert.equal(review.evidence.length, 2); assert.equal(review.requirements[0], 'Answer with sources');
    return result('There is support [Lumior:1], but different conditions limit the conclusion [Lumior:2].');
  });
  assert.equal(step, 6); assert.deepEqual(events.find(item => item.type === 'evidence').indices, [0, 1]);
  assert.ok(events.some(item => item.type === 'progress' && item.message.includes('扩展查询')));
  assert.equal(events.at(-1).type, 'done');
});

void test('research publishes key actions while model calls are pending and keeps private thinking out of the log', async () => {
  const events = [], controller = new AbortController();
  let releasePlan, releaseDraft, step = 0;
  const pendingPlan = new Promise(resolve => { releasePlan = resolve; });
  const pendingDraft = new Promise(resolve => { releaseDraft = resolve; });
  const research = runResearch({ question: 'Check evidence', sources: [source('study', 'Observed evidence', { title: 'Study', location: 'PDF 第 7 页' })], history: [], readingNotes: [] }, async () => {
    if (++step === 1) return pendingPlan;
    if (step === 2) return result('', [tool('read_document', { card_id: 'study' })]);
    if (step === 3) return pendingDraft;
    return result('Observed result [Lumior:1].');
  }, event => events.push(event), controller.signal);
  assert.equal(step, 1);
  assert.ok(events.some(event => event.type === 'progress' && event.message.includes('制定阅读安排')));
  assert.ok(!events.some(event => event.type === 'delta'));
  releasePlan(plan('question', ['study'], ['Observed evidence']));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(step, 3);
  const messages = events.filter(event => event.type === 'progress').map(event => event.message);
  assert.ok(messages.some(message => message.includes('阅读安排：针对问题查证')));
  assert.ok(messages.some(message => message.includes('扩展查询：Observed evidence')));
  assert.ok(messages.some(message => message.includes('找到 1 段候选原文')));
  assert.ok(messages.some(message => message.includes('正在读取《Study》原文')));
  assert.ok(messages.some(message => message.includes('已取得原文') && message.includes('PDF 第 7 页')));
  assert.ok(!events.some(event => event.type === 'delta'));
  releaseDraft(result('Observed result [Lumior:1].'));
  await research;
  assert.ok(events.findIndex(event => event.type === 'delta') > events.findIndex(event => event.type === 'progress' && event.message.includes('核对完成')));
  assert.ok(!JSON.stringify(events).includes('Hidden reasoning'));
  assert.equal(events.at(-1).type, 'done');
});

void test('whole-board summaries override an incomplete planner target and read every card', async () => {
  const sources = Array.from({ length: 30 }, (_, index) => source(`card-${index}`, `Actual content ${index}`));
  let step = 0;
  const events = await run(sources, async messages => {
    if (++step === 1) return plan('summary', ['card-0']);
    if (step === 2) { const input = JSON.parse(messages.at(-1).content); assert.equal(input.reading.length, 30); assert.equal(input.coverage.complete, true); return result('The last card contains Actual content 29 [Lumior:30].'); }
    return result('The last card contains Actual content 29 [Lumior:30].');
  }, '总结整张画板');
  assert.equal(events.filter(item => item.type === 'coverage').at(-1).readCards, 30);
});

void test('long summaries process all batches and retain the final page in the synthesis', async () => {
  const sources = Array.from({ length: 100 }, (_, index) => source('long-paper', `Page ${index + 1}: ` + 'content '.repeat(750), { page: index + 1 }));
  let planned = false, batchCount = 0;
  const seen = new Set();
  const events = await run(sources, async (messages, tools, choice) => {
    if (choice) { planned = true; return plan('summary', ['long-paper']); }
    assert.ok(planned);
    const input = JSON.parse(messages.at(-1).content);
    if (input.evidence && !input.draft) {
      batchCount++;
      input.evidence.forEach(item => seen.add(item.page));
      return result(`Reading batch, including page ${input.evidence.at(-1).page} [Lumior:${input.evidence.at(-1).number}].`);
    }
    if (tools && input.plan) { assert.equal(input.coverage.complete, true); assert.ok(input.reading.join(' ').includes('page 100')); return result('Final chapter is covered [Lumior:100].'); }
    return result('Final chapter is covered [Lumior:100].');
  }, 'Summarize the entire long-paper');
  assert.ok(batchCount > 3); assert.equal(seen.size, 100);
  assert.equal(events.filter(item => item.type === 'coverage').at(-1).complete, true);
});

void test('comparison covers every target while failed extraction prevents a full-reading claim', async () => {
  const sources = [source('a', 'One method'), source('b', 'Another method'), source('scan', 'Scan filename')];
  let step = 0;
  const events = await run(sources, async messages => {
    if (++step === 1) return plan('comparison');
    const input = JSON.parse(messages.at(-1).content);
    assert.equal(input.coverage.complete, false);
    return result('Two readable methods differ [Lumior:1][Lumior:2]. The scan has no extractable text and cannot be compared.');
  }, '比较所有论文', { readingNotes: [{ id: 'scan', title: 'scan', status: 'empty', incomplete: true, message: 'No extractable text' }] });
  assert.equal(events.filter(item => item.type === 'coverage').at(-1).complete, false);
});

void test('semantic lookup finds paraphrases across language without creating evidence or escaping the selected scope', async () => {
  const corpus = new ResearchCorpus([source('a', 'A constrained space affords self-directed movement.'), source('b', 'Unrelated material')]);
  assert.equal(corpus.search(['自主感']).hits.length, 0);
  const calls = [];
  const output = await semanticSearch(corpus, { query: '自主感', card_ids: ['a'] }, async messages => {
    const input = JSON.parse(messages.at(-1).content); calls.push(input);
    return result(JSON.stringify({ hits: [{ passage_id: 1, relevance: 5, reason: 'self-directed movement relates to autonomy' }] }));
  }, () => {});
  assert.equal(output.hits[0].passage_id, 1); assert.equal(output.scanned_passages, 1); assert.equal(corpus.ledger.length, 0);
  assert.equal(calls[0].passages.length, 1);
  await assert.rejects(semanticSearch(corpus, { query: 'autonomy', card_ids: ['a'] }, async () => result('{"hits":[{"passage_id":2,"relevance":5}]}'), () => {}), /范围外/);
});

void test('no lexical match triggers semantic fallback before accepting a no-evidence draft', async () => {
  let step = 0;
  const events = await run([source('a', 'Self-directed movement supports player agency.')], async messages => {
    if (++step === 1) return plan('question', ['a'], ['自主感']);
    if (step === 2) return result('No keyword result.');
    if (step === 3) return result('{"hits":[{"passage_id":1,"relevance":5,"reason":"agency"}]}');
    if (step === 4) { assert.ok(messages.at(-1).content.includes('候选位置')); return result('', [tool('read_passages', { passage_ids: [1] })]); }
    return result('Agency relates to self-directed movement [Lumior:1].');
  }, '自主感是什么？');
  assert.deepEqual(events.find(event => event.type === 'evidence').indices, [0]);
  assert.equal(events.at(-1).type, 'done');
});

void test('invalid reviewed citations never produce a completed answer', async () => {
  let step = 0; const events = [], controller = new AbortController();
  await assert.rejects(runResearch({ question: 'Summary', sources: [source('a', 'Real evidence')], history: [], readingNotes: [] }, async () => ++step === 1 ? plan('summary') : result('Unsupported citation [Lumior:999].'), event => events.push(event), controller.signal), /无法核对/);
  assert.ok(!events.some(item => item.type === 'done' || item.type === 'delta'));
});

void test('a paper bibliography is kept separately from an explicit verified source', async () => {
  let step = 0;
  const body = 'The paper refers to prior work [99], supported here [Lumior:1].';
  const events = await run([source('paper', 'Prior work is discussed [99].')], async messages => {
    if (++step === 1) return plan('summary');
    const input = JSON.parse(messages.at(-1).content);
    assert.equal((input.reading || input.evidence)[0].citation, '[Lumior:1]');
    return result(body);
  });
  assert.equal(step, 3);
  assert.equal(events.find(event => event.type === 'delta').text, body);
  assert.equal(events.find(event => event.type === 'evidence').citationFormat, 'lumior-v1');
  assert.equal(events.at(-1).type, 'done');
});

void test('invalid explicit citation gets one repair and valid variants normalize before publication', async () => {
  let step = 0; const events = [];
  await runResearch({ question: 'Summary', sources: [source('paper', 'Real evidence')], history: [], readingNotes: [] }, async messages => {
    if (++step === 1) return plan('summary');
    if (step === 2) return result('Draft [Lumior:1].');
    if (step === 3) return result('Bad source [Lumior:999].');
    assert.equal(step, 4);
    const repair = JSON.parse(messages.at(-1).content);
    assert.deepEqual(repair.invalid_source_tokens, ['[Lumior:999]']);
    assert.deepEqual(repair.allowed_source_tokens, ['[Lumior:1]']);
    assert.ok(!events.some(event => event.type === 'delta' || event.type === 'done'));
    return result('Corrected source [LUMIOR: 001 ].');
  }, event => events.push(event), new AbortController().signal);
  assert.equal(events.find(event => event.type === 'delta').text, 'Corrected source [Lumior:1].');
  assert.equal(events.at(-1).type, 'done');
});

void test('repair cannot approve an already-read source unless review receives its original text', async () => {
  let step = 0;
  const events = await run([source('paper', 'First passage'), source('paper', 'Second passage')], async messages => {
    if (++step === 1) return plan('summary');
    if (step === 2) return result('First [Lumior:1].');
    if (step === 3) {
      assert.deepEqual(JSON.parse(messages.at(-1).content).evidence.map(item => item.number), [1]);
      return result('Second [Lumior:2].');
    }
    if (step === 4) {
      assert.deepEqual(JSON.parse(messages.at(-1).content).allowed_source_tokens, ['[Lumior:1]']);
      return result('', [tool('read_passages', { passage_ids: [2], neighbors: 0 }, 'repair-read')]);
    }
    assert.equal(messages.at(-1).tool_call_id, 'repair-read');
    assert.equal(JSON.parse(messages.at(-1).content).evidence[0].text, 'Second passage');
    return result('Second [Lumior:2].');
  });
  assert.equal(step, 5);
  assert.equal(events.find(event => event.type === 'delta').text, 'Second [Lumior:2].');
});

void test('an invalid or unreviewed source after the single repair publishes no answer or completion', async () => {
  for (const token of ['[Lumior:999]', '[Lumior:2]', '[Lumior:bad]', 'word[Lumior:2]', '\\[Lumior:2]', '[Evidence](#lumior-citation-2)', '\n\n- List item\n    [Lumior:2]', '\n\n1. List item\n    [Lumior:2]', '[Lumior&#58;2]', '&#91;Lumior:2&#93;']) {
    let step = 0; const events = [];
    await assert.rejects(runResearch({ question: 'Summary', sources: [source('paper', 'First'), source('paper', 'Second')], history: [], readingNotes: [] }, async () => {
      if (++step === 1) return plan('summary');
      return result(step === 2 ? 'First [Lumior:1].' : `Invalid ${token}.`);
    }, event => events.push(event), new AbortController().signal), /无法核对/);
    assert.equal(step, 4);
    assert.ok(!events.some(event => event.type === 'evidence' || event.type === 'delta' || event.type === 'done' || event.verified));
  }
});

void test('entity-encoded source syntax is repaired to literal tokens without rewriting answer tables', async () => {
  let step = 0;
  const body = '| Fact | Evidence |\n| --- | --- |\n| Actual result, paper [99] | [Lumior:1] |';
  const events = await run([source('paper', 'Actual result, paper references [99].')], async messages => {
    if (++step === 1) return plan('summary');
    if (step === 2) return result(body);
    if (step === 3) return result(body.replace('[Lumior:1]', '[Lumior&#58;1]'));
    assert.equal(step, 4);
    assert.ok(JSON.parse(messages.at(-1).content).instruction.includes('不要用 HTML 实体'));
    return result(body);
  });
  assert.equal(events.find(event => event.type === 'delta').text, body);
  assert.equal(events.at(-1).type, 'done');
});

void test('long reading notes retain original bibliography and only validate explicit batch source tokens', async () => {
  let step = 0;
  const body = 'The paper quotes [999], its source is [Lumior:1].';
  const events = await run([source('paper', 'Original bibliography [999]. ' + 'Evidence '.repeat(30_000))], async messages => {
    if (++step === 1) return plan('summary');
    const input = JSON.parse(messages.at(-1).content);
    if (step === 2) assert.equal(input.evidence[0].citation, '[Lumior:1]');
    if (step === 3) assert.deepEqual(input.reading, [body]);
    return result(body);
  });
  assert.equal(step, 4);
  assert.equal(events.find(event => event.type === 'delta').text, body);
});

void test('review can reopen research and read missing contradictory evidence before completing', async () => {
  let step = 0;
  const events = await run([source('a', 'Original supporting evidence'), source('b', 'Contradictory result under another condition')], async (messages, tools) => {
    if (++step === 1) return plan('question', ['a', 'b']);
    if (step === 2) return result('', [tool('read_document', { card_id: 'a' })]);
    if (step === 3) return result('Initial draft [Lumior:1].');
    if (step === 4) { assert.ok(tools); return result('', [tool('read_document', { card_id: 'b' }, 'review-read')]); }
    assert.equal(messages.at(-1).tool_call_id, 'review-read');
    assert.equal(messages.at(-2).reasoning_content, 'Hidden reasoning');
    return result('Conditions differ: support [Lumior:1] and contrary result [Lumior:2].');
  });
  assert.deepEqual(events.find(event => event.type === 'evidence').indices, [0, 1]);
  assert.ok(events.some(event => event.type === 'progress' && event.message.includes('补充证据')));
  const supplement = events.findIndex(event => event.type === 'progress' && event.message.includes('补充证据'));
  const resumedReview = events.findIndex((event, index) => index > supplement && event.type === 'progress' && event.message === '正在核对回答、原文引用和问题覆盖情况…');
  assert.ok(resumedReview > supplement, 'the resumed review is reported after supplemental reading');
  assert.ok(events.slice(supplement, resumedReview).some(event => event.type === 'progress' && event.message.includes('已取得原文')));
  assert.equal(events.at(-1).type, 'done');
});

void test('untrusted source properties never become model file access, and invalid plans cannot expand scope', () => {
  const input = researchSources([{ ...source('a', 'Read-only evidence'), time: 0, page: -1, fileKey: 'private', url: 'private' }]);
  assert.equal(input[0].time, 0); assert.equal(input[0].page, undefined); assert.ok(!JSON.stringify(input).includes('private'));
  assert.throws(() => new ResearchCorpus(input).plan({ task: 'summary', card_ids: ['b'] }, 'Summary'), /范围外/);
});

void test('provider decodes fragmented tool arguments and retains thinking content for later tool turns', async () => {
  const chunks = [
    { reasoning_content: 'Hidden thought', tool_calls: [{ index: 0, id: 'read-1', function: { name: 'read_', arguments: '{"card_id":' } }] },
    { tool_calls: [{ index: 0, function: { name: 'document', arguments: '"中文卡片"}' } }] },
  ].map(delta => `data: ${JSON.stringify({ choices: [{ delta, finish_reason: null }] })}\n\n`).join('') + `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })}\n\n`;
  const bytes = new TextEncoder().encode(chunks), controller = new AbortController();
  const call = deepseekResearchCall('secret', 'deepseek-flash', controller.signal, async () => new Response(new ReadableStream({ start(out) { for (let i = 0; i < bytes.length; i++) out.enqueue(bytes.slice(i, i + 1)); out.close(); } })));
  const response = await call([{ role: 'user', content: 'Read' }], []);
  assert.equal(response.message.reasoning_content, 'Hidden thought');
  assert.equal(response.message.tool_calls[0].function.name, 'read_document');
  assert.deepEqual(JSON.parse(response.message.tool_calls[0].function.arguments), { card_id: '中文卡片' });
});

void test('provider interruptions never become successful research output', async () => {
  for (const finish_reason of ['aborted', 'content_filter', 'insufficient_system_resource']) {
    const call = deepseekResearchCall('secret', 'deepseek-flash', new AbortController().signal, async () => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Partial draft' }, finish_reason }] })}\n\n`));
    await assert.rejects(call([{ role: 'user', content: 'Research' }]), /尚未完成/);
  }
});
