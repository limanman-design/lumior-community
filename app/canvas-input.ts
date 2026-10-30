import type { Point, View } from './canvas-model';

export type FlashlightLevel = 1 | 2 | 3;
export const flashlightStrength: Record<FlashlightLevel, number> = { 1: .28, 2: .65, 3: 1 };
export const nextFlashlightLevel = (level: FlashlightLevel): FlashlightLevel => level === 3 ? 1 : level === 1 ? 2 : 3;

export function canvasPointerAction(button: number, flashlight: boolean) {
  if (button === 2) return flashlight ? 'exit-flashlight' : 'pan';
  if (button === 1 || flashlight && button === 0) return 'pan';
  return null;
}

type PanGesture = {
  start: Point;
  view: View;
  flashlight?: { canCycle: boolean; dragged: boolean };
};

// Screen pixels keep clicks and drags consistent at every board zoom level.
const dragThreshold = 4;
export function panView(gesture: PanGesture, point: Point): View | null {
  const dx = point.x - gesture.start.x, dy = point.y - gesture.start.y;
  if (gesture.flashlight) {
    if (Math.hypot(dx, dy) >= dragThreshold) gesture.flashlight.dragged = true;
    if (gesture.flashlight.canCycle && !gesture.flashlight.dragged) return null;
  }
  return { ...gesture.view, x: gesture.view.x + dx, y: gesture.view.y + dy };
}

export function isFlashlightClick(gesture: PanGesture, point: Point) {
  return !!gesture.flashlight?.canCycle && !gesture.flashlight.dragged &&
    Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) < dragThreshold;
}
