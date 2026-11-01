import type { Card } from './canvas-model';
import { aiCorpus, scopedCards } from './ai-context.ts';
import { prepareAiNotes, type AiNoteReadDependencies } from './prepare-ai-notes.ts';
import type { ReadingState } from './document-reading';

export async function prepareAiContext(cards: Card[], refs: string[], _question: string, signal: AbortSignal, onProgress?: (message: string) => void, dependencies: AiNoteReadDependencies = {}) {
  const selected = scopedCards(cards, refs);
  const hydrated = await prepareAiNotes(selected, signal, onProgress, dependencies);
  const readings = new Map<string, ReadingState>();
  for (const card of selected) {
    signal.throwIfAborted();
    if (card.kind !== 'pdf' && card.kind !== 'video') continue;
    const { readingState, waitForReading } = await import('./document-reading-store.ts');
    onProgress?.(`正在准备资料：${card.title}`);
    try { await waitForReading(card, signal); } catch (error) { if (signal.aborted) throw error; }
    readings.set(card.id, readingState(card));
  }
  return aiCorpus(hydrated, refs, readings);
}
