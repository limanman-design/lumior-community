'use client';
import { useLayoutEffect, type RefObject } from 'react';

/** A visual entrance only: saved positions, camera and content are never rewritten. */
export function useDailyEntry(visible: boolean, root: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const element = root.current;
    if (!visible || !element) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reduced.matches || typeof element.animate !== 'function') return;
    const animations: Animation[] = [];
    const play = (node: HTMLElement, frames: Keyframe[], duration: number, delay = 0) => {
      animations.push(node.animate(frames, { duration, delay, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' }));
    };
    const summary = element.querySelector<HTMLElement>('.daily-center');
    if (summary) play(summary, [{ opacity: 0, translate: '0 10px' }, { opacity: 1, translate: '0 0' }], 420);
    // Inner cards appear first, then the outer ring. Individual transforms compose
    // with the existing tilt / hover transform instead of replacing it.
    const cards = Array.from(element.querySelectorAll<HTMLElement>('.daily-card-shell'));
    const center = (card: HTMLElement) => ({ x: card.offsetLeft + card.offsetWidth / 2, y: card.offsetTop + card.offsetHeight / 2 });
    cards.sort((a, b) => { const p = center(a), q = center(b); return Math.hypot(p.x, p.y) - Math.hypot(q.x, q.y); });
    cards.forEach((card, index) => {
      const point = center(card);
      const inward = (value: number) => Math.max(-100, Math.min(100, -value * .18));
      const opacity = getComputedStyle(card).opacity;
      play(card, [
        { opacity: 0, translate: `${inward(point.x)}px ${inward(point.y)}px`, scale: '.86', rotate: `${point.x < 0 ? -4 : 4}deg` },
        { opacity, translate: '0 0', scale: '1', rotate: '0deg' },
      ], 720, 55 + Math.min(index * 35, 210));
    });
    const composer = element.querySelector<HTMLElement>('.ai-compose-slot');
    if (composer) play(composer, [{ opacity: 0, translate: '0 8px' }, { opacity: 1, translate: '0 0' }], 440, 80);
    // Cancel releases all temporary styles immediately, including the aged-card opacity.
    const stop = () => animations.forEach(animation => animation.cancel());
    element.addEventListener('pointerdown', stop, { capture: true, once: true });
    element.addEventListener('keydown', stop, { capture: true, once: true });
    element.addEventListener('wheel', stop, { capture: true, passive: true, once: true });
    reduced.addEventListener('change', stop);
    return () => {
      stop();
      element.removeEventListener('pointerdown', stop, true);
      element.removeEventListener('keydown', stop, true);
      element.removeEventListener('wheel', stop, true);
      reduced.removeEventListener('change', stop);
    };
  }, [visible, root]);
}
