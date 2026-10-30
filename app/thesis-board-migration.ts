import type { Board, Card } from './canvas-model';
import type { ThesisProject } from '../lib/thesis/model';
import type { AiBoardHistory, AiChat, AiMessage } from './ai-chat-store';
import { createThesisArtifact, enableBoardThesis, setThesisSource, thesisArtifactLabels, thesisInputSignature, thesisSourcePath, type ThesisSourceRole } from './thesis-board';
import { storeUploadedFile } from './local-repository';

/** Copy the old project into a new board; never mutate or delete the original project. */
export async function migrateThesisProject(project: ThesisProject): Promise<{ board: Board; history: AiBoardHistory }> {
  let board = enableBoardThesis({ id: crypto.randomUUID(), title: project.title, cards: [], edges: [] });
  const renames: [string, string][] = [];
  for (const [path, file] of Object.entries(project.files)) {
    if (thesisArtifactLabels[path]) {
      board = createThesisArtifact(board, path, file.text);
      if (path === 'thesis/topic.md') board.thesis!.topicVersion = Number(/^#\s+选题卡\s+v(\d+)/m.exec(file.text)?.[1]) || 1;
    } else if (/^thesis\/(refs|template|rubric)\//.test(path)) {
      const role = path.split('/')[1] as ThesisSourceRole, name = path.split('/').at(-1)!, id = crypto.randomUUID();
      const card: Card = { id, title: name.replace(/\.[^.]+$/, ''), body: file.text, kind: 'note', x: 80, y: 80, width: 360, height: 360 };
      if (file.blob && /\.pdf$/i.test(name)) {
        const url = await storeUploadedFile(file.blob, name), { pdfCover } = await import('./pdf-runtime');
        const cover = await pdfCover(url);
        card.kind = 'pdf'; card.pdf = { url, name, size: file.blob.size, pages: cover.pages, thumbnail: cover.thumbnail }; card.body = name; card.height = cover.cardHeight;
      } else if (file.blob) {
        const url = await storeUploadedFile(file.blob, name);
        card.blocks = [...file.text.split('\n\n').map(text => ({ type: 'paragraph' as const, content: text })), { type: 'file', props: { url, name } }];
      }
      board.cards.push(card); board = setThesisSource(board, id, role);
      renames.push([path, thesisSourcePath(id, role, card)]);
    } else board.thesis!.files[path] = { ...file, blob: undefined };
  }
  const rewrite = (text: string) => renames.reduce((value, [old, next]) => value.split(old).join(next), text);
  board.cards = board.cards.map((card, index) => ({ ...card, body: rewrite(card.body), x: 80 + index % 3 * 504, y: 80 + Math.floor(index / 3) * 440 }));
  for (const file of Object.values(board.thesis!.files)) file.text = rewrite(file.text);
  board.thesis!.literatureSequence = project.literatureSequence;
  board.thesis!.importedProjectId = project.id;
  const chats: AiChat[] = project.sessions.map(session => {
    const id = crypto.randomUUID(), migrated = JSON.parse(rewrite(JSON.stringify(session))) as typeof session;
    migrated.id = id; board.thesis!.sessions[id] = migrated;
    let parent: string | undefined;
    const messages: AiMessage[] = migrated.turns.map(turn => { if (turn.role === 'user') parent = turn.id; return { id: turn.id, role: turn.role, text: turn.text, createdAt: turn.createdAt, live: true, status: turn.error ? 'error' : 'complete', ...(turn.role === 'assistant' ? { replyTo: parent } : {}), model: 'DeepSeek' }; });
    return { id, boardId: board.id, title: migrated.turns.find(t => t.role === 'user')?.text.slice(0, 36) || '论文对话', createdAt: project.createdAt, updatedAt: project.updatedAt, messages, draft: '', refs: [], model: 'auto', live: true, skill: migrated.skill };
  });
  for (const chat of chats) board.thesis!.sessionContexts[chat.id] = thesisInputSignature(board);
  const activeIndex = project.sessions.findIndex(s => s.id === project.activeSessionId);
  return { board, history: { version: 1, boardId: board.id, chats, activeId: chats[activeIndex]?.id || chats[0]?.id || '' } };
}
