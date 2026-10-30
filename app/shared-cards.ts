import type { Board, Card } from './canvas-model';
import { cardContentKeys } from './card-metadata.ts';
export const libraryDragType = 'application/x-lumior-card';
export const cardIdentity = (card: Card) => card.sharedId || card.id;
export function referenceBoards(card: Card, boards: Board[]) {
  if (card.kind === 'text' || card.kind === 'database') return [];
  return boards.filter((b) =>
    b.cards.some((c) => cardIdentity(c) === cardIdentity(card)),
  );
}
// Share content only: each instance keeps its geometry and local identity.
export function reconcileShared(
  before: Board,
  after: Board,
  boards: Board[],
  now = new Date().toISOString(),
): Board[] {
  const changed = after.cards.flatMap((card) => {
    if (card.kind === 'database') return [];
    const old = before.cards.find((previous) => previous.id === card.id);
    if (!old) return [];
    // Copy only edited fields so changing a file preserves the other instance's
    // translated caption. Editing a caption itself still updates both boards.
    const keys = cardContentKeys.filter(
      (key) => !Object.is(old[key], card[key]) && JSON.stringify(old[key]) !== JSON.stringify(card[key]),
    );
    return keys.length ? [{
      identity: cardIdentity(card),
      patch: { ...Object.fromEntries(keys.map((key) => [key, card[key]])), updatedAt: now } as Partial<Card>,
    }] : [];
  });
  return boards.map((board) => {
    const current = board.id === after.id ? after : board;
    return {
      ...current,
      cards: current.cards.map((c) => {
        const source = changed.find((s) => s.identity === cardIdentity(c));
        return source ? { ...c, ...source.patch } : c;
      }),
    };
  });
}
export function libraryInstance(
  card: Card,
  point: { x: number; y: number },
  sync: boolean,
  id: string,
): Card {
  const now = new Date().toISOString();
  const copied = structuredClone(card);
  // An independent copy belongs to the user even if its original was created
  // automatically from a reading note. Annotation removal must not retire it.
  if (!sync && copied.pdfExcerpt) {
    delete copied.pdfExcerpt.readingNote;
    copied.pdfExcerpt.independent = true;
  }
  return {
    ...copied,
    id,
    sharedId: sync && card.kind !== 'database' ? cardIdentity(card) : undefined,
    ...(sync ? {} : { createdAt: now, updatedAt: now, creationDateSource: 'actual' as const }),
    x: point.x,
    y: point.y,
  };
}
