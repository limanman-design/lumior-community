import type { Board, Card } from './canvas-model';
import { cardName } from './card-name.ts';
import type { PdfMark } from './pdf-annotations';

export const informationSidebarStorageKey = 'lumior-information-sidebar-v1';
export type InformationSidebarReference = { boardId: string; cardId: string };
export type InformationSidebarEntry = {
  key: string;
  boardId: string;
  boardTitle: string;
  card: Card;
  focusMark?: PdfMark;
  initialPage?: number;
  focusRequest?: object;
};

/** A sidebar entry points to the live card; it never creates another copy. */
export function informationSidebarKey(boardId: string, cardId: string) {
  return JSON.stringify([boardId, cardId]);
}

export function addInformationSidebarCard(
  references: InformationSidebarReference[], boardId: string, cardId: string,
): InformationSidebarReference[] {
  if (!boardId || !cardId || references.some(item => item.boardId === boardId && item.cardId === cardId)) return references;
  return [{ boardId, cardId }, ...references];
}

export function removeInformationSidebarCard(references: InformationSidebarReference[], key: string) {
  const next = references.filter(item => informationSidebarKey(item.boardId, item.cardId) !== key);
  return next.length === references.length ? references : next;
}

export function resolveInformationSidebarEntries(references: InformationSidebarReference[], boards: Board[]): InformationSidebarEntry[] {
  const lookup = new Map(boards.map(board => [board.id, board]));
  const seen = new Set<string>();
  return references.flatMap(reference => {
    const board = lookup.get(reference.boardId);
    const card = board?.cards.find(item => item.id === reference.cardId);
    const key = informationSidebarKey(reference.boardId, reference.cardId);
    if (!board || !card || seen.has(key)) return [];
    seen.add(key);
    return [{ key, boardId: board.id, boardTitle: board.title, card }];
  });
}

export function readInformationSidebarReferences(raw: string | null): InformationSidebarReference[] {
  if (!raw || raw.length > 500_000) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const references: InformationSidebarReference[] = [];
    const seen = new Set<string>();
    for (const item of value) {
      if (!item || typeof item !== 'object' || typeof item.boardId !== 'string' || typeof item.cardId !== 'string'
        || !item.boardId || !item.cardId) continue;
      const key = informationSidebarKey(item.boardId, item.cardId);
      if (seen.has(key)) continue;
      seen.add(key);
      references.push({ boardId: item.boardId, cardId: item.cardId });
    }
    return references;
  } catch { return []; }
}

const searchable = (value: string) => value.normalize('NFKC').toLocaleLowerCase();
export function searchInformationSidebarCards(boards: Board[], query: string, limit = 80): InformationSidebarEntry[] {
  const terms = searchable(query).trim().split(/\s+/).filter(Boolean);
  const results: InformationSidebarEntry[] = [];
  for (const board of boards) {
    for (const card of board.cards) {
      const haystack = searchable([board.title, card.title, cardName(card), card.body, card.pdfExcerpt?.mark.text || ''].join('\n'));
      if (!terms.every(term => haystack.includes(term))) continue;
      results.push({ key: informationSidebarKey(board.id, card.id), boardId: board.id, boardTitle: board.title, card });
      if (results.length >= limit) return results;
    }
  }
  return results;
}
