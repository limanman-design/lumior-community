import type { Board } from './canvas-model';
import { newAiChat, type AiChat, type AiMessage } from './ai-chat-store.ts';
import { thesisSkills, type ThesisSkillId, type ThesisSession, type ThesisQuestion } from '../lib/thesis/model.ts';

/** Questions belong to their assistant turn, including legacy saved conversations. */
export function thesisMessageQuestions(messages: readonly AiMessage[], session?: ThesisSession) {
  const result = new Map<string, { question: ThesisQuestion; answer?: string }>();
  const turns = session?.turns.filter(turn => turn.role === 'assistant') || [];
  let cursor = 0;
  messages.forEach((message, index) => {
    if (message.role !== 'assistant' || !message.text) return;
    const match = turns.findIndex((turn, i) => i >= cursor && !!turn.text &&
      (message.text === turn.text || message.text.startsWith(turn.text + '\n\n')));
    if (match >= 0) cursor = match + 1;
    const question = message.thesisQuestion || (match >= 0 ? turns[match].question : undefined);
    if (question) result.set(message.id, { question, answer: messages.slice(index + 1).find(item => item.role === 'user')?.text });
  });
  return result;
}

/** Each stage resumes its latest conversation on this board; commands are navigation. */
export function thesisChat(board: Board, chats: readonly AiChat[], skill: ThesisSkillId, now = Date.now()): AiChat {
  const sessions = board.thesis?.sessions || {};
  const candidates = chats.filter(chat => chat.boardId === board.id && chat.live !== false
    && (sessions[chat.id]?.skill || chat.skill) === skill);
  // Empty chats created by closing the panel must not hide an existing workflow.
  const existing = [...candidates].sort((a, b) =>
    Number(!!sessions[b.id]) - Number(!!sessions[a.id])
    || Number(b.messages.length > 0) - Number(a.messages.length > 0)
    || b.updatedAt - a.updatedAt)[0];
  if (existing?.messages.length) return { ...existing, skill };
  const session = Object.values(sessions).filter(value => value.skill === skill)
    .sort((a, b) => (b.turns.at(-1)?.createdAt || 0) - (a.turns.at(-1)?.createdAt || 0))[0];
  const next = existing ? { ...existing, skill } : newAiChat(board.id, [], now, skill);
  next.title = `论文 · ${thesisSkills.find(item => item.id === skill)!.name}`;
  if (session) {
    next.id = session.id;
    next.messages = session.turns.map(turn => ({ id: turn.id, role: turn.role, text: turn.text, createdAt: turn.createdAt,
      live: true, status: turn.error ? 'error' : 'complete', error: turn.error, thesisQuestion: turn.question, presentationMode: 'conversation' }));
  }
  if (!next.messages.length) {
    const question = skill === 'mba-topic' ? '可以先告诉我你的行业、岗位和已有研究想法，或直接发送“开始”，由论文助手按步骤引导。'
      : skill === 'mba-lit' ? '你想先读哪篇文献？可以先告诉我题名和想弄清的问题；PDF 拖入画板后，指定为“论文文献”即可参与。'
      : skill === 'mba-review' ? '你目前确定的研究主题是什么，文献整理到哪一步了？已有综述也可以直接贴在下方。'
      : '你的研究题目和目前的准备进度是什么？有学院要求，也可以先用自己的话告诉我。';
    next.messages = [{ id: `thesis-intro:${next.id}`, role: 'assistant', live: true, createdAt: now,
      status: 'complete', presentationMode: 'conversation', model: 'Lumior',
      text: `这张画板对应一篇论文。直接在下方回答就可以，不用先新建卡片。\n\n${question}\n\n我会逐步引导，形成的成果会保存为可编辑卡片；修改已有成果时，会先给你建议，采纳后才替换。随时可以切回研究助手；在这张画板发送对应的 mba 命令即可继续。另一篇论文请新建画板。` }];
  }
  return next;
}
