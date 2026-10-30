import type { PdfMark } from './pdf-annotations';

type PointerSample = {
  pointerId: number;
  clientX: number;
  clientY: number;
  buttons: number;
  type?: string;
};
type DragStart = PointerSample & { currentTarget: Element };
export type PdfMarkPreview = { mark: PdfMark; x: number; y: number };
const activeDrags = new Set<() => void>();

/** The guide consumes Escape before native drag listeners, so ending it also cancels its gesture. */
export function cancelPdfMarkDrags() {
  for (const cancel of activeDrags) cancel();
}

/** A pointer gesture owns its source and cleanup even when its original button loses events. */
export function createPdfMarkDrag({ onPreview, onDrop }: {
  onPreview: (preview: PdfMarkPreview | null) => void;
  onDrop: (mark: PdfMark, point: { clientX: number; clientY: number }) => void;
}) {
  let gesture: {
    pointerId: number;
    x: number;
    y: number;
    lastX: number;
    lastY: number;
    active: boolean;
    mark: PdfMark;
    target: Element;
    remove: () => void;
  } | null = null;

  const finish = (event?: PointerSample, place = false) => {
    const current = gesture;
    if (!current || event && event.pointerId !== current.pointerId) return;
    // Clear ownership before releasing capture or calling React: every exit is idempotent.
    gesture = null;
    activeDrags.delete(cancel);
    current.remove();
    if (current.target.hasPointerCapture?.(current.pointerId))
      current.target.releasePointerCapture(current.pointerId);
    onPreview(null);
    if (place && current.active && event)
      onDrop(current.mark, { clientX: event.clientX, clientY: event.clientY });
  };
  const move = (event: PointerSample) => {
    const current = gesture;
    if (!current || event.pointerId !== current.pointerId) return;
    // A missed release must never turn an ordinary hover into another drag.
    if (!(event.buttons & 1)) { finish(event); return; }
    if (event.clientX === current.lastX && event.clientY === current.lastY) return;
    current.lastX = event.clientX;
    current.lastY = event.clientY;
    if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > 6)
      current.active = true;
    if (current.active)
      onPreview({ mark: current.mark, x: event.clientX, y: event.clientY });
  };
  const end = (event: PointerSample) => finish(event, event.type === 'pointerup');
  const cancel = () => finish();

  return {
    pending: () => gesture !== null,
    move,
    end,
    cancel,
    start(event: DragStart, mark: PdfMark) {
      cancel();
      if (!Number.isFinite(event.pointerId)) return;
      const target = event.currentTarget;
      const document = target.ownerDocument;
      const view = document.defaultView;
      if (!view) return;
      const lostCapture = (lost: Event) => finish(lost as PointerEvent);
      const visibility = () => { if (document.visibilityState === 'hidden') cancel(); };
      const escape = (key: KeyboardEvent) => { if (key.key === 'Escape') cancel(); };
      // Install synchronously on down, so a quick drag cannot release before the listeners exist.
      gesture = {
        pointerId: event.pointerId, x: event.clientX, y: event.clientY,
        lastX: event.clientX, lastY: event.clientY,
        active: false, mark, target,
        remove: () => {
          view.removeEventListener('pointermove', move, true);
          view.removeEventListener('pointerup', end, true);
          view.removeEventListener('pointercancel', end, true);
          view.removeEventListener('blur', cancel);
          view.removeEventListener('keydown', escape, true);
          document.removeEventListener('visibilitychange', visibility);
          target.removeEventListener('lostpointercapture', lostCapture);
        },
      };
      activeDrags.add(cancel);
      view.addEventListener('pointermove', move, true);
      view.addEventListener('pointerup', end, true);
      view.addEventListener('pointercancel', end, true);
      view.addEventListener('blur', cancel);
      view.addEventListener('keydown', escape, true);
      document.addEventListener('visibilitychange', visibility);
      target.addEventListener('lostpointercapture', lostCapture);
      try { target.setPointerCapture?.(event.pointerId); }
      catch { /* Window listeners still own release if capture is unavailable. */ }
    },
  };
}
