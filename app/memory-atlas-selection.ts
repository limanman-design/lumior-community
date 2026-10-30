import type { Board } from './canvas-model';
import type { LumiorAtlasData, LumiorMemory } from './memory-atlas-data';
import { cardIdentity } from './shared-cards.ts';

// A note can become empty while its editor is open. Keep that live Card
// selected until the dialog closes, without retaining deleted cards.
export function resolveAtlasSelection(
  boards: readonly Board[],
  activeBoardId: string,
  previous: LumiorMemory | null,
  data: LumiorAtlasData,
  retainEmptyNote = false,
): LumiorMemory | undefined {
  if (!previous) return;
  const mapped = data.memories.find(memory => memory.id === previous.id);
  if (mapped || !retainEmptyNote) return mapped;
  const ordered = [
    ...boards.filter(board => board.id === activeBoardId),
    ...boards.filter(board => board.id !== activeBoardId),
  ];
  const locations: LumiorMemory['locations'] = [];
  let card: LumiorMemory['card'] | undefined;
  for (const board of ordered) for (const candidate of board.cards) {
    if (cardIdentity(candidate) !== previous.id || !['note', 'text'].includes(candidate.kind)) continue;
    card ??= candidate;
    locations.push({ boardId: board.id, boardTitle: board.title, cardId: candidate.id });
  }
  if (!card) return;
  return { ...previous, card, title: card.title || 'Untitled', note: '', categoryId: card.kind, locations };
}
