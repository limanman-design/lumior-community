import type { Board, Card, Point } from './canvas-model';
import type { ImportedCard } from './file-import';
import { defaultVideoWidth, videoCardHeight } from './card-sizing.ts';
import { layoutImportedMedia, type ImportedMediaLayoutOptions } from './imported-media-layout.ts';
export type { ImportedMediaLayoutOptions } from './imported-media-layout.ts';

export type MediaCreationKind = 'image' | 'pdf' | 'video';
export const mediaFileAccept: Record<MediaCreationKind, string> = {
  image: '.png,.jpg,.jpeg,.webp,.gif',
  pdf: '.pdf',
  video: '.mp4,.webm,.mov',
};

export function acceptsMediaFile(kind: MediaCreationKind | null, filename: string) {
  if (!kind) return true;
  const extension = filename.split('.').at(-1)?.toLowerCase();
  return mediaFileAccept[kind].split(',').some(value => value.slice(1) === extension);
}

// An asynchronous import belongs to the board where the user started it.
export function appendImportedCard(boards: Board[], targetId: string, imported: ImportedCard,
  point: Point, index: number, id: string, now = new Date().toISOString()) {
  if (!boards.some(board => board.id === targetId)) return null;
  const width = imported.kind === 'video' ? defaultVideoWidth : imported.kind === 'pdf' ? 360 : 428;
  const card: Card = { ...imported, id, createdAt: now, updatedAt: now, tags: [], creationDateSource: 'actual', width,
    ...(imported.kind === 'video' ? { height: videoCardHeight(width) } : {}),
    x: point.x - width / 2 + index * 48, y: point.y - 160 + index * 48 };
  return { card, boards: boards.map(board => board.id === targetId ? { ...board, cards: [...board.cards, card] } : board) };
}

export function appendImportedMediaBatch(
  boards: Board[], targetId: string, imports: ImportedCard[], point: Point,
  makeId: () => string, options: ImportedMediaLayoutOptions = {},
) {
  const target = boards.find(board => board.id === targetId);
  if (!target) return null;
  if (!imports.length) return { cards: [], boards };
  const positions = layoutImportedMedia(imports, point, target.cards, options);
  const now = options.now || new Date().toISOString();
  const cards: Card[] = imports.map((imported, index) => ({
    ...imported, ...positions[index], id: makeId(), createdAt: now, updatedAt: now, tags: [], creationDateSource: 'actual',
  }));
  return { cards, boards: boards.map(board => board.id === targetId ? { ...board, cards: [...board.cards, ...cards] } : board) };
}
