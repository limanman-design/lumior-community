import type { Card } from './canvas-model';

export type AiNoteReadDependencies = { readNote?: (card: Card, options: { signal: AbortSignal }) => Promise<Card> };

/** Read-only materialization for AI requests. Never persist these expanded cards. */
export async function prepareAiNotes(cards: Card[], signal: AbortSignal, onProgress?: (message: string, cardId?: string) => void, dependencies: AiNoteReadDependencies = {}): Promise<Card[]> {
  const result: Card[] = [];
  const hasStoredNotes = cards.some(card => card.storedDocument);
  let totalBytes = 0;
  for (const card of cards) {
    signal.throwIfAborted();
    let complete = card;
    if (card.storedDocument) {
      onProgress?.(`正在读取笔记：${card.title}`, card.id);
      const readNote = dependencies.readNote || (await import('./stored-document.ts')).readStoredDocument;
      complete = await readNote(card, { signal });
      signal.throwIfAborted();
    }
    totalBytes += new TextEncoder().encode(JSON.stringify({ body: complete.body, blocks: complete.blocks })).byteLength;
    if (hasStoredNotes && totalBytes > 12 * 1024 * 1024) throw new Error('本次选中的笔记超过完整读取容量，请减少引用范围后重试；未截断正文。');
    result.push(complete);
  }
  return result;
}
