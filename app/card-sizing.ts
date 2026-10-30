import type { Board, Card } from './canvas-model';

export type ResizeEdge = 'left' | 'right' | 'top' | 'bottom';
export type ImageResizeCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export const imageResizeLimits = { minLongEdge: 120, maxLongEdge: 1600 } as const;

/** Resize the image area, leaving its original pixels and optional note alone.
 * Width includes the card's two 1px borders; the opposite image corner stays put.
 * Project the drag onto the aspect-ratio diagonal so either axis works smoothly. */
export function resizeImageCorner(card: Card, corner: ImageResizeCorner, dx: number, dy: number, aspect: number) {
  if (!Number.isFinite(aspect) || aspect <= 0 || !Number.isFinite(dx) || !Number.isFinite(dy)) return {};
  const width = Math.max(1, card.width - 2), height = width / aspect;
  const left = corner.endsWith('left'), top = corner.startsWith('top');
  const scale = 1 + ((left ? -dx : dx) * width + (top ? -dy : dy) * height) / (width * width + height * height);
  const longEdge = Math.max(width, height);
  const nextLongEdge = Math.min(imageResizeLimits.maxLongEdge, Math.max(imageResizeLimits.minLongEdge, longEdge * scale));
  const nextWidth = width * nextLongEdge / longEdge, nextHeight = height * nextLongEdge / longEdge;
  return {
    x: left ? card.x + width - nextWidth : card.x,
    y: top ? card.y + height - nextHeight : card.y,
    width: nextWidth + 2,
    height: nextHeight + 2,
  };
}
export const defaultVideoWidth = 562; // 560px player plus the card's two borders.
export const videoCardHeight = (width: number) => Math.ceil((width - 2) * 9 / 16 + 62);
const limitWidth = (width: number, minimum = 160) => Math.min(1400, Math.max(minimum, width));

export function resizeNoteEdge(card: Card, edge: ResizeEdge, dx: number, dy: number, height: number) {
  const minWidth = card.kind === 'database' ? 320 : 160;
  const minHeight = card.kind === 'database' ? 220 : card.kind === 'text' ? 44 : 120;
  const width = edge === 'left' ? limitWidth(card.width - dx, minWidth) : edge === 'right' ? limitWidth(card.width + dx, minWidth) : card.width;
  const nextHeight = edge === 'top' ? Math.max(minHeight, height - dy) : edge === 'bottom' ? Math.max(minHeight, height + dy) : height;
  return {
    x: edge === 'left' ? card.x + card.width - width : card.x,
    y: edge === 'top' ? card.y + height - nextHeight : card.y,
    width,
    height: nextHeight,
  };
}

export function normalizeVideoBoard(board: Board): Board {
  let changed = false, changedGrid = false;
  const grid: Record<string, { x: number; y: number; nextX: number; nextY: number }> = {
    'game-video-hike': { x: 1220, y: 1570, nextX: 1120, nextY: 1570 },
    'game-video-guidance': { x: 1690, y: 1570, nextX: 1722, nextY: 1570 },
    'game-video-hike-trailer': { x: 1220, y: 1910, nextX: 1120, nextY: 2007 },
    'game-video-firewatch': { x: 1690, y: 1910, nextX: 1722, nextY: 2007 },
  };
  const cards = board.cards.map(card => {
    if (card.kind !== 'video') return card;
    const width = Math.max(defaultVideoWidth, card.width), height = videoCardHeight(width);
    const original = grid[card.sharedId || card.id.replace(/-en$/, '')];
    const move = !!original && card.width === 430 && card.height === 280 && card.x === original.x && card.y === original.y;
    if (width === card.width && height === card.height && !move) return card;
    changed = true; changedGrid ||= move;
    return { ...card, width, height, ...(move ? { x: original.nextX, y: original.nextY } : {}) };
  });
  if (!changed) return board;
  const sections = board.sections?.map(section => changedGrid && /^game-video(?:-en)?$/.test(section.id) && section.x === 1180 && section.y === 1510 && section.width === 980 && section.height === 730
    ? { ...section, x: 1100, width: 1204, height: 924 } : section);
  return { ...board, cards, ...(sections ? { sections } : {}) };
}
