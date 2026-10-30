import type { Card } from './canvas-model';

type Point = { clientX: number; clientY: number };
type PointerSample = Point & { pointerId: number; buttons: number; type?: string };
type DragStart = PointerSample & { button: number; currentTarget: Element };
export type LibraryDragPreview = { title: string; x: number; y: number };

/** Keep the source and release listener alive when a library tile moves or loses capture. */
export function createLibraryCardDrag({ onPreview, onDrop, onActivate }: {
  onPreview: (preview: LibraryDragPreview | null) => void;
  onDrop: (card: Card, point: Point) => void;
  onActivate: () => void;
}) {
  let gesture: {
    pointerId: number;
    x: number;
    y: number;
    active: boolean;
    card: Card;
    target: Element;
    remove: () => void;
  } | null = null;

  const finish = (event?: PointerSample, place = false) => {
    const current = gesture;
    if (!current || (event && event.pointerId !== current.pointerId)) return;
    // Clear ownership first: release, cancellation and a new drag cannot place twice.
    gesture = null;
    current.remove();
    try {
      if (current.target.hasPointerCapture?.(current.pointerId))
        current.target.releasePointerCapture(current.pointerId);
    } catch { /* The source can disappear during a library refresh. */ }
    onPreview(null);
    if (place && current.active && event)
      onDrop(current.card, { clientX: event.clientX, clientY: event.clientY });
  };
  const cancel = () => finish();
  const move = (event: PointerSample) => {
    const current = gesture;
    if (!current || event.pointerId !== current.pointerId) return;
    if (!(event.buttons & 1)) { cancel(); return; }
    if (!current.active && Math.hypot(event.clientX - current.x, event.clientY - current.y) > 7) {
      current.active = true;
      onActivate();
    }
    if (current.active)
      onPreview({ title: current.card.title, x: event.clientX, y: event.clientY });
  };
  const end = (event: PointerSample) => finish(event, event.type === 'pointerup');

  return {
    cancel,
    start(event: DragStart, card: Card) {
      if (event.button !== 0 || !Number.isFinite(event.pointerId)) return;
      cancel();
      const target = event.currentTarget;
      const document = target.ownerDocument;
      const view = document.defaultView;
      if (!view) return;
      const visibility = () => { if (document.visibilityState === 'hidden') cancel(); };
      const escape = (key: KeyboardEvent) => { if (key.key === 'Escape') cancel(); };
      gesture = {
        pointerId: event.pointerId, x: event.clientX, y: event.clientY,
        active: false, card, target,
        remove: () => {
          view.removeEventListener('pointermove', move, true);
          view.removeEventListener('pointerup', end, true);
          view.removeEventListener('pointercancel', end, true);
          view.removeEventListener('blur', cancel);
          view.removeEventListener('keydown', escape, true);
          document.removeEventListener('visibilitychange', visibility);
        },
      };
      // Install on down, before even a fast release. Capture loss must not remove
      // these listeners: a reordered tile may no longer receive pointerup.
      view.addEventListener('pointermove', move, true);
      view.addEventListener('pointerup', end, true);
      view.addEventListener('pointercancel', end, true);
      view.addEventListener('blur', cancel);
      view.addEventListener('keydown', escape, true);
      document.addEventListener('visibilitychange', visibility);
      try { target.setPointerCapture(event.pointerId); }
      catch { /* Window listeners also handle unavailable pointer capture. */ }
    },
  };
}
