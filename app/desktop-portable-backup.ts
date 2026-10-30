import {
  exportAiHistories,
  readAiBoardActionResult,
  restoredAiHistory,
  type AiBoardHistory,
  type AiChat,
  type AiMessage,
  type AiReference,
} from './ai-chat-store.ts';
import type { AiContext, AiSource } from './ai-context';
import { isValidAiSkillId } from '../lib/ai-skills.ts';
import {
  getLanguage,
  isLanguage,
  setLanguage,
  translate,
  type Language,
} from './i18n-core.ts';
import {
  getNoteFitLimits,
  isNoteFitLimits,
  setNoteFitLimits,
  type NoteFitLimits,
} from './note-size-preferences.ts';

export type PortablePreferences = {
  language?: Language;
  noteFitLimits?: NoteFitLimits;
};
export type DesktopPortableBackup = {
  version: 1;
  aiHistories: AiBoardHistory[];
  preferences: PortablePreferences;
};

const invalid = () =>
  new Error(
    translate(
      'Conversation or preference data in the backup is invalid.',
      '备份中的对话或偏好设置格式无效。',
    ),
  );
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw invalid();
  return value as Record<string, unknown>;
};
const string = (value: unknown): string => {
  if (typeof value !== 'string') throw invalid();
  return value;
};
const number = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    throw invalid();
  return value;
};
const boolean = (value: unknown): boolean => {
  if (typeof value !== 'boolean') throw invalid();
  return value;
};
const list = <T>(value: unknown, read: (item: unknown) => T): T[] => {
  if (!Array.isArray(value)) throw invalid();
  return value.map(read);
};
const choice = <T extends string>(value: unknown, allowed: readonly T[]): T => {
  if (!allowed.includes(value as T)) throw invalid();
  return value as T;
};
const optional = <T>(
  value: unknown,
  read: (item: unknown) => T,
): T | undefined => (value === undefined ? undefined : read(value));
const kinds = ['note', 'text', 'pdf', 'video', 'image'] as const;

function reference(value: unknown): AiReference {
  const item = object(value);
  return {
    id: string(item.id),
    title: string(item.title),
    kind: choice(item.kind, kinds),
    excerpt: optional(item.excerpt, boolean),
    fileKey: optional(item.fileKey, string),
  };
}
function source(value: unknown): AiSource {
  const item = object(value);
  return {
    id: string(item.id),
    title: string(item.title),
    kind: choice(item.kind, kinds),
    text: string(item.text),
    truncated: boolean(item.truncated),
    location: optional(item.location, string),
    page: optional(item.page, number),
    time: optional(item.time, number),
    end: optional(item.end, number),
    fileKey: optional(item.fileKey, string),
  };
}
function context(value: unknown): AiContext {
  const item = object(value);
  return {
    scope: choice(item.scope, ['board', 'selected']),
    sources: list(item.sources, source),
    eligible: number(item.eligible),
    characters: number(item.characters),
    cardCount: optional(item.cardCount, number),
    cardIds: optional(item.cardIds, (value) => list(value, string)),
    readings: optional(item.readings, (value) =>
      list(value, (value) => {
        const reading = object(value);
        return {
          id: string(reading.id),
          title: string(reading.title),
          status: choice(reading.status, [
            'idle',
            'loading',
            'reading',
            'ready',
            'empty',
            'error',
            'cancelled',
          ]),
          message: string(reading.message),
          incomplete: optional(reading.incomplete, boolean),
        };
      }),
    ),
    coverage: optional(item.coverage, (value) => {
      const coverage = object(value);
      return {
        task: string(coverage.task),
        availableCards: number(coverage.availableCards),
        targetCards: number(coverage.targetCards),
        readCards: number(coverage.readCards),
        readPassages: number(coverage.readPassages),
        totalPassages: number(coverage.totalPassages),
        complete: boolean(coverage.complete),
        verified: optional(coverage.verified, boolean),
      };
    }),
  };
}
function message(value: unknown): AiMessage {
  const item = object(value);
  return {
    id: string(item.id),
    role: choice(item.role, ['user', 'assistant']),
    text: string(item.text),
    createdAt: number(item.createdAt),
    live: boolean(item.live),
    replyTo: optional(item.replyTo, string),
    status: optional(item.status, (value) =>
      choice(value, [
        'preparing',
        'pending',
        'streaming',
        'complete',
        'stopped',
        'interrupted',
        'error',
      ]),
    ),
    context: optional(item.context, context),
    citationFormat: optional(item.citationFormat, (value) => choice(value, ['lumior-v1'])),
    boardActionResult: optional(item.boardActionResult, readAiBoardActionResult),
    model: optional(item.model, string),
    error: optional(item.error, string),
    reason: optional(item.reason, string),
    elapsed: optional(item.elapsed, number),
    feedback: optional(item.feedback, (value) =>
      choice(value, ['like', 'dislike']),
    ),
    progress: optional(item.progress, string),
    process: optional(item.process, (value) =>
      list(value, (value) => {
        const step = object(value);
        return { message: string(step.message), elapsed: number(step.elapsed) };
      }),
    ),
    references: optional(item.references, (value) => list(value, reference)),
  };
}
function history(value: unknown): AiBoardHistory {
  const item = object(value),
    boardId = string(item.boardId);
  if (item.version !== 1) throw invalid();
  const chats = list(item.chats, (value) => {
    const chat = object(value);
    if (chat.boardId !== boardId) throw invalid();
    const messages = list(chat.messages, message);
    if (new Set(messages.map((message) => message.id)).size !== messages.length)
      throw invalid();
    if (chat.skill !== undefined && !isValidAiSkillId(chat.skill)) throw invalid();
    return {
      id: string(chat.id),
      boardId,
      title: string(chat.title),
      createdAt: number(chat.createdAt),
      updatedAt: number(chat.updatedAt),
      messages,
      draft: string(chat.draft),
      refs: list(chat.refs, string),
      model: string(chat.model),
      live: boolean(chat.live),
      ...(chat.skill !== undefined ? { skill: chat.skill } : {}),
      reasoningEffort: optional(chat.reasoningEffort, (value) =>
        choice(value, ['low', 'high', 'max']),
      ),
    } satisfies AiChat;
  });
  if (new Set(chats.map((chat) => chat.id)).size !== chats.length)
    throw invalid();
  return restoredAiHistory(
    { version: 1, boardId, activeId: string(item.activeId), chats },
    boardId,
  );
}

/** The explicit field list excludes provider credentials and unrelated storage. */
export function readDesktopPortableBackup(
  value: unknown,
): DesktopPortableBackup {
  const item = object(value);
  if (item.version !== 1) throw invalid();
  const aiHistories = list(item.aiHistories, history),
    preferences = object(item.preferences);
  if (
    new Set(aiHistories.map((history) => history.boardId)).size !==
    aiHistories.length
  )
    throw invalid();
  if (preferences.language !== undefined && !isLanguage(preferences.language))
    throw invalid();
  if (
    preferences.noteFitLimits !== undefined &&
    !isNoteFitLimits(preferences.noteFitLimits)
  )
    throw invalid();
  return {
    version: 1,
    aiHistories,
    preferences: {
      ...(preferences.language !== undefined
        ? { language: preferences.language as Language }
        : {}),
      ...(preferences.noteFitLimits !== undefined
        ? {
            noteFitLimits: {
              minHeight: (preferences.noteFitLimits as NoteFitLimits).minHeight,
              maxHeight: (preferences.noteFitLimits as NoteFitLimits).maxHeight,
            },
          }
        : {}),
    },
  };
}

export async function captureDesktopPortableBackup(): Promise<DesktopPortableBackup> {
  return readDesktopPortableBackup({
    version: 1,
    aiHistories: await exportAiHistories(),
    preferences: { language: getLanguage(), noteFitLimits: getNoteFitLimits() },
  });
}

/** File keys contain URLs, while question/answer text must remain verbatim. */
export function fileKeyRemapper(replacements: ReadonlyMap<string, string>) {
  // Replace in one pass; replacement IDs must never be replaced again.
  const escaped = [...replacements.keys()]
    .sort((a, b) => b.length - a.length)
    .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = escaped.length
    ? new RegExp(escaped.join('|'), 'g')
    : undefined;
  return (key: string | undefined) => {
    if (!key || !pattern) return key;
    if (!key.startsWith('v1:pdf:') && !key.startsWith('v1:video:'))
      return replacements.get(key) || key;
    return key.replace(pattern, (value) => replacements.get(value)!);
  };
}
export function mapPortableFileKeys(
  portable: DesktopPortableBackup,
  replacements: ReadonlyMap<string, string>,
): DesktopPortableBackup {
  const fileKey = fileKeyRemapper(replacements);
  return {
    ...portable,
    aiHistories: portable.aiHistories.map((history) => ({
      ...history,
      chats: history.chats.map((chat) => ({
        ...chat,
        messages: chat.messages.map((message) => ({
          ...message,
          references: message.references?.map((reference) => ({
            ...reference,
            fileKey: fileKey(reference.fileKey),
          })),
          context: message.context
            ? {
                ...message.context,
                sources: message.context.sources.map((source) => ({
                  ...source,
                  fileKey: fileKey(source.fileKey),
                })),
              }
            : undefined,
        })),
      })),
    })),
  };
}

/** Merge restore clones conversations and evidence along with their boards. */
export function remapPortableHistories(
  portable: DesktopPortableBackup,
  workspaceIds: Map<string, string>,
  fileIds: ReadonlyMap<string, string>,
): AiBoardHistory[] {
  const withFiles = mapPortableFileKeys(portable, fileIds);
  return withFiles.aiHistories.map((history) => {
    const boardId = workspaceIds.get(history.boardId) || crypto.randomUUID();
    const chatIds = new Map(
      history.chats.map((chat) => [chat.id, workspaceIds.get(chat.id) || crypto.randomUUID()]),
    );
    return {
      ...history,
      boardId,
      activeId: chatIds.get(history.activeId) || '',
      chats: history.chats.map((chat) => {
        const messageIds = new Map(
          chat.messages.map((message) => [message.id, crypto.randomUUID()]),
        );
        const cardId = (id: string) => workspaceIds.get(id) || id;
        return {
          ...chat,
          id: chatIds.get(chat.id)!,
          boardId,
          refs: chat.refs.map(cardId),
          messages: chat.messages.map((message) => ({
            ...message,
            id: messageIds.get(message.id)!,
            replyTo: message.replyTo
              ? messageIds.get(message.replyTo) || message.replyTo
              : undefined,
            references: message.references?.map((reference) => ({
              ...reference,
              id: cardId(reference.id),
            })),
            context: message.context
              ? {
                  ...message.context,
                  cardIds: message.context.cardIds?.map(cardId),
                  sources: message.context.sources.map((source) => ({
                    ...source,
                    id: cardId(source.id),
                  })),
                  readings: message.context.readings?.map((reading) => ({
                    ...reading,
                    id: cardId(reading.id),
                  })),
                }
              : undefined,
          })),
        };
      }),
    };
  });
}

/** Called only after the user confirms a validated restore and its saves finish. */
export function applyPortablePreferences(preferences: PortablePreferences) {
  if (preferences.language !== undefined) setLanguage(preferences.language);
  if (preferences.noteFitLimits !== undefined)
    setNoteFitLimits(preferences.noteFitLimits);
}
