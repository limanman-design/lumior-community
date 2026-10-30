import test from 'node:test';
import assert from 'node:assert/strict';
import { researchTimeline, researchTimelineLabel, researchActionLabel, researchMilestoneText, researchPresentation, researchStageLabel, safeResearchDisplayText } from '../app/ai-research-presentation.ts';
import { translateForLanguage } from '../app/i18n-core.ts';

const en = (english, chinese, params) => translateForLanguage('en', english, chinese, params);
const message = (process = [], fields = {}) => ({ id: 'answer', role: 'assistant', text: '', live: true, createdAt: 0, status: 'pending', process, ...fields });
const step = (message, elapsed) => ({ message, elapsed });

void test('long checks keep the true stage start and do not imply completed verification', () => {
  const view = researchPresentation(message([
    step('准备本次指定的 1 张资料。', 0),
    step('阅读安排：完整阅读并总结 · 1 张资料，完成后核对回答与引用。', 4),
    step('正在完整阅读：Paper · 已覆盖 61 / 61 段', 15),
    step('正在综合阅读结果…', 15),
    step('正在核对回答、原文引用和问题覆盖情况…', 450),
  ], { elapsed: 600 }));
  assert.equal(view.currentStage, 'checking');
  assert.equal(view.currentStageStartedElapsed, 450);
  assert.equal(view.groups.at(-1).active, true);
  assert.equal(view.groups.at(-1).endedElapsed, undefined);
  assert.equal(view.latestMilestone.kind, 'checking');
  assert.equal(view.verified, false);
  assert.match(researchMilestoneText(view.latestMilestone, en), /I’m checking/);
  assert.doesNotMatch(researchMilestoneText(view.latestMilestone, en), /have been checked|complete|verified/);
});

void test('checking can return to reading without rewriting the earlier checked stage', () => {
  const view = researchPresentation(message([
    step('正在核对回答、原文引用和问题覆盖情况…', 60),
    step('核对发现需要补充证据，正在继续查找原文…', 90),
    step('正在读取《Paper》原文…', 91),
    step('已取得原文：《Paper》 · PDF 第 4 页 · 2 段；累计读取 12 段。', 95),
    step('正在核对回答、原文引用和问题覆盖情况…', 110),
  ]));
  assert.deepEqual(view.groups.map(group => group.stage), ['checking', 'reading', 'reading', 'checking']);
  assert.deepEqual(view.groups.map(group => group.action), ['checking', 'supplement', 'evidence-reading', 'checking']);
  assert.deepEqual(view.groups.map(group => group.startedElapsed), [60, 90, 91, 110]);
  assert.equal(view.groups[0].endedElapsed, 90);
  assert.equal(view.groups[1].endedElapsed, 91);
  assert.equal(view.groups[2].endedElapsed, 110);
  assert.equal(view.groups[3].active, true);
  assert.equal(view.verified, false);
  assert.match(researchMilestoneText(view.milestones.find(value => value.kind === 'supplement'), en), /more evidence/);
});

void test('the vertical action sequence includes only observed work and preserves later revisits', () => {
  const records = [
    step('准备本次指定的 2 张资料。', 0),
    step('正在理解问题，检查 2 张卡片的资料目录，制定阅读安排…', 2),
    step('阅读安排：针对问题查证 · 2 张资料，完成后核对回答与引用。', 3),
    step('正在扩展查询：AI信任…', 4),
    step('查询结果：在 2 张卡片中找到 0 段候选原文，尚待读取核对。', 5),
    step('正在按含义查找：trust…', 6),
    step('按含义查找：已检查 6 / 6 段，找到 2 段候选原文，尚待读取核对。', 7),
    step('正在读取《AI信任》原文…', 8),
    step('正在核对回答、原文引用和问题覆盖情况…', 10),
    step('核对发现需要补充证据，正在继续查找原文…', 12),
    step('正在按含义查找：信任边界…', 13),
    step('正在读取《AI信任》原文…', 14),
    step('正在核对回答、原文引用和问题覆盖情况…', 16),
    step('回答与原文引用核对完成，正在逐段呈现结果…', 18),
  ];
  const early = researchPresentation(message(records.slice(0, 3)));
  assert.deepEqual(early.groups.map(group => group.action), ['preparing', 'planning']);
  assert.equal(early.groups.some(group => group.action === 'checking'), false);
  const view = researchPresentation(message(records));
  assert.deepEqual(view.groups.map(group => group.action), ['preparing', 'planning', 'keyword-search', 'semantic-search', 'evidence-reading', 'checking', 'supplement', 'semantic-search', 'evidence-reading', 'checking', 'answering']);
  assert.equal(view.groups.some(group => group.action === 'full-reading'), false);
  assert.equal(view.groups.some(group => group.action === 'synthesizing'), false);
  assert.equal(view.currentAction, 'answering');
  assert.equal(view.currentActionStartedElapsed, 18);
  assert.equal(view.groups.filter(group => group.active).length, 1);
  assert.equal(view.latestMilestone.kind, 'presenting');
  assert.equal(view.verified, true);
  assert.match(researchMilestoneText(view.latestMilestone, en), /presenting the result in parts/);
});

void test('source-free work and unknown history never fabricate reading or verification steps', () => {
  const short = researchPresentation(message([
    step('正在理解问题，整理回答重点…', 0),
    step('本次回答已整理完成。', 2),
  ]));
  assert.deepEqual(short.groups.map(group => group.action), ['planning', 'synthesizing']);
  assert.equal(short.verified, false);
  const legacy = researchPresentation(message([step('旧版本的公开活动', 3), step('An unfamiliar recorded update', 4)]));
  assert.deepEqual(legacy.groups.map(group => group.action), ['record']);
  assert.equal(legacy.currentAction, 'record');
  assert.equal(legacy.steps.every(step => !step.recognized), true);
  assert.equal(researchActionLabel('record', undefined, en), 'Research activity');
  const noEvents = researchPresentation(message([], { status: 'streaming' }));
  assert.equal(noEvents.groups.length, 0);
  assert.equal(noEvents.currentAction, 'record');
});

void test('recorded plans and coverage adapt labels to summary, comparison, question and synthesis', () => {
  const cases = [
    ['summary', '完整阅读并总结', /总结/, /summary/],
    ['comparison', '完整阅读并比较', /比较/, /comparing/i],
    ['question', '针对问题查证', /证据/, /evidence/],
    ['synthesis', '查找证据并综合分析', /分析/, /analysis/],
  ];
  for (const [task, label, zhPattern, enPattern] of cases) {
    const view = researchPresentation(message([
      step(`阅读安排：${label} · 2 张资料，完成后核对回答与引用。`, 2),
      step('正在综合阅读结果…', 4),
    ]));
    assert.equal(view.task, task);
    assert.match(researchActionLabel(view.currentAction, view.task), zhPattern);
    assert.match(researchActionLabel(view.currentAction, view.task, en), enPattern);
    assert.match(researchMilestoneText(view.latestMilestone, en, view.task), enPattern);
    const coverageOnlyTask = researchPresentation(message([step('正在完整阅读：Paper · 已覆盖 1 / 6 段', 1)], { context: { coverage: { task, readPassages: 1, totalPassages: 6 } } }));
    assert.equal(coverageOnlyTask.task, task);
    assert.deepEqual(coverageOnlyTask.groups.map(group => group.action), ['full-reading']);
  }
  const planWins = researchPresentation(message([step('阅读安排：完整阅读并比较 · 2 张资料，完成后核对回答与引用。', 1)], { context: { coverage: { task: 'summary' } } }));
  assert.equal(planWins.task, 'comparison');
});

void test('English public records classify actual search methods and final output', () => {
  const view = researchPresentation(message([
    step('Reading plan: Read in full and compare · 2 sources; then check the answer and citations.', 1),
    step('Reading in full: Paper · 2 / 3 passages covered', 2),
    step('Expanding queries: comparison…', 3),
    step('Searching by meaning: relevance…', 4),
    step('Reading source: Paper…', 5),
    step('Checking the answer, source citations, and question coverage…', 6),
    step('Answer and source citations checked. Presenting the results…', 7),
  ]));
  assert.deepEqual(view.groups.map(group => group.action), ['planning', 'full-reading', 'keyword-search', 'semantic-search', 'evidence-reading', 'checking', 'answering']);
  assert.equal(view.task, 'comparison');
  assert.equal(view.currentActionStartedElapsed, 7);
  assert.equal(view.verified, true);
  assert.equal(view.milestones.find(item => item.kind === 'coverage').read, 2);
  assert.equal(view.milestones.find(item => item.kind === 'plan').sourceCount, 2);
});

void test('a generic evidence activity does not claim a search method before the tool reports one', () => {
  const generic = researchPresentation(message([step('正在查找证据并读取前后文…', 3)]));
  assert.equal(generic.currentAction, 'evidence-search');
  assert.equal(researchActionLabel(generic.currentAction), '查找原文证据');
  const semantic = researchPresentation(message([step('Searching for relevant source text by meaning…', 3)]));
  assert.equal(semantic.currentAction, 'semantic-search');
});

void test('action timing resets on actual method changes while broad reading timing remains true', () => {
  const view = researchPresentation(message([
    step('正在完整阅读：Paper · 已覆盖 1 / 3 段', 5),
    step('正在按含义查找：关键词…', 15),
    step('Unknown public update', 20),
  ]));
  assert.equal(view.currentStage, 'reading');
  assert.equal(view.currentStageStartedElapsed, 5);
  assert.equal(view.currentAction, 'semantic-search');
  assert.equal(view.currentActionStartedElapsed, 15);
  assert.equal(view.groups.at(-1).steps.length, 2);
  assert.equal(view.steps.at(-1).recognized, false);
});

void test('coverage counts and titles reflect recorded data and consecutive updates are coalesced', () => {
  const view = researchPresentation(message([
    step('正在完整阅读：AI信任 · Trust in AI · 已覆盖 45 / 61 段', 15),
    step('正在完整阅读：AI信任 · Trust in AI · 已覆盖 61 / 61 段', 16),
  ]));
  assert.equal(view.steps.length, 2);
  assert.equal(view.milestones.length, 1);
  assert.deepEqual({ title: view.latestMilestone.title, read: view.latestMilestone.read, total: view.latestMilestone.total }, { title: 'AI信任 · Trust in AI', read: 61, total: 61 });
  assert.match(researchMilestoneText(view.latestMilestone, en), /61 of 61 passages/);
  assert.equal(view.verified, false);
  assert.equal(researchPresentation(message([step('正在完整阅读：Paper · 已覆盖 99 / 61 段', 0)])).latestMilestone, undefined);
});

void test('search candidates remain candidates even after all passages have been searched', () => {
  for (const record of [
    '查询结果：在 2 张卡片中找到 3 段候选原文，尚待读取核对。',
    '按含义查找：已检查 61 / 61 段，找到 0 段候选原文，尚待读取核对。',
  ]) {
    const view = researchPresentation(message([step(record, 15)], { status: 'complete' }));
    assert.equal(view.verified, false);
    assert.equal(view.latestMilestone.kind, 'search');
    assert.match(researchMilestoneText(view.latestMilestone, en), /still need to be read and checked/);
    assert.doesNotMatch(researchMilestoneText(view.latestMilestone, en), /no evidence|verified|research is complete/);
  }
});

void test('stopped and interrupted records do not leave any active stages or invent verification', () => {
  for (const status of ['stopped', 'interrupted', 'error']) {
    const view = researchPresentation(message([
      step('正在核对回答、原文引用和问题覆盖情况…', 30),
      step('已停止，保留已完成的研究记录。', 45),
    ], { status, elapsed: 46 }));
    assert.equal(view.active, false);
    assert.equal(view.groups.some(group => group.active), false);
    assert.equal(view.groups.at(-1).endedElapsed, 46);
    assert.equal(view.currentStage, 'checking');
    assert.equal(view.verified, false);
    assert.equal(view.steps.at(-1).recognized, false);
  }
});

void test('actual verified events and saved coverage enable verification, bare complete status does not', () => {
  assert.equal(researchPresentation(message([], { status: 'complete' })).verified, false);
  assert.equal(researchPresentation(message([step('本次回答已整理完成。', 30)], { status: 'complete' })).verified, false);
  const verified = researchPresentation(message([step('回答与原文引用核对完成，正在呈现结果…', 30)]));
  assert.equal(verified.verified, true);
  assert.equal(verified.latestMilestone.kind, 'verified');
  assert.equal(researchPresentation(message([], { context: { coverage: { verified: true } } })).verified, true);
});

void test('legacy progress fallback and unfamiliar records remain usable without fabricated milestones', () => {
  const legacy = researchPresentation(message(undefined, { process: undefined, progress: 'Reading page 2', elapsed: 8 }));
  assert.equal(legacy.currentStage, 'reading');
  assert.equal(legacy.steps[0].elapsed, 8);
  assert.equal(legacy.latestMilestone, undefined);
  const unknown = researchPresentation(message([step('Reading page 2', 5), step('Unknown provider event: safe text', 8)]));
  assert.equal(unknown.currentStage, 'reading');
  assert.equal(unknown.steps[1].displayMessage, 'Unknown provider event: safe text');
  assert.equal(unknown.steps[1].recognized, false);
  assert.equal(unknown.latestMilestone, undefined);
  assert.equal(researchPresentation(message([], { process: undefined, progress: undefined })).groups.length, 0);
});

void test('display summaries remove UUIDs and card identifiers without changing saved history', () => {
  const id = 'fcf5a4ef-cbdd-45b9-8b87-951a68621438';
  const original = message([step(`问题重点：完整覆盖卡片 ${id}；card_ids=["${id}","custom-card-id"]`, 5)], { context: { cardIds: ['custom-card-id'], sources: [] } });
  const before = JSON.stringify(original);
  const view = researchPresentation(original);
  assert.doesNotMatch(view.steps[0].displayMessage, /fcf5a4ef|card_ids|custom-card-id/);
  assert.doesNotMatch(researchMilestoneText(view.latestMilestone, en), /fcf5a4ef|card_ids|custom-card-id/);
  assert.equal(view.steps[0].message, original.process[0].message);
  assert.equal(JSON.stringify(original), before);
  assert.equal(safeResearchDisplayText('Read AI-paper; card_id=source_47', ['AI-paper']), 'Read …');
  assert.equal(safeResearchDisplayText('{"card_id":"source_47"}'), '{…}');
  assert.equal(safeResearchDisplayText('卡片custom-card-id的全文', ['custom-card-id']), '卡片…的全文');
});

void test('reading plan copy is bilingual and future tense; extracted evidence preserves true counts and titles', () => {
  const plan = researchPresentation(message([step('阅读安排：完整阅读并比较 · 5 张资料，完成后核对回答与引用。', 2)])).latestMilestone;
  assert.equal(plan.task, 'comparison');
  assert.match(researchMilestoneText(plan, en), /I’ll read all 5 sources/);
  assert.match(researchMilestoneText(plan), /完整阅读这 5 份资料/);
  const evidence = researchPresentation(message([step('已取得原文：《AI信任》 · PDF 第 7 页 · 2 段，仍有 3 段待继续读取；累计读取 4 段。', 8)])).latestMilestone;
  assert.deepEqual(evidence.titles, ['AI信任']);
  assert.equal(evidence.added, 2);
  assert.equal(evidence.read, 4);
  assert.equal(evidence.remaining, 3);
  assert.match(researchMilestoneText(evidence, en), /AI信任/);
  assert.match(researchMilestoneText(evidence, en), /4 passages in total/);
  assert.match(researchMilestoneText(evidence, en), /3 passages still need to be read/);
  assert.equal(researchStageLabel('reading', en), 'Reading sources');
});

void test('a later unknown detail keeps the earlier milestone as a recorded update, without inventing findings', () => {
  const original = message([
    step('正在完整阅读：Paper · 已覆盖 10 / 61 段', 15),
    step('An unfamiliar server update', 28),
    step('正在继续查证 · 第 3 轮…', 45),
  ]);
  const before = JSON.stringify(original);
  const view = researchPresentation(original);
  assert.equal(view.steps.at(-1).elapsed, 45);
  assert.equal(view.latestMilestone.elapsed, 15);
  assert.equal(view.latestMilestone.read, 10);
  assert.equal(view.milestones.length, 1);
  assert.equal(view.verified, false);
  assert.equal(view.currentStageStartedElapsed, 15);
  assert.match(researchMilestoneText(view.latestMilestone, en), /10 of 61/);
  assert.doesNotMatch(researchMilestoneText(view.latestMilestone, en), /45|checked|found|complete/);
  assert.equal(JSON.stringify(original), before);
});
test('position-only operations show layout work without inventing research or citation checks',()=>{
 const view=researchPresentation(message([
  step('正在按卡片尺寸准备排布，不读取资料正文…',0),
  step('正在准备卡片排布…',1),
  step('正在核对画板排布与操作范围…',3),
  step('画板排布已核对，正在呈现结果…',4),
 ]));
 assert.deepEqual(view.groups.map(group=>group.action),['canvas-layout','canvas-checking','canvas-ready']);
 assert.match(researchActionLabel(view.groups[0].action),/画板整理/);
 assert.equal(view.groups.some(group=>group.stage==='reading'),false);
});

void test('repeated reading and draft cycles become one work phase with persistent factual updates', () => {
  const records = [step('阅读安排：查找证据并综合分析 · 1 张资料，完成后核对回答与引用。', 0)];
  for (let i = 1; i <= 8; i++) records.push(
    step(`已取得原文：《课程材料》 · 1 段；累计读取 ${i} 段。`, i * 10),
    step(`已准备第 ${i} 张卡片草稿：《第 ${i} 课》；核对后才会保存。`, i * 10 + 2),
    step('进展摘要：下一步会把例子与练习对应起来。', i * 10 + 3));
  const original = message(records); const before = JSON.stringify(original);
  const timeline = researchTimeline(researchPresentation(original));
  assert.deepEqual(timeline.map(group=>group.phase), ['preparing','working']);
  assert.equal(timeline[1].active, true);
  assert.equal(timeline[1].updates.filter(update=>update.kind==='draft').length, 8);
  assert.equal(timeline[1].updates.filter(update=>update.kind==='evidence').length, 8);
  assert.equal(timeline[1].updates.filter(update=>update.kind==='update').length, 8);
  assert.match(researchMilestoneText(timeline[1].updates.find(update=>update.kind==='draft')), /第 1 张.*第 1 课.*核对后才会保存/);
  assert.equal(researchTimelineLabel(timeline[1]), '查阅与整理资料');
  assert.equal(JSON.stringify(original), before);
  const checked = researchTimeline(researchPresentation(message([...records,step('正在核对回答、原文引用和问题覆盖情况…',90)],{status:'stopped',elapsed:110})));
  assert.deepEqual(checked.map(group=>group.phase),['preparing','working','checking']);
  assert.equal(checked.some(group=>group.active),false);
  assert.equal(checked.at(-1).endedElapsed,110);
  assert.equal(checked[1].updates.length,24);
});

void test('a genuine return to sources remains visible after checking, without claiming completion', () => {
 const timeline=researchTimeline(researchPresentation(message([
  step('正在核对回答、原文引用和问题覆盖情况…',30),
  step('核对发现需要补充证据，正在继续查找原文…',40),
  step('正在读取《Paper》原文…',41),
  step('正在核对回答、原文引用和问题覆盖情况…',50),
 ])));
 assert.deepEqual(timeline.map(group=>group.phase),['checking','working','checking']);
 assert.equal(timeline[1].updates[0].kind,'supplement');
 assert.equal(timeline.at(-1).updates[0].kind,'checking');
});
