import type { AiMessage, AiProcessStep } from './ai-chat-store';
import type { AiTranslate } from './ai-ui-text';

export type ResearchStage = 'preparing' | 'reading' | 'synthesizing' | 'checking';
export type ResearchTask = 'question' | 'summary' | 'comparison' | 'synthesis';
export type ResearchAction = 'preparing' | 'planning' | 'full-reading' | 'keyword-search' | 'semantic-search' | 'evidence-search' | 'evidence-reading' | 'synthesizing' | 'checking' | 'supplement' | 'answering' | 'record' | 'canvas-layout' | 'canvas-checking' | 'canvas-ready';
type MilestoneBase = { id: string; elapsed: number; stage: ResearchStage };
export type ResearchMilestone = MilestoneBase & (
  | { kind: 'plan'; task: 'question' | 'summary' | 'comparison' | 'synthesis'; sourceCount?: number }
  | { kind: 'focus'; text: string }
  | { kind: 'coverage'; title: string; read: number; total: number }
  | { kind: 'search'; method: 'keyword' | 'semantic'; found: number; cards?: number; read?: number; total?: number }
  | { kind: 'evidence'; text: string; titles: string[]; read: number; added?: number; remaining?: number }
  | { kind: 'synthesizing'; merged: boolean }
  | { kind: 'checking' }
  | { kind: 'supplement' }
  | { kind: 'presenting' }
  | { kind: 'verified' }
);
export type PresentedResearchStep = AiProcessStep & {
  id: string;
  displayMessage: string;
  stage: ResearchStage;
  action: ResearchAction;
  /** Unknown legacy records inherit the current stage without claiming a new action. */
  recognized: boolean;
};
export type ResearchStageGroup = {
  id: string;
  stage: ResearchStage;
  action: ResearchAction;
  startedElapsed: number;
  endedElapsed?: number;
  active: boolean;
  steps: PresentedResearchStep[];
};
export type ResearchPresentation = {
  active: boolean;
  currentStage: ResearchStage;
  currentStageStartedElapsed: number;
  task?: ResearchTask;
  currentAction: ResearchAction;
  currentActionStartedElapsed: number;
  groups: ResearchStageGroup[];
  steps: PresentedResearchStep[];
  milestones: ResearchMilestone[];
  latestMilestone?: ResearchMilestone;
  verified: boolean;
};

const chinese: AiTranslate = (_en, zh, params) => zh.replace(/\{(\w+)\}/g, (placeholder, key) => String(params?.[key] ?? placeholder));

export function researchStageLabel(stage: ResearchStage, t: AiTranslate = chinese) {
  if (stage === 'preparing') return t('Preparing sources', '准备资料');
  if (stage === 'reading') return t('Reading sources', '阅读资料');
  if (stage === 'synthesizing') return t('Organizing the answer', '整理回答');
  return t('Checking the answer and citations', '核对回答与引用');
}

/** Labels describe actions that have actually started, not a fixed promised plan. */
export function researchActionLabel(action: ResearchAction, task?: ResearchTask, t: AiTranslate = chinese) {
  switch (action) {
    case 'preparing': return t('Preparing sources', '准备资料');
    case 'planning': return task === 'summary' ? t('Planning the summary', '制定总结安排')
      : task === 'comparison' ? t('Planning the comparison', '制定比较安排')
      : task === 'synthesis' ? t('Planning the analysis', '制定分析安排')
      : task === 'question' ? t('Planning the evidence search', '安排问题查证') : t('Planning the task', '安排任务');
    case 'full-reading': return task === 'comparison' ? t('Reading the sources to compare', '全文阅读待比较资料') : t('Reading in full', '全文阅读');
    case 'keyword-search': return t('Searching by keyword', '关键词查找');
    case 'semantic-search': return t('Searching by meaning', '按含义查找');
    case 'evidence-search': return t('Finding source evidence', '查找原文证据');
    case 'evidence-reading': return t('Reading source evidence', '读取原文证据');
    case 'synthesizing': return task === 'comparison' ? t('Comparing sources and organizing the answer', '比较资料与组织回答')
      : task === 'summary' ? t('Organizing the summary', '组织总结')
      : task === 'synthesis' ? t('Combining evidence and analysis', '综合证据与分析') : t('Organizing evidence and the answer', '整理证据与回答');
    case 'checking': return t('Checking the answer and citations', '核对回答与引用');
    case 'supplement': return t('Finding additional evidence', '补充证据');
    case 'answering': return t('Presenting the answer', '呈现回复');
    case 'canvas-layout': return t('Preparing canvas changes', '准备画板整理');
    case 'canvas-checking': return t('Checking layout and scope', '核对排布与操作范围');
    case 'canvas-ready': return t('Canvas plan checked', '画板方案已核对');
    case 'record': return t('Research activity', '研究活动');
  }
}

/** This display copy describes recorded actions, never the provider's private reasoning. */
export function researchMilestoneText(milestone: ResearchMilestone, t: AiTranslate = chinese, task?: ResearchTask): string {
  switch (milestone.kind) {
    case 'plan': {
      const count = milestone.sourceCount;
      if (milestone.task === 'summary') return count == null
        ? t('I’ll read the sources in full, then summarize them and check the citations.', '我会完整阅读资料，再整理总结并核对引用。')
        : t('I’ll read all {count} sources, then summarize them and check the citations.', '我会完整阅读这 {count} 份资料，再整理总结并核对引用。', { count });
      if (milestone.task === 'comparison') return count == null
        ? t('I’ll read the sources in full, compare them, and check the citations.', '我会完整阅读资料，比较其中的内容，再核对引用。')
        : t('I’ll read all {count} sources, compare them, and check the citations.', '我会完整阅读这 {count} 份资料，比较其中的内容，再核对引用。', { count });
      if (milestone.task === 'synthesis') return count == null
        ? t('I’ll find and read source evidence, then combine the findings and check the citations.', '我会查找并阅读原文证据，再综合分析这些资料并核对引用。')
        : t('I’ll find and read evidence from {count} sources, then combine the findings and check the citations.', '我会从 {count} 份资料中查找并阅读原文证据，再综合分析并核对引用。', { count });
      return count == null
        ? t('I’ll find and read source evidence for your question, then check the answer and citations.', '我会围绕你的问题查找并阅读原文证据，再核对回答与引用。')
        : t('I’ll find and read evidence from {count} sources for your question, then check the answer and citations.', '我会围绕你的问题，从 {count} 份资料中查找并阅读原文证据，再核对回答与引用。', { count });
    }
    case 'focus': return t('I’m focusing on: {focus}', '这次会重点围绕：{focus}', { focus: milestone.text });
    case 'coverage': return t('I’ve covered {read} of {total} passages while reading “{title}”.', '正在阅读《{title}》，已覆盖 {read} / {total} 段。', { title: milestone.title, read: milestone.read, total: milestone.total });
    case 'search': return milestone.method === 'semantic'
      ? t('I’ve checked {read} of {total} passages by meaning and found {found} candidates. They still need to be read and checked.', '已按含义检查 {read} / {total} 段，找到 {found} 段候选原文；接下来还需要读取核对。', { read: milestone.read ?? 0, total: milestone.total ?? 0, found: milestone.found })
      : t('I found {found} candidate passages across {cards} cards. They still need to be read and checked.', '在 {cards} 张资料卡片中找到 {found} 段候选原文；接下来还需要读取核对。', { cards: milestone.cards ?? 0, found: milestone.found });
    case 'evidence': {
      const titles = milestone.titles.map(title => t('“{title}”', '《{title}》', { title })).join(t(', ', '、'));
      const source = titles ? t(' from {titles}', '，其中包括{titles}', { titles }) : '';
      const remaining = milestone.remaining ? t(' {remaining} passages still need to be read.', ' 还有 {remaining} 段需要继续读取。', { remaining: milestone.remaining }) : '';
      return t('I’ve obtained source text{source} and read {read} passages in total.', '已取得原文{source}，累计读取 {read} 段。', { source, read: milestone.read }) + remaining;
    }
    case 'synthesizing': return milestone.merged
      ? t('I’m combining the reading notes, keeping the evidence and its limitations.', '我正在合并阅读笔记，保留原文证据和研究局限。')
      : task === 'comparison' ? t('I’m comparing the sources and organizing their similarities and differences.', '我正在比较这些资料，整理相同点和差异。')
      : task === 'summary' ? t('I’m organizing the full reading results into a summary.', '我正在把全文阅读结果整理成总结。')
      : task === 'synthesis' ? t('I’m combining the evidence into an analysis.', '我正在汇总原文证据，组织综合分析。')
      : task === 'question' ? t('I’m organizing the source evidence into an answer to your question.', '我正在整理原文证据，围绕你的问题组织回答。')
      : t('I’m organizing the reading results into an answer.', '我正在把阅读结果整理成回答。');
    case 'checking': return t('I’m checking the answer against the source citations and your question.', '我正在核对回答、原文引用，以及是否覆盖了你的问题。');
    case 'supplement': return t('The review called for more evidence. I’m returning to the sources to find it.', '核对时发现还需要补充证据，我正在回到原文继续查找。');
    case 'presenting': return t('The answer and source citations have been checked. I’m presenting the result in parts.', '回答与原文引用已核对完成，正在逐段呈现结果。');
    case 'verified': return t('The answer and source citations have been checked. I’m presenting the results.', '回答与原文引用已核对完成，正在呈现结果。');
  }
}

const uuid = /\b[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\b/gi;
/** Sanitization is presentation-only: the original saved records stay intact. */
export function safeResearchDisplayText(text: string, cardIds: readonly string[] = []): string {
  let display = text.replace(/\p{Cc}/gu, ' ').replace(/["']?\bcard_ids?["']?\s*[=:：]\s*(?:\[[^\]]*\]|"[^"]*"|'[^']*'|[\w.:-]+)/gi, '…').replace(/\bcard_ids?\b/gi, '…').replace(uuid, '…');
  for (const id of [...new Set(cardIds)].filter(id => id.length >= 3).sort((a, b) => b.length - a.length)) {
    // IDs used in saved plans are tokens; never remove a short ID inside a title.
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    display = display.replace(new RegExp(`(^|[^a-zA-Z0-9_])${escaped}(?=$|[^a-zA-Z0-9_])`, 'g'), '$1…');
  }
  return display.replace(/…(?:[\s、，,；;]+…)+/g, '…').replace(/\s+/g, ' ').trim();
}

function actionFor(text: string): ResearchAction | undefined {
  if (/^(?:正在按卡片尺寸准备排布|正在准备卡片排布|正在准备画板操作|Preparing (?:the (?:card )?layout|canvas changes))/.test(text)) return 'canvas-layout';
  if (/^(?:正在核对画板排布|画板操作核对尚未通过|Checking layout and scope|Canvas changes have not passed verification)/.test(text)) return 'canvas-checking';
  if (/^(?:画板(?:排布|操作)已核对|本次画板排布已完成|Canvas (?:layout|changes) verified|Canvas layout complete)/.test(text)) return 'canvas-ready';
  if (/^(?:回答与原文引用核对完成|已核对回答与引用，研究完成|Answer and source citations checked|The answer and citations have been checked)/.test(text)) return 'answering';
  if (/^(?:正在核对回答|Checking the answer, source citations)/.test(text)) return 'checking';
  if (/^(?:正在综合阅读结果|正在合并各部分阅读笔记|本次回答已整理完成|Combining the reading results|Merging reading notes|The answer is ready)/.test(text)) return 'synthesizing';
  if (/^(?:核对发现需要补充证据|More evidence is needed)/.test(text)) return 'supplement';
  if (/^(?:正在完整阅读|Reading in full:)/.test(text)) return 'full-reading';
  if (/^(?:正在按含义查找|按含义查找：|Searching by meaning|Searching for relevant source text by meaning|Semantic search:)/.test(text)) return 'semantic-search';
  if (/^(?:正在扩展查询|查询结果：|Expanding queries|Search results:)/.test(text)) return 'keyword-search';
  if (/^(?:正在查找证据|本次资料查找未完成|Source search did not finish|Searching for relevant source text|Finding evidence)/.test(text)) return 'evidence-search';
  if (/^(?:正在读取|已取得原文|正在继续查证|Reading(?: source:| matching passages| page \d|:)|Source text obtained:|Continuing verification)/.test(text)) return 'evidence-reading';
  if (/^(?:正在理解问题|阅读安排：|问题重点：|Understanding the question|Reading plan:|Question focus:)/.test(text)) return 'planning';
  if (/^(?:准备(?:原问题的|本次指定的|当前画板的)|正在准备资料：|资料已准备，开始分析问题|正在检查资料|Preparing (?:\d+ sources|the \d+ selected sources|source:)|Sources are ready|Checking (?:whether the source|the source-reading request))/.test(text)) return 'preparing';
  return undefined;
}

function stageForAction(action: ResearchAction): ResearchStage {
  if (action === 'canvas-layout') return 'synthesizing';
  if (action === 'canvas-checking' || action === 'canvas-ready') return 'checking';
  if (action === 'answering' || action === 'checking') return 'checking';
  if (action === 'synthesizing') return 'synthesizing';
  if (action === 'preparing' || action === 'planning' || action === 'record') return 'preparing';
  return 'reading';
}

function taskFor(text: string): ResearchTask | undefined {
  const match = text.match(/^阅读安排：(针对问题查证|完整阅读并总结|完整阅读并比较|查找证据并综合分析)/)
    || text.match(/^Reading plan: (Verify the question|Read in full and summarize|Read in full and compare|Find evidence and synthesize)/);
  const tasks: Record<string, ResearchTask> = { '针对问题查证': 'question', '完整阅读并总结': 'summary', '完整阅读并比较': 'comparison', '查找证据并综合分析': 'synthesis', 'Verify the question': 'question', 'Read in full and summarize': 'summary', 'Read in full and compare': 'comparison', 'Find evidence and synthesize': 'synthesis' };
  return match ? tasks[match[1]] : undefined;
}

function milestoneFor(step: PresentedResearchStep): ResearchMilestone | undefined {
  const base = { id: step.id, elapsed: step.elapsed, stage: step.stage };
  const text = step.displayMessage;
  let match = text.match(/^阅读安排：(针对问题查证|完整阅读并总结|完整阅读并比较|查找证据并综合分析)(?: · (\d+) 张资料)?，完成后核对回答与引用。$/);
  if (match) {
    const tasks = { '针对问题查证': 'question', '完整阅读并总结': 'summary', '完整阅读并比较': 'comparison', '查找证据并综合分析': 'synthesis' } as const;
    return { ...base, kind: 'plan', task: tasks[match[1] as keyof typeof tasks], ...(match[2] ? { sourceCount: Number(match[2]) } : {}) };
  }
  match = text.match(/^Reading plan: (Verify the question|Read in full and summarize|Read in full and compare|Find evidence and synthesize)(?: · (\d+) sources)?; then check the answer and citations\.$/);
  if (match) return { ...base, kind: 'plan', task: taskFor(text)!, ...(match[2] ? { sourceCount: Number(match[2]) } : {}) };
  match = text.match(/^(?:问题重点：|Question focus: )(.+)$/);
  if (match) return { ...base, kind: 'focus', text: match[1].length > 240 ? match[1].slice(0, 239) + '…' : match[1] };
  match = text.match(/^正在完整阅读：(.+) · 已覆盖 (\d+) \/ (\d+) 段$/) || text.match(/^Reading in full: (.+) · (\d+) \/ (\d+) passages covered$/);
  if (match && Number(match[2]) <= Number(match[3])) return { ...base, kind: 'coverage', title: match[1], read: Number(match[2]), total: Number(match[3]) };
  match = text.match(/^查询结果：在 (\d+) 张卡片中找到 (\d+) 段候选原文，尚待读取核对。$/);
  if (match) return { ...base, kind: 'search', method: 'keyword', cards: Number(match[1]), found: Number(match[2]) };
  match = text.match(/^Search results: (\d+) candidate passages in (\d+) cards await reading and verification\.$/);
  if (match) return { ...base, kind: 'search', method: 'keyword', cards: Number(match[2]), found: Number(match[1]) };
  match = text.match(/^按含义查找：已检查 (\d+) \/ (\d+) 段，找到 (\d+) 段候选原文，尚待读取核对。$/) || text.match(/^Semantic search: checked (\d+) \/ (\d+) passages; (\d+) candidates await reading and verification\.$/);
  if (match && Number(match[1]) <= Number(match[2])) return { ...base, kind: 'search', method: 'semantic', read: Number(match[1]), total: Number(match[2]), found: Number(match[3]) };
  match = text.match(/^已取得原文：(.+)；累计读取 (\d+) 段。$/);
  if (match) {
    const added = match[1].match(/ · (\d+) 段(?:，|$)/);
    const remaining = match[1].match(/仍有 (\d+) 段待继续读取/);
    return { ...base, kind: 'evidence', text: match[1], titles: [...match[1].matchAll(/《([^》]+)》/g)].map(value => value[1]), read: Number(match[2]), ...(added ? { added: Number(added[1]) } : {}), ...(remaining ? { remaining: Number(remaining[1]) } : {}) };
  }
  if (/^(?:正在综合阅读结果…|正在合并各部分阅读笔记，保留证据与研究局限…|Combining the reading results…|Merging reading notes while retaining evidence and limitations…)$/.test(text)) return { ...base, kind: 'synthesizing', merged: text.startsWith('正在合并') || text.startsWith('Merging') };
  if (text === '正在核对回答、原文引用和问题覆盖情况…' || text === 'Checking the answer, source citations, and question coverage…') return { ...base, kind: 'checking' };
  if (text === '核对发现需要补充证据，正在继续查找原文…' || text === 'More evidence is needed. Continuing to search the sources…') return { ...base, kind: 'supplement' };
  if (text === '回答与原文引用核对完成，正在逐段呈现结果…' || text === 'Answer and source citations checked. Presenting the results in parts…') return { ...base, kind: 'presenting' };
  if (text === '回答与原文引用核对完成，正在呈现结果…' || text === '已核对回答与引用，研究完成。' || text === 'Answer and source citations checked. Presenting the results…' || text === 'The answer and citations have been checked. Research is complete.') return { ...base, kind: 'verified' };
  return undefined;
}

function milestoneKey(value: ResearchMilestone) {
  if (value.kind === 'coverage') return `${value.kind}:${value.title}`;
  if (value.kind === 'search') return `${value.kind}:${value.method}`;
  return value.kind;
}

/** Derive a layered view from saved observable events without changing history. */
export function researchPresentation(message: AiMessage): ResearchPresentation {
  const active = ['preparing', 'pending', 'streaming'].includes(message.status || '');
  const recorded = (message.process || []).filter(step => step && typeof step.message === 'string' && Number.isFinite(step.elapsed) && step.elapsed >= 0);
  const records = [...recorded];
  if (message.progress && records.at(-1)?.message !== message.progress) records.push({ message: message.progress, elapsed: Number.isFinite(message.elapsed) && message.elapsed! >= 0 ? message.elapsed! : records.at(-1)?.elapsed ?? 0 });
  const cardIds = [...(message.context?.cardIds || []), ...(message.context?.sources?.map(source => source.id) || []), ...(message.references?.map(reference => reference.id) || [])];
  const steps: PresentedResearchStep[] = [];
  const groups: ResearchStageGroup[] = [];
  const milestones: ResearchMilestone[] = [];
  const coverageTask = message.context?.coverage?.task;
  let task = coverageTask && ['question', 'summary', 'comparison', 'synthesis'].includes(coverageTask) ? coverageTask as ResearchTask : undefined;
  let action: ResearchAction = 'record';
  let stage: ResearchStage = 'preparing';
  let stageStartedElapsed = 0;
  for (const [index, record] of records.entries()) {
    const recognizedAction = actionFor(record.message);
    action = recognizedAction ?? action;
    const nextStage: ResearchStage = recognizedAction ? stageForAction(action) : stage;
    if (!index || nextStage !== stage) stageStartedElapsed = record.elapsed;
    stage = nextStage;
    task = taskFor(record.message) ?? task;
    const step = { ...record, id: `${index}:${record.elapsed}`, stage, action, recognized: recognizedAction !== undefined, displayMessage: safeResearchDisplayText(record.message, cardIds) };
    steps.push(step);
    let group = groups.at(-1);
    if (!group || group.action !== action) {
      if (group) group.endedElapsed = Math.max(group.startedElapsed, record.elapsed);
      group = { id: `${action}:${index}`, stage, action, startedElapsed: record.elapsed, active: false, steps: [] };
      groups.push(group);
    }
    group.steps.push(step);
    const milestone = milestoneFor(step);
    if (milestone) {
      // A progressing count replaces its previous adjacent count, while stage
      // revisits and distinct source titles retain their own recorded updates.
      const previous = milestones.at(-1);
      if (previous && milestoneKey(previous) === milestoneKey(milestone) && previous.stage === milestone.stage && group.steps.some(item => item.id === previous.id)) milestones[milestones.length - 1] = milestone;
      else milestones.push(milestone);
    }
  }
  const lastGroup = groups.at(-1);
  if (lastGroup) {
    lastGroup.active = active;
    if (!active) lastGroup.endedElapsed = Math.max(lastGroup.startedElapsed, message.elapsed ?? steps.at(-1)?.elapsed ?? lastGroup.startedElapsed);
  }
  const verified = message.context?.coverage?.verified === true || milestones.some(milestone => milestone.kind === 'verified' || milestone.kind === 'presenting');
  return { active, currentStage: stage, currentStageStartedElapsed: stageStartedElapsed, task, currentAction: action, currentActionStartedElapsed: lastGroup?.startedElapsed ?? 0, groups, steps, milestones, latestMilestone: milestones.at(-1), verified };
}
