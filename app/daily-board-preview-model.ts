import type { Card } from './canvas-model';

// A preview changes only the camera, never the board's stored geometry.
export function dailyBoardPreviewView(cards: Card[], width: number, height: number, sizes: Record<string, number> = {}, focus?: Card, inset = { left: 0, top: 0 }) {
  width = Math.max(1, width - inset.left);
  height = Math.max(1, height - inset.top);
  const visible = focus ? [focus] : cards;
  if (!visible.length) return { x: inset.left + width / 2, y: inset.top + height / 2, scale: 1 };
  const left = Math.min(...visible.map(card => card.x));
  const top = Math.min(...visible.map(card => card.y));
  const right = Math.max(...visible.map(card => card.x + card.width));
  const bottom = Math.max(...visible.map(card => card.y + (sizes[card.id] || card.height || 300)));
  const scale = Math.max(.05, Math.min(focus ? 1 : .9, Math.max(1, width - 112) / Math.max(1, right - left), Math.max(1, height - 144) / Math.max(1, bottom - top)));
  return { scale, x: inset.left + width / 2 - (left + right) / 2 * scale, y: inset.top + (height - 32) / 2 - (top + bottom) / 2 * scale };
}
