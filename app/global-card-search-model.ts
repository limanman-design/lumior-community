import type { Board, Card } from './canvas-model';
import { documentText } from './card-document.ts';

export const globalCardSearchLimit = 60;

export type GlobalCardSearchEntry = {
  key: string;
  boardId: string;
  boardTitle: string;
  card: Card;
  title: string;
  body: string;
  thumbnail?: string;
  searchableTitle: string;
  searchableText: string;
};

const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

// The caller supplies normal boards only. Never inspect deletedBoards, load a
// document, or resolve a media URL while building this local text index.
export function createGlobalCardSearchIndex(boards: readonly Board[]): GlobalCardSearchEntry[] {
  const entries: GlobalCardSearchEntry[] = [];
  const seen = new Set<string>();
  for (const board of boards) {
    for (const card of board.cards) {
      if (card.kind === 'database') continue;
      const key = `${board.id}:${card.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const title = card.title.trim() || card.pdf?.name || card.sourceName || '';
      const body = card.blocks?.length
        ? documentText(card.blocks)
        : [card.body, card.detail].filter(Boolean).join('\n\n');
      const searchableTitle = normalize(title);
      entries.push({ key, boardId: board.id, boardTitle: board.title, card, title, body,
        thumbnail: card.image || card.pdf?.thumbnail || card.video?.poster || undefined,
        searchableTitle, searchableText: `${searchableTitle}\n${normalize(body)}` });
    }
  }
  return entries;
}

export function searchGlobalCardIndex<Entry extends Pick<GlobalCardSearchEntry, 'searchableTitle' | 'searchableText'>>(index: readonly Entry[], query: string,
  limit = globalCardSearchLimit): { results: Entry[]; total: number; hasQuery: boolean } {
  const value = normalize(query);
  if (!value) return { results: [], total: 0, hasQuery: false };
  const terms = value.split(' ');
  const matches = index.filter(entry => terms.every(term => entry.searchableText.includes(term)));
  const score = (entry: Entry) => entry.searchableTitle === value ? 0
    : entry.searchableTitle.startsWith(value) ? 1
    : terms.every(term => entry.searchableTitle.includes(term)) ? 2 : 3;
  // Stable sorting retains board/card order among equally relevant results.
  matches.sort((left, right) => score(left) - score(right));
  const visibleLimit = Number.isFinite(limit) ? Math.max(0, Math.min(globalCardSearchLimit, Math.floor(limit))) : globalCardSearchLimit;
  return { results: matches.slice(0, visibleLimit), total: matches.length, hasQuery: true };
}

export function globalCardSearchSnippet(body: string, query: string): string {
  const text = body.replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const term = query.trim().split(/\s+/)[0]?.toLowerCase() || '';
  const match = term ? text.toLowerCase().indexOf(term) : 0;
  const start = match > 70 ? match - 40 : 0;
  const snippet = text.slice(start, start + 180);
  return `${start ? '…' : ''}${snippet}${start + snippet.length < text.length ? '…' : ''}`;
}

export function shouldLocateFirstGlobalSearchResult(event: {
  key: string;
  isComposing?: boolean;
  keyCode?: number;
  repeat?: boolean;
}): boolean {
  return event.key === 'Enter' && !event.isComposing && event.keyCode !== 229 && !event.repeat;
}
