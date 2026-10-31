import type { Board, Card } from './canvas-model';
import { thesisDirectories, newThesisSession, type ThesisFile, type ThesisSession, type ThesisSkillId, type ThesisSnapshot } from '../lib/thesis/model.ts';
import { thesisSettingsTemplate } from '../lib/thesis/skill-content.generated.ts';
import type { ThesisRunResult } from '../lib/thesis/run';

export const thesisArtifactLabels: Record<string, string> = {
  'CLAUDE.md': '学生背景', 'thesis/topic.md': '选题卡', 'thesis/lit-matrix.md': '文献矩阵',
  'thesis/review-outline.md': '综述提纲', 'thesis/review-draft.md': '综述初稿',
  'thesis/proposal-outline.md': '开题提纲', 'thesis/proposal-draft.md': '开题报告',
};
export const thesisSourceLabels = { refs: '论文文献', template: '学院模板', rubric: '评审要求', material: '企业／背景资料' } as const;
export type ThesisSourceRole = keyof typeof thesisSourceLabels;
export type ThesisArtifact = { cardId: string; revision: number; modifiedAt: number; needsReview?: string; lastEditAt?: number; lastDecisionEditAt?: number };
export type ThesisRevision = { id: string; path: string; title: string; body: string; blocks?: Card['blocks']; revision: number; at: number };
export type ThesisProposal = { path: string; text: string; base: string; topicVersion: number; at: number };
export type BoardThesis = {
  version: 1; topicVersion: number; consentAt?: number; consentProviders?: import('../lib/thesis/providers').ThesisProvider[]; importedProjectId?: string;
  artifacts: Record<string, ThesisArtifact>;
  sources: Record<string, ThesisSourceRole>;
  files: Record<string, ThesisFile>;
  literatureSequence: number;
  sessions: Record<string, ThesisSession>;
  sessionContexts: Record<string, string>;
  proposals: Record<string, ThesisProposal>;
  history: ThesisRevision[];
};
/** Preserve headings, quotes and tables when the normal note editor emits plain body text. */
export function thesisCardMarkdown(card: Card): string {
  if (!card.blocks?.length) return card.body;
  const inline = (value: unknown): string => {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(inline).join('');
    if (value && typeof value === 'object') { const item = value as Record<string, unknown>; return typeof item.text === 'string' ? item.text : inline(item.content); }
    return '';
  };
  const blocks = (values: NonNullable<Card['blocks']>): string => values.map(block => {
    const content = block.content as unknown as { rows?: { cells: unknown[] }[] }, text = inline(block.content);
    let line = block.type === 'heading' ? `${'#'.repeat(Number((block.props as { level?: number })?.level) || 2)} ${text}`
      : block.type === 'bulletListItem' ? `- ${text}` : block.type === 'numberedListItem' ? `1. ${text}`
      : block.type === 'quote' ? text.split('\n').map(line => `> ${line}`).join('\n') : text;
    if (block.type === 'table' && content?.rows) {
      const rows = content.rows.map(row => `| ${row.cells.map(inline).join(' | ')} |`);
      if (rows.length) rows.splice(1, 0, `| ${content.rows[0].cells.map(() => '---').join(' | ')} |`);
      line = rows.join('\n');
    }
    return [line, block.children?.length ? blocks(block.children) : ''].filter(Boolean).join('\n');
  }).join('\n\n');
  return blocks(card.blocks);
}
const cardText = (card: Card) => `${card.title}\n${thesisCardMarkdown(card)}`;
const topicPath = 'thesis/topic.md';
function topicDecisions(text: string) {
  const sections = ['暂定题目', '一句话研究问题', '论文方向', '待文献验证的关键假设', '理论锚点'].map(name => new RegExp(`^## ${name}[^\\n]*\\n([^]*?)(?=^## |$(?![^]))`, 'm').exec(text)?.[1] || '');
  const content = sections.some(Boolean) ? sections.join('|') : text.replace(/^#\s+选题卡\s+v\d+[^\n]*\n?/m, '');
  return content.replace(/〔(?:支持|反驳|部分)[^〕]*〕/g, '').replace(/(?:已有\s*)?L\d+(?:\s+L\d+)*(?:\s*支撑)?/g, '').replace(/\s+/g, '').trim();
}
export function enableBoardThesis(board: Board): Board {
  if (board.thesis) return board;
  const now = Date.now();
  return { ...board, thesis: { version: 1, topicVersion: 0, artifacts: {}, sources: {}, files: {
    'thesis/settings.md': { path: 'thesis/settings.md', text: thesisSettingsTemplate.replace('{日期}', new Date(now).toLocaleDateString('sv-SE')), modifiedAt: now },
  }, literatureSequence: 0, sessions: {}, sessionContexts: {}, proposals: {}, history: [] } };
}
export function thesisArtifactForCard(board: Board, cardId: string) {
  return Object.entries(board.thesis?.artifacts || {}).find(([, item]) => item.cardId === cardId);
}
export function thesisCardLabel(board: Board, cardId: string) {
  const artifact = thesisArtifactForCard(board, cardId);
  if (artifact) return `${thesisArtifactLabels[artifact[0]] || '论文成果'} · v${artifact[0] === topicPath ? board.thesis!.topicVersion : artifact[1].revision}${artifact[1].needsReview ? ' · 需复核' : ''}`;
  const role = board.thesis?.sources[cardId];
  return role ? thesisSourceLabels[role] : undefined;
}
export function protectedThesisCards(board: Board, ids: string[]) {
  return board.cards.filter(card => ids.includes(card.id) && !!thesisArtifactForCard(board, card.id));
}
function markDependent(thesis: BoardThesis, reason: string, except = topicPath) {
  for (const [path, value] of Object.entries(thesis.artifacts)) {
    if (path !== except && path !== 'CLAUDE.md' && path !== topicPath) thesis.artifacts[path] = { ...value, needsReview: reason };
  }
}
function archive(thesis: BoardThesis, path: string, card: Card, revision: number, now: number) {
  thesis.history.push({ id: crypto.randomUUID(), path, title: card.title, body: card.body, blocks: card.blocks, revision, at: now });
}
/** Card bodies are authoritative. No second editable copy lives in the skill files. */
export function reconcileThesisEdits(before: Board, after: Board, now = Date.now()): Board {
  if (!before.thesis || !after.thesis) return after;
  // Explicit thesis transactions already manage their metadata (including undo).
  if (before.thesis !== after.thesis) return after;
  let next: BoardThesis | undefined;
  for (const [path, value] of Object.entries(before.thesis.artifacts)) {
    const old = before.cards.find(card => card.id === value.cardId), card = after.cards.find(card => card.id === value.cardId);
    if (!old || card && cardText(old) === cardText(card)) continue;
    next ||= { ...before.thesis, artifacts: { ...before.thesis.artifacts }, history: [...before.thesis.history] };
    if (!card) {
      archive(next, path, old, value.revision, now);
      markDependent(next, `${thesisArtifactLabels[path]}已移除，请恢复后复核。`, path);
      continue; // Keep the identity: missing outputs never silently recreate themselves.
    }
    const groupedEdit = !!value.lastEditAt && now - value.lastEditAt < 60_000;
    if (!groupedEdit) archive(next, path, old, value.revision, now);
    next.artifacts[path] = { ...value, revision: value.revision + (groupedEdit ? 0 : 1), modifiedAt: now, lastEditAt: now };
    if (path === topicPath) {
      if (topicDecisions(thesisCardMarkdown(old)) !== topicDecisions(thesisCardMarkdown(card))) {
        if (!value.lastDecisionEditAt || now - value.lastDecisionEditAt >= 60_000) next.topicVersion++;
        next.artifacts[path].lastDecisionEditAt = now;
        markDependent(next, `选题卡已修改为 v${next.topicVersion}，请核对研究问题、假设和引用是否仍适用。`);
      }
    } else if (path === 'CLAUDE.md' || path === 'thesis/lit-matrix.md' || path.endsWith('-outline.md')) {
      markDependent(next, `${thesisArtifactLabels[path]}已修改，请核对相关成果。`, path);
    }
  }
  for (const [id, role] of Object.entries(before.thesis.sources)) {
    const old = before.cards.find(card => card.id === id), card = after.cards.find(card => card.id === id);
    if (old && (!card || old.pdf?.url !== card.pdf?.url || old.pdf?.size !== card.pdf?.size || old.body !== card.body)) {
      next ||= { ...before.thesis, artifacts: { ...before.thesis.artifacts }, history: [...before.thesis.history] };
      markDependent(next, `${thesisSourceLabels[role]}已修改或移除，请复核来源。`);
    }
  }
  return next ? { ...after, thesis: next } : after;
}
export function setThesisSource(board: Board, id: string, role: ThesisSourceRole | ''): Board {
  if (!board.cards.some(card => card.id === id)) throw new Error('这张资料卡已移除。');
  const next = enableBoardThesis(board), thesis = structuredClone(next.thesis!);
  if (role) thesis.sources[id] = role; else delete thesis.sources[id];
  if (board.thesis?.sources[id] !== role) markDependent(thesis, '论文资料用途已调整，请复核来源范围。');
  return { ...next, thesis };
}
export function thesisSourcePath(id: string, role: ThesisSourceRole, card: Card) {
  // Stable identity, independent of renaming and ordering on the canvas.
  return `thesis/${role === 'material' ? 'materials' : role}/${encodeURIComponent(id)}${card.pdf ? '.pdf' : '.md'}`;
}
export function thesisInputSignature(board: Board) {
  if (!board.thesis) return '';
  return JSON.stringify({ boardId: board.id, topicVersion: board.thesis.topicVersion,
    artifacts: Object.entries(board.thesis.artifacts).map(([path, value]) => [path, value.cardId, board.cards.find(card => card.id === value.cardId) && cardText(board.cards.find(card => card.id === value.cardId)!)]),
    sources: Object.entries(board.thesis.sources).map(([id, role]) => { const card = board.cards.find(item => item.id === id); return [id, role, card?.title, card?.body, card?.pdf?.url, card?.pdf?.size]; }),
    files: board.thesis.files, proposals: board.thesis.proposals,
  });
}
function topicForRuntime(body: string, version: number) {
  return `# 选题卡 v${Math.max(1, version)}\n\n${body.replace(/^#\s+选题卡(?:\s+v\d+)?[^\n]*\n?/m, '').trim()}`;
}
function bodyFromRuntime(path: string, text: string) {
  return path === topicPath ? text.replace(/^#\s+选题卡\s+v\d+[^\n]*\n?/m, '').trim() : text;
}
export function boardThesisSnapshot(board: Board, workingSkill?: ThesisSkillId): ThesisSnapshot {
  if (!board.thesis) throw new Error('请先在当前画板启用论文助手。');
  const files = structuredClone(board.thesis.files);
  // Export live card content, not cached model output or previous versions.
  for (const [path, value] of Object.entries(board.thesis.artifacts)) {
    const card = board.cards.find(item => item.id === value.cardId);
    if (card) files[path] = { path, text: path === topicPath ? topicForRuntime(thesisCardMarkdown(card), board.thesis.topicVersion) : thesisCardMarkdown(card), modifiedAt: value.modifiedAt };
    else delete files[path];
  }
  // Continue the literature working copy without silently accepting it. Other
  // stages still consume the user's live, accepted artifact cards.
  const matrixPath = 'thesis/lit-matrix.md', proposal = board.thesis.proposals[matrixPath];
  if (workingSkill === 'mba-lit' && proposal) {
    const card = board.cards.find(item => item.id === board.thesis!.artifacts[matrixPath]?.cardId);
    if (!card || cardText(card) !== proposal.base || board.thesis.topicVersion !== proposal.topicVersion)
      throw new Error('文献矩阵建议生成后，原卡片或选题已修改。请先在“资料与历史”中处理这条旧建议，再继续读文献；你的修改已保留。');
    files[matrixPath] = { path: matrixPath, text: proposal.text, modifiedAt: proposal.at };
  }
  return { files, directories: [...thesisDirectories, 'thesis/materials'], literatureSequence: board.thesis.literatureSequence,
    boardContext: `本项目绑定当前画板。卡片内容是用户最新编辑结果，优先于旧对话。选题版本由系统维护为 v${board.thesis.topicVersion}。已有卡片的写入只会保存为待采纳建议，用户采纳后才生效；不要宣称已覆盖。待采纳：${Object.keys(board.thesis.proposals).join('、') || '无'}。需复核：${Object.entries(board.thesis.artifacts).filter(([, v]) => v.needsReview).map(([p, v]) => `${p}：${v.needsReview}`).join('；') || '无'}。来源文件只含用户明确分配用途的本画板资料；materials 是企业背景，不是论文。` };
}
export function boardThesisSession(board: Board, chatId: string, skill: ThesisSkillId): ThesisSession {
  const old = board.thesis?.sessions[chatId];
  if (!old) return newThesisSession(skill, chatId);
  if (old.skill !== skill) {
    const session = newThesisSession(skill, chatId);
    session.turns = structuredClone(old.turns);
    session.modelMessages = old.turns.slice(-12).map(turn => ({ role: turn.role, content: turn.text }));
    return session;
  }
  const next = structuredClone(old);
  if (board.thesis?.sessionContexts[chatId] !== thesisInputSignature(board)) {
    // A stale tool question cannot consume a reply about an edited research topic.
    delete next.pending;
    next.modelMessages = next.turns.slice(-12).map(turn => ({ role: turn.role, content: turn.text }));
    next.modelMessages.push({ role: 'user', content: '我已在画板修改了项目内容或资料用途。请重新读取最新卡片，检查之前的问题是否仍适用；不要把旧工具结果当成当前内容。' });
  }
  return next;
}
function newArtifact(board: Board, path: string, text: string, now: number) {
  const card: Card = { id: crypto.randomUUID(), title: thesisArtifactLabels[path] || path, body: bodyFromRuntime(path, text), kind: 'note', width: 440, height: 360,
    x: board.cards.length ? Math.max(...board.cards.map(item => item.x + item.width)) + 64 : 80, y: 80,
    createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), creationDateSource: 'actual' };
  board.cards.push(card);
  board.thesis!.artifacts[path] = { cardId: card.id, revision: 1, modifiedAt: now };
  if (path === topicPath) board.thesis!.topicVersion = 1;
}
export function createThesisArtifact(board: Board, path: string, text = '') {
  if (!thesisArtifactLabels[path]) throw new Error('不支持的论文成果。');
  const next = structuredClone(enableBoardThesis(board));
  if (next.thesis!.artifacts[path]) throw new Error('这项成果已经存在；若已移除，请在对话的“资料与历史”中恢复。');
  newArtifact(next, path, text, Date.now());
  return next;
}
export function applyThesisResult(board: Board, expected: string, result: ThesisRunResult, chatId: string): Board {
  if (thesisInputSignature(board) !== expected) throw new Error('等待期间论文内容或资料范围已改变，本轮结果未写入画板，用户修改已保留。请重新发送。');
  const next: Board = { ...board, cards: [...board.cards], thesis: structuredClone(board.thesis!) }, state = next.thesis!, now = Date.now();
  for (const path of result.changed) {
    const file = result.snapshot.files[path];
    if (!file) continue;
    if (thesisArtifactLabels[path]) {
      const binding = state.artifacts[path], card = next.cards.find(item => item.id === binding?.cardId);
      if (!binding) newArtifact(next, path, file.text, now);
      else if (card && thesisCardMarkdown(card) === bodyFromRuntime(path, file.text)) continue;
      else state.proposals[path] = { path, text: file.text, base: card ? cardText(card) : '', topicVersion: state.topicVersion, at: now };
    } else state.files[path] = { ...file, blob: undefined };
  }
  state.literatureSequence = result.snapshot.literatureSequence;
  if (state.proposals[topicPath]) markDependent(state, '本轮包含尚未采纳的选题修改，请确认最终选题后复核。');
  for (const path of Object.keys(state.proposals).filter(path => path.endsWith('-outline.md'))) {
    const draftPath = path.replace('-outline.md', '-draft.md');
    if (state.artifacts[draftPath]) state.artifacts[draftPath] = { ...state.artifacts[draftPath], needsReview: '提纲修改尚未采纳，请核对草稿与最终提纲是否一致。' };
  }
  state.sessions[chatId] = result.session;
  state.sessionContexts[chatId] = thesisInputSignature(next);
  return next;
}
export function resolveThesisProposal(board: Board, path: string, accept: boolean): Board {
  const next = structuredClone(board), state = next.thesis!, proposal = state.proposals[path];
  if (!proposal) throw new Error('这条建议已处理。');
  if (accept) {
    const artifact = state.artifacts[path], card = next.cards.find(item => item.id === artifact?.cardId);
    if (!card) throw new Error('原卡片已移除，请先恢复原卡片，再重新生成建议。');
    if (cardText(card) !== proposal.base || state.topicVersion !== proposal.topicVersion) throw new Error('这条建议生成后内容又有变化。请保留当前内容，并重新生成建议。');
    const decisionChanged = path === topicPath && topicDecisions(thesisCardMarkdown(card)) !== topicDecisions(bodyFromRuntime(path, proposal.text));
    archive(state, path, card, artifact.revision, Date.now());
    card.body = bodyFromRuntime(path, proposal.text); delete card.blocks;
    card.updatedAt = new Date().toISOString();
    state.artifacts[path] = { ...artifact, revision: artifact.revision + 1, modifiedAt: Date.now(), lastEditAt: undefined };
    if (decisionChanged) { state.topicVersion++; markDependent(state, `已采纳选题卡 v${state.topicVersion}，请复核相关成果。`); }
    else if (path === 'thesis/lit-matrix.md' || path.endsWith('-outline.md')) markDependent(state, `${thesisArtifactLabels[path]}已更新，请复核相关成果。`, path);
  }
  delete state.proposals[path];
  return next;
}
export function restoreThesisRevision(board: Board, id: string): Board {
  const next = structuredClone(board), state = next.thesis!, old = state.history.find(item => item.id === id);
  if (!old) throw new Error('这份历史版本不存在。');
  const artifact = state.artifacts[old.path], card = next.cards.find(item => item.id === artifact?.cardId);
  if (card) { archive(state, old.path, card, artifact.revision, Date.now()); card.title = old.title; card.body = old.body; card.blocks = old.blocks; card.updatedAt = new Date().toISOString(); }
  else { const cardId = artifact?.cardId || crypto.randomUUID(); next.cards.push({ id: cardId, kind: 'note', title: old.title, body: old.body, blocks: old.blocks, width: 440, height: 360, x: 80, y: 80 }); state.artifacts[old.path] = { cardId, revision: 0, modifiedAt: Date.now() }; }
  state.artifacts[old.path] = { ...state.artifacts[old.path], revision: (artifact?.revision || 0) + 1, modifiedAt: Date.now(), lastEditAt: undefined };
  if (old.path === topicPath) state.topicVersion++;
  markDependent(state, `${thesisArtifactLabels[old.path]}已恢复历史内容，请复核。`, old.path);
  return next;
}
export function remapThesisValue<T>(value: T, ids: ReadonlyMap<string, string>): T {
  if (typeof value === 'string') {
    let text: string = ids.get(value) || value;
    for (const [old, next] of ids) for (const role of ['refs', 'template', 'rubric', 'materials']) text = text.split(`thesis/${role}/${encodeURIComponent(old)}.`).join(`thesis/${role}/${encodeURIComponent(next)}.`);
    return text as T;
  }
  if (Array.isArray(value)) return value.map(item => remapThesisValue(item, ids)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [ids.get(key) || key, remapThesisValue(item, ids)])) as T;
  return value;
}
export function restoreBoardThesis(board: Board, ids: Map<string, string>) {
  if (!board.thesis) return;
  for (const a of Object.values(board.thesis.artifacts)) if (!ids.has(a.cardId)) ids.set(a.cardId, crypto.randomUUID());
  for (const id of [...Object.keys(board.thesis.sources), ...Object.keys(board.thesis.sessions)]) if (!ids.has(id)) ids.set(id, crypto.randomUUID());
  const state = remapThesisValue(board.thesis, ids);
  state.sessionContexts = {}; delete state.consentAt; delete state.consentProviders; delete state.importedProjectId;
  return state;
}
export function copyBoardThesis(board: Board, ids: Map<string, string>) {
  if (!board.thesis) return;
  const state = restoreBoardThesis(board, ids)!;
  state.sessions = {}; state.sessionContexts = {}; state.proposals = {}; delete state.consentAt; delete state.consentProviders; delete state.importedProjectId;
  return state;
}
export function validBoardThesis(value: unknown): value is BoardThesis {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const s = value as BoardThesis;
  const record = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v);
  const integer = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
  return s.version === 1 && integer(s.topicVersion) && integer(s.literatureSequence)
    && (s.consentAt === undefined || Number.isFinite(s.consentAt))
    && (s.consentProviders === undefined || Array.isArray(s.consentProviders) && s.consentProviders.every(p => p === 'deepseek' || p === 'kimi'))
    && record(s.artifacts) && Object.entries(s.artifacts).every(([path, a]) => !!thesisArtifactLabels[path] && a && typeof a.cardId === 'string' && integer(a.revision) && Number.isFinite(a.modifiedAt))
    && record(s.sources) && Object.values(s.sources).every(role => Object.hasOwn(thesisSourceLabels, role))
    && record(s.files) && Object.entries(s.files).every(([path, f]) => path.startsWith('thesis/') && !path.includes('..') && f?.path === path && typeof f.text === 'string' && Number.isFinite(f.modifiedAt))
    && record(s.sessions) && Object.values(s.sessions).every(session => session && typeof session.id === 'string' && Array.isArray(session.turns) && Array.isArray(session.modelMessages) && Array.isArray(session.litReadIds) && Array.isArray(session.litAddedIds))
    && record(s.sessionContexts) && Object.values(s.sessionContexts).every(v => typeof v === 'string')
    && record(s.proposals) && Object.entries(s.proposals).every(([path, p]) => !!thesisArtifactLabels[path] && p?.path === path && typeof p.text === 'string' && typeof p.base === 'string' && integer(p.topicVersion) && Number.isFinite(p.at))
    && Array.isArray(s.history) && s.history.every(h => h && typeof h.id === 'string' && !!thesisArtifactLabels[h.path] && typeof h.body === 'string' && typeof h.title === 'string' && integer(h.revision) && Number.isFinite(h.at));
}
