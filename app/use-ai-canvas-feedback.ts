'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import type { Board } from './canvas-model';
import './ai-canvas-feedback.css';

type Snapshot = { boardId: string; boxes: Map<string, { x: number; y: number; width: number; height: number }>; paths: Map<string, string> };
const boxSelector = '[data-card-id],[data-section-id],[data-edge-label-id]';
const key = (element: HTMLElement) => element.dataset.cardId ? `card:${element.dataset.cardId}` : element.dataset.sectionId ? `section:${element.dataset.sectionId}` : `edge:${element.dataset.edgeLabelId}`;

/** Presentation only: all saved positions are committed once, before motion. */
export function useAiCanvasFeedback(canvas: RefObject<HTMLDivElement | null>, board: Board) {
  const surface = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => { surface.current = canvas.current; });
  const pending = useRef<Snapshot | null>(null);
  const animations = useRef<Animation[]>([]);
  const reading = useRef(new Map<string, HTMLElement>());
  const cancelMotion = useCallback(() => { animations.current.forEach(animation => animation.cancel()); animations.current = []; }, []);
  const clearReading = useCallback(() => { reading.current.forEach(element => element.remove()); reading.current.clear(); }, []);
  const readCards = useCallback((ids: string[]) => {
    const root = surface.current;
    if (!root) return;
    const wanted = new Set(ids);
    reading.current.forEach((element, id) => { if (!wanted.has(id) || !element.isConnected) { element.remove(); reading.current.delete(id); } });
    root.querySelectorAll<HTMLElement>('[data-card-id]').forEach(card => {
      const id = card.dataset.cardId!;
      if (!wanted.has(id) || reading.current.has(id)) return;
      const glow = document.createElement('span');
      glow.className = 'ai-card-reading'; glow.setAttribute('aria-hidden', 'true');
      card.appendChild(glow); reading.current.set(id, glow);
    });
  }, []);
  const prepareMotion = useCallback(() => {
    cancelMotion();
    const root = surface.current;
    if (!root || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const boxes: Snapshot['boxes'] = new Map(), paths: Snapshot['paths'] = new Map();
    root.querySelectorAll<HTMLElement>(boxSelector).forEach(element => boxes.set(key(element), { x: parseFloat(element.style.left), y: parseFloat(element.style.top), width: element.offsetWidth, height: element.offsetHeight }));
    root.querySelectorAll<SVGPathElement>('[data-ai-edge-id]').forEach(element => paths.set(element.dataset.aiEdgeId!, element.getAttribute('d') || ''));
    pending.current = { boardId: board.id, boxes, paths };
  }, [board.id, cancelMotion]);
  useLayoutEffect(() => {
    const previous = pending.current; pending.current = null;
    const root = surface.current;
    // A later edit or ordinary undo owns the new geometry immediately.
    if (!previous) { cancelMotion(); return; }
    if (!root || !previous || previous.boardId !== board.id || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const play = (element: Element, frames: Keyframe[]) => {
      const animation = element.animate(frames, { duration: 520, easing: 'cubic-bezier(.22,1,.36,1)' });
      animations.current.push(animation);
      animation.onfinish = () => { animations.current = animations.current.filter(item => item !== animation); };
    };
    root.querySelectorAll<HTMLElement>(boxSelector).forEach(element => {
      const old = previous.boxes.get(key(element));
      if (!old) { if (element.dataset.sectionId) play(element, [{ opacity: 0 }, { opacity: 1 }]); return; }
      const dx = old.x - parseFloat(element.style.left), dy = old.y - parseFloat(element.style.top);
      if (!Number.isFinite(dx + dy)) return;
      const resize = !!element.dataset.sectionId && (old.width !== element.offsetWidth || old.height !== element.offsetHeight);
      if (dx || dy || resize) play(element, [{ translate: `${dx}px ${dy}px`, ...(resize ? { width: `${old.width}px`, height: `${old.height}px` } : {}) }, { translate: '0px 0px', ...(resize ? { width: `${element.offsetWidth}px`, height: `${element.offsetHeight}px` } : {}) }]);
    });
    root.querySelectorAll<SVGPathElement>('[data-ai-edge-id]').forEach(element => {
      const old = previous.paths.get(element.dataset.aiEdgeId!), next = element.getAttribute('d');
      if (old && next && old !== next) play(element, [{ d: `path("${old}")` }, { d: `path("${next}")` }]);
    });
  }, [board, canvas, cancelMotion]);
  useEffect(() => {
    const root = surface.current, media = window.matchMedia('(prefers-reduced-motion: reduce)');
    root?.addEventListener('pointerdown', cancelMotion, true);
    media.addEventListener('change', cancelMotion);
    return () => { pending.current = null; cancelMotion(); clearReading(); root?.removeEventListener('pointerdown', cancelMotion, true); media.removeEventListener('change', cancelMotion); };
  }, [board.id, canvas, cancelMotion, clearReading]);
  return { prepareMotion, readCards, clearReading };
}
