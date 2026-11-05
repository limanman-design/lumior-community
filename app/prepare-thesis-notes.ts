import type { Board } from './canvas-model';
import type { ThesisSkillId } from '../lib/thesis/model';
import { prepareAiNotes, type AiNoteReadDependencies } from './prepare-ai-notes.ts';
import { noteMarkdown } from './note-markdown.ts';
import { boardThesisSnapshot } from './thesis-board.ts';
import { thesisContextPath } from '../lib/thesis/card-roles.ts';

/** Only explicitly assigned sources and bound outputs enter an MBA request. */
export async function prepareThesisNotes(board: Board, skill: ThesisSkillId, signal: AbortSignal, progress?: (message: string, cardId?: string) => void, dependencies: AiNoteReadDependencies = {}, referenceIds: readonly string[] = [], chatId?: string) {
  if (!board.thesis) throw new Error('请先在当前画板启用论文助手。');
  const references = board.cards.filter(card => referenceIds.includes(card.id) && ['pdf', 'note', 'text'].includes(card.kind));
  if (referenceIds.some(id => !references.some(card => card.id === id))) throw new Error('有引用卡片已移除或类型不受当前 Skill 支持，请调整引用后再发送。');
  const ids = new Set([...Object.keys(board.thesis.sources), ...Object.values(board.thesis.artifacts).map(item => item.cardId), ...referenceIds]);
  const notes = await prepareAiNotes(board.cards.filter(card => ids.has(card.id) && !card.pdf), signal, progress, dependencies);
  const texts = new Map(notes.map(card => [card.id, noteMarkdown(card)]));
  const snapshot = boardThesisSnapshot(board, skill, texts);
  if (references.length) {
    snapshot.cardContext = { cards: references.map(card => ({ id: card.id, title: card.title, kind: card.kind, path: thesisContextPath(card.id, !!card.pdf), canBeOutput: !card.storedDocument && !card.sharedId })),
      existing: [...Object.entries(board.thesis.sources).map(([cardId, role]) => ({ cardId, role })), ...Object.entries(board.thesis.artifacts).map(([role, item]) => ({ cardId: item.cardId, role }))], versions: { 'thesis/topic.md': board.thesis.topicVersion } };
    snapshot.directories.push('thesis/context', 'thesis/context/cards');
    for (const card of references.filter(card => !card.pdf)) {
      const path = thesisContextPath(card.id, false);
      snapshot.files[path] = { path, text: texts.get(card.id) || '', modifiedAt: Date.parse(card.updatedAt || '') || 0, uploaded: true, mediaType: 'text/markdown' };
    }
  }
  // Reuse visible, saved exchanges rather than inventing a separate student card
  // or a model-generated memory. No truncation: normal capacity guards still apply.
  const conversations = Object.entries(board.thesis.sessions).filter(([id]) => chatId && id !== chatId).map(([id, session]) => ({
    id, skill: session.skill, turns: session.turns.filter(turn => !turn.error).map(turn => ({ role: turn.role, text: turn.text, question: turn.question })),
  })).filter(session => session.turns.length);
  if (conversations.length) {
    const path = 'thesis/context/conversations.md';
    snapshot.files[path] = { path, text: JSON.stringify(conversations), modifiedAt: 0 };
    if (!snapshot.directories.includes('thesis/context')) snapshot.directories.push('thesis/context');
    snapshot.boardContext += ' 其他阶段的已保存对话在 thesis/context/conversations.md，只读。需要学生背景时可读取；助手建议不等于学生确认，最新成果和用户纠正优先。';
  }
  return { snapshot, texts };
}
