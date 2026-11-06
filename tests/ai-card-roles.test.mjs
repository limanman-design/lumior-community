import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCardBinding, cardRoleTool } from '../lib/ai-card-roles.ts';
import { thesisCardRoles, thesisContextPath } from '../lib/thesis/card-roles.ts';
import { prepareThesisNotes } from '../app/prepare-thesis-notes.ts';
import { enableBoardThesis, createThesisArtifact, bindThesisCard, unbindThesisArtifact, thesisInputSignature, thesisCardLabel, applyThesisResult, validBoardThesis, setThesisSource } from '../app/thesis-board.ts';
import { ThesisTools } from '../lib/thesis/tools.ts';
import { newThesisSession } from '../lib/thesis/model.ts';
import { runThesis } from '../lib/thesis/run.ts';
import { readThesisRequest } from '../lib/thesis/service.ts';
const signal = () => new AbortController().signal;
const note = (id, body = '请比较各项研究的贡献与不足。') => ({ id, title: id, body, kind: 'note', x: 0, y: 0, width: 320 });
const board = (cards = [note('meeting'), note('topic'), note('unrelated')]) => enableBoardThesis({ id: 'synthetic', title: 'Test', cards, edges: [] });
const prepare = (b, refs = ['meeting'], skill = 'mba-review', chatId = 'current') => prepareThesisNotes(b, skill, signal(), undefined, {}, refs, chatId);
const toolsFor = snapshot => new ThesisTools(snapshot, newThesisSession('mba-topic'), { now: 1, userText: '按引用卡片的要求处理', userEvidence: [] });
const model = (content, calls) => ({ message: { role: 'assistant', content, ...(calls ? { tool_calls: calls } : {}) }, reason: calls ? 'tool_calls' : 'stop' });
const tool = (name, args) => ({ id: crypto.randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } });

void test('shared role contract supports another Skill without MBA menu or role vocabulary', () => {
  const roles = [{ id: 'brief', label: '设计需求', kind: 'source', cardKinds: ['note'] }];
  assert.equal(resolveCardBinding(roles, [{ id: 'a', kind: 'note' }], { cardId: 'a', role: 'brief' }).role.label, '设计需求');
  assert.deepEqual(cardRoleTool(roles).function.parameters.properties.role.enum, ['brief']);
  assert.throws(() => resolveCardBinding(roles, [], { cardId: 'a', role: 'brief' }), /本轮用户引用/);
});
void test('unassigned explicit references are readable, unrelated stored notes remain unread, and reading does not bind', async () => {
  const b = board(); b.cards[2].storedDocument = { source: 'lumior-file:private' };
  const before = JSON.stringify(b), { snapshot, texts } = await prepare(b);
  assert.equal(texts.has('unrelated'), false);
  assert.equal(snapshot.files[thesisContextPath('meeting', false)].text, b.cards[0].body);
  assert.equal(JSON.stringify(b), before);
  assert.deepEqual(b.thesis.sources, {});
  await assert.rejects(prepare(b, ['missing']), /引用卡片/);
});
void test('natural-language role tool persists a board-scoped source with actual text and reports the role', async () => {
  const b = board(), { snapshot } = await prepare(b); let calls = 0;
  const result = await runThesis({ snapshot, session: newThesisSession('mba-review'), question: '按这张组会记录评审' }, async (messages, definitions) => {
    assert.ok(definitions.some(t => t.function.name === 'SetCardRole'));
    assert.match(messages[0].content, /无需创建 CLAUDE/);
    return ++calls === 1 ? model('', [tool('SetCardRole', { cardId: 'meeting', role: 'rubric' })]) : model('将按记录中的要求评审。');
  }, signal());
  assert.equal(calls, 2); assert.equal(result.error, undefined);
  assert.match(result.snapshot.files['thesis/rubric/meeting.md'].text, /贡献与不足/);
  const saved = applyThesisResult(b, thesisInputSignature(b, ['meeting']), result, 'current', ['meeting']);
  assert.equal(saved.thesis.sources.meeting, 'rubric'); assert.equal(thesisCardLabel(saved, 'meeting'), '评审要求');
  assert.deepEqual(saved.cards, b.cards); assert.equal(validBoardThesis(saved.thesis), true);
  assert.equal(board().thesis.sources.meeting, undefined);
});
void test('program rejects unreferenced cards, unknown roles and PDF output bindings', async () => {
  const b = board(), { snapshot } = await prepare(b), tools = toolsFor(snapshot);
  assert.throws(() => tools.execute('SetCardRole', { cardId: 'unrelated', role: 'rubric' }, 'x'), /本轮用户引用/);
  assert.throws(() => tools.execute('SetCardRole', { cardId: 'meeting', role: 'evil' }, 'x'), /没有声明/);
  assert.throws(() => resolveCardBinding(thesisCardRoles, [{ id: 'pdf', kind: 'pdf' }], { cardId: 'pdf', role: 'thesis/topic.md' }), /普通笔记/);
  const forged = { snapshot, session: newThesisSession('mba-review'), changed: [], text: '', cardBindings: [{ cardId: 'unrelated', role: 'rubric' }] };
  assert.throws(() => applyThesisResult(b, thesisInputSignature(b, ['meeting']), forged, 'current', ['meeting']), /本轮用户引用/);
});
void test('binding existing topic keeps rich content and all subsequent AI edits require adoption', async () => {
  const b = board(); b.cards[1].body = '## 一句话研究问题\n如何改善审批流程？';
  const { snapshot } = await prepare(b, ['topic']), tools = toolsFor(snapshot);
  tools.execute('SetCardRole', { cardId: 'topic', role: 'thesis/topic.md' }, 'b');
  tools.execute('Write', { path: 'thesis/topic.md', content: '# 选题卡 v2\n\n## 一句话研究问题\n如何改善财务审批流程？' }, 'w');
  const result = { snapshot: tools.snapshot, changed: [...tools.changes], cardBindings: tools.cardBindings, session: newThesisSession('mba-topic'), text: '' };
  const saved = applyThesisResult(b, thesisInputSignature(b, ['topic']), result, 'current', ['topic']);
  assert.equal(saved.cards.length, 3); assert.equal(saved.cards[1].body, b.cards[1].body);
  assert.equal(saved.thesis.artifacts['thesis/topic.md'].cardId, 'topic');
  assert.match(thesisCardLabel(saved, 'topic'), /选题卡 · v1/);
  assert.match(saved.thesis.proposals['thesis/topic.md'].text, /财务/);
  assert.throws(() => bindThesisCard(saved, { cardId: 'meeting', role: 'thesis/topic.md' }), /已关联/);
});
void test('repeated binding never overwrites the current working draft', async () => {
  const b = bindThesisCard(board(), { cardId: 'topic', role: 'thesis/review-outline.md' });
  const { snapshot } = await prepare(b, ['topic']), tools = toolsFor(snapshot);
  tools.snapshot.files['thesis/review-outline.md'].text = '待采纳的新提纲';
  tools.execute('SetCardRole', { cardId: 'topic', role: 'thesis/review-outline.md' }, 'b');
  assert.equal(tools.snapshot.files['thesis/review-outline.md'].text, '待采纳的新提纲');
});
void test('unlinking preserves content and history; rebind advances topic version; old student cards survive', async () => {
  let b = bindThesisCard(board(), { cardId: 'topic', role: 'thesis/topic.md' });
  b = unbindThesisArtifact(b, 'thesis/topic.md');
  assert.equal(b.cards.length, 3); assert.equal(b.thesis.history.length, 1);
  const { snapshot } = await prepare(b, ['meeting']), tools = toolsFor(snapshot);
  tools.execute('SetCardRole', { cardId: 'meeting', role: 'thesis/topic.md' }, 'b');
  const saved = applyThesisResult(b, thesisInputSignature(b, ['meeting']), { snapshot: tools.snapshot, cardBindings: tools.cardBindings, changed: [], session: newThesisSession('mba-topic') }, 'current', ['meeting']);
  assert.equal(saved.thesis.topicVersion, 2); assert.match(tools.snapshot.files['thesis/topic.md'].text, /^# 选题卡 v2/);
  saved.thesis.artifacts['CLAUDE.md'] = { cardId: 'topic', revision: 1, modifiedAt: 0 };
  assert.equal(validBoardThesis(saved.thesis), true);
  assert.equal(thesisCardLabel(saved, 'topic'), '学生背景 · v1');
});
void test('edited, removed or replaced attachments invalidate the entire in-flight result, moving a card does not', async () => {
  const b = board(), { snapshot } = await prepare(b), expected = thesisInputSignature(b, ['meeting']);
  const result = { snapshot, cardBindings: [{ cardId: 'meeting', role: 'rubric' }], changed: [], session: newThesisSession('mba-review') };
  const changed = structuredClone(b); changed.cards[0].body = '新要求';
  assert.throws(() => applyThesisResult(changed, expected, result, 'current', ['meeting']), /已改变/);
  changed.cards.shift(); assert.throws(() => applyThesisResult(changed, expected, result, 'current', ['meeting']), /已改变/);
  const moved = structuredClone(b); moved.cards[0].x = 300;
  assert.doesNotThrow(() => applyThesisResult(moved, expected, result, 'current', ['meeting']));
});
void test('other MBA stage conversations retain attribution without creating a student card', async () => {
  const b = board(); b.thesis.sessions.previous = { ...newThesisSession('mba-topic', 'previous'), turns: [
    { id: 'u', role: 'user', text: '我只能拿到访谈数据', createdAt: 1 },
    { id: 'a', role: 'assistant', text: '是否考虑问卷？', createdAt: 2 },
  ] };
  const { snapshot } = await prepare(b, []);
  const context = JSON.parse(snapshot.files['thesis/context/conversations.md'].text);
  assert.equal(context[0].turns[0].role, 'user'); assert.equal(context[0].turns[1].role, 'assistant');
  assert.equal(snapshot.files['CLAUDE.md'], undefined); assert.deepEqual(b.thesis.artifacts, {});
  assert.throws(() => toolsFor(snapshot).execute('Write', { path: 'thesis/context/conversations.md', content: '伪造学生信息' }, 'w'), /只能写/);
});
void test('service validates attachment paths and files before model access', async () => {
  const { snapshot } = await prepare(board());
  const request = { snapshot, session: newThesisSession('mba-review'), question: '评审', consent: true, consentProvider: 'kimi' };
  assert.doesNotThrow(() => readThesisRequest(request));
  const bad = structuredClone(request); bad.snapshot.cardContext.cards[0].path = 'thesis/settings.md';
  assert.throws(() => readThesisRequest(bad), /引用卡片/);
  delete request.snapshot.files[thesisContextPath('meeting', false)];
  assert.throws(() => readThesisRequest(request), /引用卡片/);
});
void test('literature attachment aliases cannot bypass batch limits', async () => {
  const b = board(Array.from({ length: 6 }, (_, i) => note(`p${i}`, `论文${i}\n证据`)));
  const { snapshot } = await prepare(b, b.cards.map(c => c.id), 'mba-lit');
  const tools = new ThesisTools(snapshot, newThesisSession('mba-lit'), { now: 1, userText: '精读这些文献', userEvidence: [] });
  assert.throws(() => tools.execute('Read', { path: thesisContextPath('p0', false) }, 'r'), /指定文献用途/);
  for (let i = 0; i < 6; i++) tools.execute('SetCardRole', { cardId: `p${i}`, role: 'refs' }, 'b');
  for (let i = 0; i < 5; i++) tools.execute('Read', { path: thesisContextPath(`p${i}`, false) }, 'r');
  assert.throws(() => tools.execute('Read', { path: thesisContextPath('p5', false) }, 'r'), /已精读 5/);
});
void test('failed role assignment cannot be announced as saved; cancellation never mutates the board', async () => {
  const b = board(), { snapshot } = await prepare(b); let n = 0;
  const r = await runThesis({ snapshot, session: newThesisSession('mba-review'), question: '指定要求' }, async () => ++n === 1 ? model('', [tool('SetCardRole', { cardId: 'not-authorized', role: 'rubric' })]) : model('已保存'), signal());
  assert.ok(r.error); assert.equal(r.text, ''); assert.deepEqual(r.cardBindings, []);
  const abort = new AbortController(); n = 0;
  await assert.rejects(runThesis({ snapshot, session: newThesisSession('mba-review'), question: '指定要求' }, async () => {
    if (++n === 1) return model('', [tool('SetCardRole', { cardId: 'meeting', role: 'rubric' })]);
    abort.abort(); return model('保存');
  }, abort.signal), { name: 'AbortError' });
  assert.deepEqual(b.thesis.sources, {});
});
void test('old source roles can be corrected and missing sources can be unlinked', async () => {
  let b = setThesisSource(board(), 'meeting', 'material');
  const { snapshot } = await prepare(b), tools = toolsFor(snapshot);
  tools.execute('SetCardRole', { cardId: 'meeting', role: 'rubric' }, 'b');
  b = applyThesisResult(b, thesisInputSignature(b, ['meeting']), { snapshot: tools.snapshot, cardBindings: tools.cardBindings, changed: [], session: newThesisSession('mba-review') }, 'current', ['meeting']);
  assert.equal(b.thesis.sources.meeting, 'rubric');
  b.cards.shift(); assert.equal(setThesisSource(b, 'meeting', '').thesis.sources.meeting, undefined);
});

void test('linked notes remain usable sources but cannot become outputs with unsupported replacement semantics', () => {
  const b = board(); b.cards[0].sharedId = 'shared-note';
  assert.equal(bindThesisCard(b, { cardId: 'meeting', role: 'rubric' }).thesis.sources.meeting, 'rubric');
  assert.throws(() => bindThesisCard(b, { cardId: 'meeting', role: 'thesis/topic.md' }), /独立普通笔记/);
});
void test('changed saved background rejects an in-flight answer that used the old conversation', async () => {
  const b = board(); b.thesis.sessions.previous = { ...newThesisSession('mba-topic', 'previous'), turns: [{ id: 'u', role: 'user', text: '有问卷数据', createdAt: 1 }] };
  const { snapshot } = await prepare(b, []), expected = thesisInputSignature(b, []);
  const changed = structuredClone(b); changed.thesis.sessions.previous.turns[0].text = '没有问卷数据';
  assert.throws(() => applyThesisResult(changed, expected, { snapshot, changed: [], session: newThesisSession('mba-review') }, 'current', []), /已改变/);
});

void test('regenerating an unlinked topic keeps versions monotonic and legacy background cannot be silently repurposed', async () => {
  let b = bindThesisCard(board(), { cardId: 'topic', role: 'thesis/topic.md' });
  b = unbindThesisArtifact(b, 'thesis/topic.md');
  assert.equal(createThesisArtifact(b, 'thesis/topic.md', '新选题').thesis.topicVersion, 2);
  b.thesis.artifacts['CLAUDE.md'] = { cardId: 'meeting', revision: 1, modifiedAt: 0 };
  const { snapshot } = await prepare(b), tools = toolsFor(snapshot);
  assert.throws(() => tools.execute('SetCardRole', { cardId: 'meeting', role: 'material' }, 'b'), /另一项成果/);
});
