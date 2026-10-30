import { readAiCanvasView, type AiCanvasView } from './ai-canvas-presentation.ts';
import type { AiContext } from './ai-context';
import type { Card } from './canvas-model';
import type { AiReasoningEffort } from '../lib/ai-reasoning';
import { translate } from './i18n-core.ts';
import { aiCitationFormat, historicalCitationText, type AiCitationFormat } from '../lib/ai-citations.ts';
import { defaultAiSkillId, isValidAiSkillId } from '../lib/ai-skills.ts';
import { readThesisQuestion, type ThesisQuestion } from '../lib/thesis/model.ts';

export type AiReference = { id: string; title: string; kind: Card['kind']; excerpt?: boolean; fileKey?: string };
export type AiProcessStep = { message: string; elapsed: number };
export type AiBoardActionResult = { id: string; createdCards: number; createdConnections: number; createdSections?: number; movedCards?: number; updatedSections?: number };

/** A receipt describes completed work. It never contains actions to replay. */
export function readAiBoardActionResult(value: unknown): AiBoardActionResult {
  const invalid = () => new Error('Invalid history');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw invalid();
  const item = value as Record<string, unknown>;
  const keys = Reflect.ownKeys(item);
  if (keys.some(key => !['id', 'createdCards', 'createdConnections', 'createdSections', 'movedCards', 'updatedSections'].includes(String(key)))) throw invalid();
  if (typeof item.id !== 'string' || !item.id.trim() || item.id.length > 200) throw invalid();
  if (!Number.isInteger(item.createdCards) || Number(item.createdCards) < 0 || Number(item.createdCards) > 12) throw invalid();
  if (!Number.isInteger(item.createdConnections) || Number(item.createdConnections) < 0 || Number(item.createdConnections) > 24) throw invalid();
  const layout: Partial<AiBoardActionResult> = {};
  for (const [key, max] of [['createdSections', 12], ['movedCards', 300], ['updatedSections', 300]] as const) {
    if (Object.hasOwn(item, key)) {
      if (!Number.isInteger(item[key]) || Number(item[key]) < 0 || Number(item[key]) > max) throw invalid();
      layout[key] = Number(item[key]);
    }
  }
  return { id: item.id, createdCards: Number(item.createdCards), createdConnections: Number(item.createdConnections), ...layout };
}

export type AiMessage = {
  id: string; role: 'user' | 'assistant'; text: string; createdAt: number; live: boolean;
  replyTo?: string; status?: 'preparing' | 'pending' | 'streaming' | 'complete' | 'stopped' | 'interrupted' | 'error';
  context?: AiContext; model?: string; error?: string; reason?: string; elapsed?: number;
  feedback?: 'like' | 'dislike'; progress?: string; process?: AiProcessStep[]; references?: AiReference[];
  thesisQuestion?: ThesisQuestion;
  citationFormat?: AiCitationFormat;
  boardActionResult?: AiBoardActionResult;
  operationOnly?: boolean;
  presentationMode?: 'operation' | 'conversation';
};
export type AiChat = {
  id: string; boardId: string; title: string; createdAt: number; updatedAt: number;
  messages: AiMessage[]; draft: string; refs: string[]; model: string; thesisModel?: string; live: boolean;
  // Missing on legacy chats; unknown valid IDs remain portable but unavailable.
  skill?: string;
  canvasView?: AiCanvasView;
  // Legacy backup metadata, retained for portability and ignored by requests.
  reasoningEffort?: AiReasoningEffort;
};
export type AiBoardHistory = { version: 1; boardId: string; activeId: string; chats: AiChat[] };

export function aiQuestionReferences(message: AiMessage, messages: AiMessage[]): AiReference[] {
  if (message.references) return message.references;
  // Recover legacy references only from that answer's saved evidence. The
  // current draft and subsequently renamed cards cannot rewrite an old turn.
  const context = messages.find(item => item.replyTo === message.id && item.context?.scope === 'selected')?.context;
  if (!context) return [];
  return [...new Set(context.cardIds || context.sources.map(source => source.id))].flatMap(id => {
    const source = context.sources.find(item => item.id === id);
    return source ? [{ id, title: source.title, kind: source.kind, fileKey: source.fileKey }] : [];
  });
}

export function emptyAiHistory(boardId: string): AiBoardHistory {
  return { version: 1, boardId, activeId: '', chats: [] };
}
export function newAiChat(boardId: string, refs: string[] = [], now = Date.now(), skillId = defaultAiSkillId): AiChat {
  if (!isValidAiSkillId(skillId)) throw new Error('Invalid AI skill');
  return { id: crypto.randomUUID(), boardId, title: '新对话', createdAt: now, updatedAt: now, messages: [], draft: '', refs: [...refs], model: 'auto', live: true, skill: skillId };
}
export function restoredAiHistory(value: unknown, boardId: string): AiBoardHistory {
  if (value == null) return emptyAiHistory(boardId);
  const history = value as Partial<AiBoardHistory>;
  if (history.version !== 1 || history.boardId !== boardId || !Array.isArray(history.chats)) throw new Error('这张画板的 AI 历史无法读取，原记录已保留。');
  const chats = history.chats.map(chat => {
    if (!chat || typeof chat.id !== 'string' || chat.boardId !== boardId || typeof chat.title !== 'string' || !Array.isArray(chat.messages)) throw new Error('AI 对话记录无法读取，原记录已保留。');
    if (chat.skill !== undefined && !isValidAiSkillId(chat.skill)) throw new Error('AI 对话记录无法读取，原记录已保留。');
    const messages = chat.messages.map(message => {
      if (!message || typeof message.id !== 'string' || !['user', 'assistant'].includes(message.role) || typeof message.text !== 'string') throw new Error('AI 消息无法读取，原记录已保留。');
      if (message.citationFormat !== undefined && message.citationFormat !== aiCitationFormat) throw new Error('AI 消息无法读取，原记录已保留。');
      const active = ['preparing', 'pending', 'streaming'].includes(message.status || '');
      // A checked full answer may have finished on the server while its local
      // presentation was still running. Restoring it shows the saved full text
      // immediately; interrupted network research remains interrupted.
      const receivedComplete = active && message.context?.coverage?.verified === true && message.reason === 'stop';
      const process = Array.isArray(message.process) ? message.process.filter(step => step && typeof step.message === 'string' && Number.isFinite(step.elapsed) && step.elapsed >= 0) : undefined;
      const references = Array.isArray(message.references) ? message.references.filter(reference => reference && typeof reference.id === 'string' && typeof reference.title === 'string' && ['note', 'text', 'pdf', 'video', 'image'].includes(reference.kind)) : undefined;
      const boardActionResult = message.boardActionResult === undefined ? undefined : readAiBoardActionResult(message.boardActionResult);
      // A stored draft action payload must never become executable state when
      // an old conversation is reopened. Keep unrelated legacy metadata.
      const restoredMessage = { ...message } as AiMessage & Record<string, unknown>;
      for (const key of ['boardActions', 'board_actions', 'actions']) delete restoredMessage[key];
      if (boardActionResult === undefined) delete restoredMessage.boardActionResult;
      if (message.operationOnly !== true || !boardActionResult) delete restoredMessage.operationOnly;
      if (!['operation', 'conversation'].includes(message.presentationMode || '')) delete restoredMessage.presentationMode;
      return { ...restoredMessage, thesisQuestion: readThesisQuestion(message.thesisQuestion), process, references, ...(boardActionResult ? { boardActionResult } : {}),
        elapsed: active ? process?.at(-1)?.elapsed ?? message.elapsed : message.elapsed, status: receivedComplete ? 'complete' as const : active ? 'interrupted' as const : message.status };
    });
    return { ...chat, ...(chat.canvasView === undefined ? {} : { canvasView: readAiCanvasView(chat.canvasView) }), messages, draft: typeof chat.draft === 'string' ? chat.draft : '', refs: Array.isArray(chat.refs) ? chat.refs.filter(id => typeof id === 'string') : [], model: typeof chat.model === 'string' ? chat.model : 'auto', thesisModel: typeof chat.thesisModel === 'string' ? chat.thesisModel : undefined, live: chat.live !== false, reasoningEffort: ['low', 'high', 'max'].includes(chat.reasoningEffort || '') ? chat.reasoningEffort : undefined };
  });
  return { version: 1, boardId, chats, activeId: chats.some(chat => chat.id === history.activeId) ? history.activeId! : chats[0]?.id || '' };
}

// Regeneration uses the history BEFORE its question; repeated answers do not
// cause duplicate user turns. Only completed real responses enter model context.
export function aiConversationHistory(chat: AiChat, beforeQuestion?: string) {
  const questionIndex = beforeQuestion ? chat.messages.findIndex(message => message.id === beforeQuestion) : -1;
  const messages = beforeQuestion ? chat.messages.slice(0, Math.max(0, questionIndex)) : chat.messages;
  const turns: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const message of messages) {
    if (message.role !== 'user' || !message.live) continue;
    turns.push({ role: 'user', content: message.text });
    const answer = messages.filter(candidate => candidate.role === 'assistant' && candidate.live && candidate.replyTo === message.id && candidate.status === 'complete').at(-1);
    if (answer) turns.push({ role: 'assistant', content: historicalCitationText(answer.text, answer.citationFormat) });
  }
  return turns;
}

let database: Promise<IDBDatabase> | undefined;
function openAiDatabase() {
  if (database) return database;
  database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('lumior-ai-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('boards');
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); database = undefined; };
      resolve(request.result);
    };
    request.onerror = () => { database = undefined; reject(new Error('AI 历史暂时无法保存，请检查浏览器存储空间。')); };
    request.onblocked = () => { database = undefined; reject(new Error('请关闭其他 Lumior 窗口后重试。')); };
  });
  return database;
}
type Saved = { history: AiBoardHistory; revision: number };
export class AiHistoryRepository {
  private revision = 0;
  private queue: Promise<unknown> = Promise.resolve();
  async settle() { await this.queue; }
  async load(boardId: string) {
    await this.queue.catch(() => {});
    const db = await openAiDatabase();
    const record = await new Promise<Saved | undefined>((resolve, reject) => {
      const request = db.transaction('boards', 'readonly').objectStore('boards').get(boardId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const history = restoredAiHistory(record?.history, boardId);
    this.revision = record?.revision || 0;
    return history;
  }
  save(history: AiBoardHistory): Promise<void> {
    const operation = this.queue.catch(() => {}).then(async () => {
      const db = await openAiDatabase();
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('boards', 'readwrite'), store = transaction.objectStore('boards');
        let conflict = false;
        const request = store.get(history.boardId);
        request.onsuccess = () => {
          const previous = request.result as Saved | undefined;
          if ((previous?.revision || 0) !== this.revision) { conflict = true; transaction.abort(); return; }
          store.put({ history, revision: this.revision + 1 }, history.boardId);
        };
        transaction.oncomplete = () => { this.revision++; resolve(); };
        transaction.onerror = transaction.onabort = () => reject(new Error(conflict ? '另一个窗口已修改 AI 历史，请重新打开这张画板。当前对话仍可复制。' : 'AI 历史保存失败，请检查浏览器存储空间后重试。'));
      });
    });
    this.queue = operation;
    return operation;
  }
}

const repositories = new Map<string, AiHistoryRepository>();
export function aiHistoryRepository(boardId: string) {
  let repository = repositories.get(boardId);
  if (!repository) { repository = new AiHistoryRepository(); repositories.set(boardId, repository); }
  return repository;
}

// Mounted editors register their debounced writes so portable export captures
// the draft visible on screen as well as histories from boards that are closed.
const pendingWriters = new Set<() => Promise<void>>();
export function registerAiHistoryWriter(writer: () => Promise<void>) {
  pendingWriters.add(writer);
  return () => { pendingWriters.delete(writer); };
}
export async function settleAiHistoryWrites() {
  await Promise.all([...pendingWriters].map(writer => writer()));
  await Promise.all([...repositories.values()].map(repository => repository.settle()));
}
export async function exportAiHistories(): Promise<AiBoardHistory[]> {
  await settleAiHistoryWrites();
  const db = await openAiDatabase();
  const records = await new Promise<Saved[]>((resolve, reject) => {
    const request = db.transaction('boards', 'readonly').objectStore('boards').getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return records.map(record => {
    if (!record?.history || typeof record.history.boardId !== 'string') throw new Error(translate('AI history could not be read. The full backup was not created.', 'AI 历史无法读取，完整备份尚未生成。'));
    return restoredAiHistory(record.history, record.history.boardId);
  });
}

// Restores only add new board histories. add() aborts the entire transaction
// if an identity already exists; existing conversations cannot be overwritten.
export async function importAiHistories(histories: AiBoardHistory[]): Promise<void> {
  if (!histories.length) return;
  const normalized = histories.map(history => restoredAiHistory(history, history.boardId));
  if (new Set(normalized.map(history => history.boardId)).size !== normalized.length) throw new Error(translate('The backup contains duplicate AI whiteboard records.', '备份中的 AI 画板记录重复。'));
  const db = await openAiDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('boards', 'readwrite'), store = transaction.objectStore('boards');
    for (const history of normalized) store.add({ history, revision: 1 }, history.boardId);
    transaction.oncomplete = () => { normalized.forEach(history => repositories.delete(history.boardId)); resolve(); };
    transaction.onerror = transaction.onabort = () => reject(new Error(translate('AI conversation restore failed. Existing conversations were preserved.', 'AI 对话恢复失败，原有对话已保留。')));
  });
}

// Used only to roll back newly added histories if the workspace save fails.
export async function removeImportedAiHistories(boardIds: string[]): Promise<void> {
  if (!boardIds.length) return;
  const db = await openAiDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('boards', 'readwrite'), store = transaction.objectStore('boards');
    boardIds.forEach(id => store.delete(id));
    transaction.oncomplete = () => { boardIds.forEach(id => repositories.delete(id)); resolve(); };
    transaction.onerror = transaction.onabort = () => reject(transaction.error);
  });
}
