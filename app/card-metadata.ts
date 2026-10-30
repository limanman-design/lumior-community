import type { Card } from './canvas-model';

// Shared, user-authored content. Canvas geometry and reading state are local.
export const cardContentKeys = [
  'title', 'body', 'blocks', 'storedDocument', 'obsidianSource', 'image', 'detail', 'sourceName',
  'pdf', 'pdfExcerpt', 'video', 'kind', 'tags', 'contentRole', 'sourceContentId', 'authors', 'year', 'bibliography',
] as const satisfies readonly (keyof Card)[];

export function cardTimestamp(value: string | undefined): number {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : 0;
}

export function cardCreatedTime(card: Card): number {
  return card.creationDateSource === 'simulated' ? 0 : cardTimestamp(card.createdAt);
}

export function cardUpdatedTime(card: Card): number {
  // Legacy cards have no modification history; their real creation date is
  // only a sorting fallback, never displayed as a recorded modification.
  return cardTimestamp(card.updatedAt) || cardCreatedTime(card);
}

export function compareCardDates(a: Card, b: Card, field: 'updated' | 'created' = 'updated'): number {
  const time = field === 'created' ? cardCreatedTime : cardUpdatedTime;
  return time(b) - time(a);
}
