import type { Board } from './canvas-model';
import type { AiChat } from './ai-chat-store';
import { thesisArtifactLabels, thesisCardMarkdown } from './thesis-board.ts';
import { thesisSkills, type ThesisSkillId } from '../lib/thesis/model.ts';

export type ThesisStageStatus = { kind: 'idle' | 'progress' | 'attention' | 'error' | 'result'; label: string; reason: string };
const stagePaths: Record<ThesisSkillId, string[]> = {
  'mba-topic': ['thesis/topic.md'],
  'mba-lit': ['thesis/lit-matrix.md'],
  'mba-review': ['thesis/review-outline.md', 'thesis/review-draft.md'],
  'mba-proposal': ['thesis/proposal-outline.md', 'thesis/proposal-draft.md'],
};

/** Derive navigation from this board's live cards and latest attempts, never from selection or AI prose. */
export function thesisStageStatus(board: Board, chats: readonly AiChat[], skill: ThesisSkillId): ThesisStageStatus {
  const name = thesisSkills.find(item => item.id === skill)!.name;
  const idle: ThesisStageStatus = { kind: 'idle', label: '未开始', reason: `尚未开始${name}，点击可在当前画板继续。` };
  const thesis = board.thesis;
  if (!thesis) return idle;
  const paths = stagePaths[skill];
  const cardAt = (path: string) => board.cards.find(card => card.id === thesis.artifacts[path]?.cardId);
  const hasContent = (path: string) => {
    const card = cardAt(path);
    return !!card && !!thesisCardMarkdown(card).replace(/^\s*#{1,6}\s+.*$/gm, '').trim();
  };
  const sessions = Object.values(thesis.sessions).filter(session => session.skill === skill);
  const stageChats = chats.filter(chat => chat.boardId === board.id && chat.live !== false && (thesis.sessions[chat.id]?.skill || chat.skill) === skill);
  const attempts = [
    ...sessions.flatMap(session => session.turns.filter(turn => turn.role === 'assistant').map(turn => ({ at: turn.createdAt, error: turn.error, status: turn.error ? 'error' : 'complete', progress: '' }))),
    ...stageChats.flatMap(chat => chat.messages.filter(message => message.role === 'assistant' && !message.id.startsWith('thesis-intro:')).map(message => ({ at: message.createdAt, error: message.error, status: message.status, progress: message.progress }))),
  ].sort((a, b) => a.at - b.at);
  const latest = attempts.at(-1);
  if (latest && ['preparing', 'pending', 'streaming'].includes(latest.status || '')) {
    return { kind: 'progress', label: '进行中', reason: latest.progress || `正在处理${name}，完成后会保留在这张画板。` };
  }
  if (latest?.status === 'error') {
    return { kind: 'error', label: '执行失败', reason: `上次${name}未完成：${latest.error || '处理失败，请在对话中重试。'} 已有成果保留。` };
  }
  const missing = paths.filter(path => thesis.artifacts[path] && !cardAt(path));
  if (missing.length) return { kind: 'attention', label: '待处理', reason: `${missing.map(path => thesisArtifactLabels[path]).join('、')}已移除，可在“论文项目”的修改历史中恢复。` };
  const review = paths.filter(path => thesis.artifacts[path]?.needsReview);
  if (review.length) return { kind: 'attention', label: '需复核', reason: review.map(path => `${thesisArtifactLabels[path]}：${thesis.artifacts[path].needsReview}`).join('；') };
  const proposals = paths.filter(path => thesis.proposals[path]);
  if (proposals.length) return { kind: 'attention', label: '待采纳', reason: `${proposals.map(path => thesisArtifactLabels[path]).join('、')}有修改建议等待决定，请在“论文项目”中对照；原内容保留。` };
  const results = paths.filter(hasContent);
  if (results.length) return { kind: 'result', label: '已有成果', reason: `已有${results.map(path => thesisArtifactLabels[path]).join('、')}，可以继续编辑或讨论；不代表整个阶段已结束。` };
  // Merely opening an introduction is navigation, not progress.
  const started = sessions.some(session => session.turns.length > 0 || session.pending)
    || stageChats.some(chat => chat.messages.some(message => message.role === 'user'))
    || paths.some(path => thesis.artifacts[path]);
  if (!started) return idle;
  if (skill !== 'mba-topic' && !hasContent('thesis/topic.md')) {
    return { kind: 'attention', label: '待补资料', reason: '还没有可用的选题卡，可先回到定题明确研究问题，或在当前对话中补充已有选题。' };
  }
  if (skill === 'mba-lit' && !Object.entries(thesis.sources).some(([id, role]) => role === 'refs' && board.cards.some(card => card.id === id))) {
    return { kind: 'attention', label: '待补资料', reason: '还没有指定论文文献。可在“论文项目”中设置资料用途，或在对话中粘贴文献内容。' };
  }
  if (skill === 'mba-review' && !hasContent('thesis/lit-matrix.md')) {
    return { kind: 'attention', label: '待补资料', reason: '尚无文献矩阵，可先读文献整理证据，或在对话中补充已有文献整理。' };
  }
  const pending = [...sessions].sort((a, b) => (b.turns.at(-1)?.createdAt || 0) - (a.turns.at(-1)?.createdAt || 0))[0]?.pending;
  return { kind: 'progress', label: '进行中', reason: pending ? `等待你补充：${pending.question}` : `${name}已开始，尚未形成成果卡片，点击继续之前的对话。` };
}
