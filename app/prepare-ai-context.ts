import type { Card } from './canvas-model';
import { aiCorpus, scopedCards } from './ai-context.ts';
import type { ReadingState } from './document-reading';

export async function prepareAiContext(cards: Card[], refs: string[], _question: string, signal: AbortSignal, onProgress?: (message: string) => void, dependencies: { readNote?: (card: Card, options: { signal: AbortSignal }) => Promise<Card> } = {}) {
  const selected = scopedCards(cards, refs);
  const hydrated: Card[] = [];
  let totalBytes = 0;
  const readings = new Map<string, ReadingState>();
  for (const card of selected) {
    if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
    let complete = card;
    if (card.storedDocument) {
      onProgress?.(`正在读取笔记：${card.title}`);
      const readNote = dependencies.readNote || (await import('./stored-document')).readStoredDocument;
      complete = await readNote(card, { signal });
      signal.throwIfAborted();
    }
    totalBytes += new TextEncoder().encode(JSON.stringify({ body: complete.body, blocks: complete.blocks })).byteLength;
    if (selected.some(item => item.storedDocument) && totalBytes > 12 * 1024 * 1024) throw new Error('本次选中的笔记超过完整读取容量，请减少引用范围后重试；未截断正文。');
    hydrated.push(complete);
    if (card.kind !== 'pdf' && card.kind !== 'video') continue;
    const { readingState, waitForReading } = await import('./document-reading-store.ts');
    onProgress?.(`正在准备资料：${card.title}`);
    try { await waitForReading(card, signal); } catch (error) { if (signal.aborted) throw error; }
    readings.set(card.id, readingState(card));
  }
  return aiCorpus(hydrated, refs, readings);
}
