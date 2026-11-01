import type { Board } from './canvas-model';
import type { ThesisSkillId } from '../lib/thesis/model';
import { prepareAiNotes, type AiNoteReadDependencies } from './prepare-ai-notes.ts';
import { noteMarkdown } from './note-markdown.ts';
import { boardThesisSnapshot } from './thesis-board.ts';

/** Only explicitly assigned sources and bound outputs enter an MBA request. */
export async function prepareThesisNotes(board: Board, skill: ThesisSkillId, signal: AbortSignal, progress?: (message: string, cardId?: string) => void, dependencies: AiNoteReadDependencies = {}) {
  if (!board.thesis) throw new Error('请先在当前画板启用论文助手。');
  const ids = new Set([...Object.keys(board.thesis.sources), ...Object.values(board.thesis.artifacts).map(item => item.cardId)]);
  const notes = await prepareAiNotes(board.cards.filter(card => ids.has(card.id) && !card.pdf), signal, progress, dependencies);
  const texts = new Map(notes.map(card => [card.id, noteMarkdown(card)]));
  return { snapshot: boardThesisSnapshot(board, skill, texts), texts };
}
