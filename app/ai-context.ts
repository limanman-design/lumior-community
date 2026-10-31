import type { Card } from './canvas-model';
import { noteMarkdown } from './note-markdown.ts';
import { documentText } from './card-document.ts';
import { pageChunks, type ReadingState } from './document-reading.ts';
import { videoTimestamp } from './video-transcript.ts';

export type AiSource = { id: string; title: string; kind: Card['kind']; text: string; truncated: boolean; location?: string; page?: number; time?: number; end?: number; fileKey?: string };
export type ResearchCoverage = { task: string; availableCards: number; targetCards: number; readCards: number; readPassages: number; totalPassages: number; complete: boolean; verified?: boolean };
export type AiContext = { scope: 'board' | 'selected'; sources: AiSource[]; eligible: number; characters: number; cardCount?: number; cardIds?: string[]; readings?: { id: string; title: string; status: ReadingState['status']; message: string; incomplete?: boolean }[]; coverage?: ResearchCoverage };

export function scopedCards(cards: Card[], refs: string[]) {
  cards = cards.filter(card => card.kind !== 'database');
  return refs.length ? [...new Set(refs)].map(id => cards.find(card => card.id === id)).filter((card): card is Card => !!card) : cards;
}
export function aiResearchRefs(context: AiContext | undefined, fallback: string[]) {
  // Evidence snapshots contain only passages read. Regeneration must revisit
  // the original scope, including material the previous answer never opened.
  return context?.cardIds ?? (context?.scope === 'selected' ? [...new Set(context.sources.map(source => source.id))] : fallback);
}
function cardSource(card: Card): AiSource {
  const body = card.kind === 'note' ? noteMarkdown(card) : card.blocks?.length ? documentText(card.blocks) : card.body;
  const text = [...new Set([card.title, body, card.pdfExcerpt?.mark.text || ''].filter(Boolean))].join('\n');
  const page = card.pdfExcerpt?.mark.fragments?.[0]?.page;
  return { id: card.id, title: card.title, kind: card.kind, text, truncated: false,
    ...(card.pdfExcerpt ? { page, location: page ? `PDF 摘录 · 第 ${page} 页` : 'PDF 摘录' } : { location: '卡片文字' }) };
}
function reports(cards: Card[], readings?: Map<string, ReadingState>) {
  return readings ? cards.filter(card => card.kind === 'pdf' || card.kind === 'video').map(card => {
    const state = readings.get(card.id), document = state?.document;
    const message = state?.status === 'ready' && document ? `${card.kind === 'pdf' ? `${document.total} 页` : `${document.total} 条字幕`}已提取${document.emptyPages.length ? `；${document.emptyPages.length} 页没有可提取文字` : ''}` : state?.status === 'empty' ? (card.kind === 'pdf' ? '没有可提取文字，扫描件识别尚未接入' : '没有已有字幕，自动转写尚未接入') : state?.message || '首次提问时在本机读取';
    return { id: card.id, title: card.title, status: state?.status || 'idle' as const, message, incomplete: state?.status !== 'ready' || !!document?.emptyPages.length };
  }) : undefined;
}

// A cheap preview; complete document passages are built once at send time.
export function aiContext(cards: Card[], refs: string[], readings?: Map<string, ReadingState>): AiContext {
  const selected = scopedCards(cards, refs), sources = selected.map(cardSource);
  return { scope: refs.length ? 'selected' : 'board', eligible: selected.length, cardCount: selected.length, cardIds: selected.map(card => card.id), sources,
    characters: sources.reduce((sum, source) => sum + source.text.length, 0), ...(readings ? { readings: reports(selected, readings) } : {}) };
}

export function aiCorpus(cards: Card[], refs: string[], readings: Map<string, ReadingState>): AiContext {
  const selected = scopedCards(cards, refs), sources: AiSource[] = [];
  for (const card of selected) {
    const base = cardSource(card);
    sources.push(...pageChunks(base.text, 1).map(chunk => ({ ...base, text: chunk.text })));
    const document = readings.get(card.id)?.document;
    if (!document?.chunks.length) continue;
    sources.push(...document.chunks.map(chunk => ({ ...base, ...chunk, fileKey: document.key, truncated: false,
      location: chunk.page ? `PDF 第 ${chunk.page} 页` : `视频字幕 ${videoTimestamp(chunk.time!)}–${videoTimestamp(chunk.end!)}` })));
  }
  return { scope: refs.length ? 'selected' : 'board', eligible: selected.length, cardCount: selected.length, cardIds: selected.map(card => card.id), sources,
    characters: sources.reduce((sum, source) => sum + source.text.length, 0), readings: reports(selected, readings) };
}
