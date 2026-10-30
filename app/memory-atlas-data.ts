import type { Board, Card } from './canvas-model';
import { documentText } from './card-document.ts';
import { cardIdentity } from './shared-cards.ts';
import type { MemoryAtlasData, MemoryItem } from './vendor/memory-atlas/types';

const dayMs = 864e5;
// Product-approved simulated dates for legacy cards. Keep this range fixed:
// dates never change on refresh and are never presented as real creation dates.
export function simulatedCardDate(card: Pick<Card, 'id' | 'sharedId'>): string {
  let hash = 2166136261;
  for (const character of card.sharedId || card.id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  return new Date(Date.UTC(2026, 6, 1) + (hash % 92) * dayMs).toISOString();
}

const hasDate = (card: Card) => typeof card.createdAt === 'string' && Number.isFinite(Date.parse(card.createdAt));

export function dateLegacyBoard(board: Board): Board {
  let changed = false;
  const cards = board.cards.map(card => {
    if (hasDate(card)) return card;
    changed = true;
    return { ...card, createdAt: simulatedCardDate(card), creationDateSource: 'simulated' as const };
  });
  return changed ? { ...board, cards } : board;
}

export function dateAddedCards(before: Board, after: Board, boards: Board[], now = new Date().toISOString()): Board {
  const originals = new Map(boards.flatMap(board => board.cards).map(card => [cardIdentity(card), card]));
  const previous = new Map(before.cards.map(card => [card.id, card]));
  return { ...after, cards: after.cards.map(card => {
    const previousCard = previous.get(card.id);
    if (previousCard && hasDate(card)) return card;
    const original = previous.get(card.id) || (card.sharedId ? originals.get(cardIdentity(card)) : undefined);
    const createdAt = original?.createdAt || (hasDate(card) ? card.createdAt! : now);
    return { ...card, createdAt, creationDateSource: original?.creationDateSource || card.creationDateSource || 'actual', updatedAt: original ? original.updatedAt : card.updatedAt || (hasDate(card) ? undefined : now), tags: card.tags || original?.tags || [] };
  }) };
}

export type AtlasLocation = { boardId: string; boardTitle: string; cardId: string };
export type LumiorMemory = MemoryItem & { card: Card; locations: AtlasLocation[]; simulatedDate: boolean };
export type LumiorAtlasData = Omit<MemoryAtlasData, 'memories'> & { memories: LumiorMemory[] };

export const atlasCategories = [
  { id: 'note', name: '笔记', color: '#60d6ff' },
  { id: 'text', name: '文本', color: '#c4a5ff' },
  { id: 'image', name: '图片', color: '#88d9b3' },
  { id: 'pdf', name: 'PDF', color: '#ffbc86' },
  { id: 'video', name: '视频', color: '#f093c3' },
];

function summary(card: Card) {
  const plain = (card.blocks?.length ? documentText(card.blocks) : card.body || card.detail || '')
    .replace(/^\s*#{1,6}\s+/gm, '').replace(/\*\*/g, '').trim();
  return (plain.match(/^[^\n。！？.!?]+[。！？.!?]?/)?.[0] || plain).slice(0, 160);
}

function nonempty(card: Card) {
  return !!(summary(card) || card.image || card.pdf || card.video || (card.title.trim() && card.title !== 'Untitled'));
}

export function mapMemoryAtlas(boards: Board[], activeBoardId: string): LumiorAtlasData {
  const memories = new Map<string, LumiorMemory>();
  // Prefer the language/content of the active board for shared media cards.
  const ordered = [...boards.filter(board => board.id === activeBoardId), ...boards.filter(board => board.id !== activeBoardId)];
  for (const board of ordered) for (const card of board.cards) {
    if (card.kind === 'database' || !nonempty(card)) continue;
    const id = cardIdentity(card);
    const location = { boardId: board.id, boardTitle: board.title, cardId: card.id };
    const existing = memories.get(id);
    if (existing) { existing.locations.push(location); continue; }
    memories.set(id, {
      id, title: card.title || 'Untitled', note: summary(card), categoryId: card.kind,
      date: (hasDate(card) ? card.createdAt! : simulatedCardDate(card)).slice(0, 10),
      understanding: 0.6, links: [], card, locations: [location],
      simulatedDate: card.creationDateSource === 'simulated' || !hasDate(card),
    });
  }
  for (const board of boards) {
    const identities = new Map(board.cards.map(card => [card.id, cardIdentity(card)]));
    for (const edge of board.edges) {
      const from = memories.get(identities.get(edge.from) || '');
      const to = memories.get(identities.get(edge.to) || '');
      if (!from || !to || from === to) continue;
      if (!from.links!.includes(to.id)) from.links!.push(to.id);
      if (!to.links!.includes(from.id)) to.links!.push(from.id);
    }
  }
  const sorted = [...memories.values()].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return { categories: atlasCategories, memories: sorted, fragments: [] };
}
