import type { Card } from './canvas-model';
import { serializeWorkspace } from './workspace-assets.ts';
import { validStoredDocument } from './stored-document-schema.ts';

/** Content only: no recursive history, board IDs or canvas geometry. */
export type NoteSnapshot = Pick<Card, 'title' | 'body' | 'blocks' | 'storedDocument'>;
export type NoteAiChange = { id: string; text: string; at: number; base: NoteSnapshot; accepted?: NoteSnapshot };
export function noteSnapshot(card: NoteSnapshot): NoteSnapshot {
  return structuredClone(serializeWorkspace({ title: card.title, body: card.body,
    ...(card.blocks ? { blocks: card.blocks } : {}), ...(card.storedDocument ? { storedDocument: card.storedDocument } : {}) }));
}
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value;
export const sameNote = (a: NoteSnapshot, b: NoteSnapshot) => JSON.stringify(canonical(noteSnapshot(a))) === JSON.stringify(canonical(noteSnapshot(b)));
export function validNoteAiChange(value: unknown): value is NoteAiChange {
  if (!value || typeof value !== 'object') return false;
  const change = value as NoteAiChange;
  const snapshot = (item: NoteSnapshot) => item && typeof item.title === 'string' && typeof item.body === 'string'
    && (item.blocks === undefined || Array.isArray(item.blocks) && item.blocks.every(block => block && typeof block.type === 'string'))
    && (item.storedDocument === undefined || validStoredDocument(item.storedDocument) && item.body === '' && item.blocks === undefined);
  return typeof change.id === 'string' && !!change.id && change.id.length <= 200 && typeof change.text === 'string' && !!change.text.trim() && change.text.length <= 120_000
    && Number.isSafeInteger(change.at) && change.at >= 0 && !!snapshot(change.base) && (change.accepted === undefined || !!snapshot(change.accepted));
}
export function proposeNoteChange(card: Card, base: Card | undefined, id: string, text: string, at = Date.now()): Card {
  if (card.kind !== 'note' || base?.kind !== 'note') throw new Error('只能为本次范围中的笔记卡提出修改建议。');
  if (card.aiNoteChange?.id === id) return card;
  if (card.aiNoteChange && !card.aiNoteChange.accepted) throw new Error(`《${card.title}》已有待处理建议，请先接受或保留原文。`);
  if (!sameNote(card, base)) throw new Error(`《${card.title}》在生成期间有修改，请按最新内容重新生成建议。`);
  return { ...card, aiNoteChange: { id, text, at, base: noteSnapshot(base) } };
}
export function assertNoteChange(card: Card | undefined, expected: NoteAiChange, checkContent = true): asserts card is Card & { aiNoteChange: NoteAiChange } {
  if (!card || card.kind !== 'note') throw new Error('原笔记已移除，请返回原画板检查。');
  if (JSON.stringify(card.aiNoteChange) !== JSON.stringify(expected)) throw new Error('这条修改建议已处理或更新，请重新查看。');
  if (checkContent && !sameNote(card, expected.accepted || expected.base)) throw new Error('原文已有后续修改，已保留你的内容。请保留原文后重新生成建议。');
}
export function noteChangePatch(card: Card, change: NoteAiChange, action: 'dismiss' | 'accept' | 'undo', replacement?: Partial<Card>): Partial<Card> {
  assertNoteChange(card, change, action !== 'dismiss');
  if (action === 'dismiss') return { aiNoteChange: undefined };
  if (action === 'undo') {
    if (!change.accepted) throw new Error('这条建议尚未接受。');
    return { title: change.base.title, body: change.base.body, blocks: change.base.blocks, storedDocument: change.base.storedDocument, aiNoteChange: undefined };
  }
  if (change.accepted || !replacement) throw new Error('这条建议已处理。');
  return { ...replacement, aiNoteChange: { ...change, accepted: noteSnapshot({ ...card, ...replacement }) } };
}
