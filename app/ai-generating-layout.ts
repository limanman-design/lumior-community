import type { Card, Point, View } from './canvas-model';
import { findOpenCanvasPosition } from './imported-media-layout.ts';
import { CANVAS_ZOOM_BASE, CANVAS_ZOOM_MIN, CANVAS_ZOOM_MAX } from './canvas-zoom.ts';

export const generatingCardSize = { width: 360, height: 220 };

export function placeGeneratingCard(center: Point, cards: Card[], measuredHeights: Record<string, number> = {}) {
  return findOpenCanvasPosition({ x: center.x - generatingCardSize.width / 2, y: center.y - generatingCardSize.height / 2, ...generatingCardSize }, cards, measuredHeights);
}

/** The first paint must include both the placeholder and its visible camera. */
export function generatingCardView(point: Point, available: { width: number; bottom: number }): View {
  const width = Math.max(120, available.width), bottom = Math.max(160, available.bottom);
  const zoom = Math.max(CANVAS_ZOOM_MIN, Math.min(CANVAS_ZOOM_MAX, CANVAS_ZOOM_BASE,
    (width - 80) / generatingCardSize.width, (bottom - 88) / generatingCardSize.height));
  return { zoom, x: width / 2 - (point.x + generatingCardSize.width / 2) * zoom,
    y: (64 + bottom) / 2 - (point.y + generatingCardSize.height / 2) * zoom };
}
