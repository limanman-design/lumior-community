'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { Board } from './canvas-model';
import { NoteCreationLifecycle } from './note-motion-model';
import './note-motion.css';

const EMPTY_IDS = new Set<string>();
const MAX_EXIT_SNAPSHOTS = 8;

/** Visuals are transient; the board and undo history change immediately. */
export function useNoteMotion(boardId: string, canvas: RefObject<HTMLDivElement | null>) {
  const [entries, setEntries] = useState({ boardId, ids: EMPTY_IDS });
  const entryTimers = useRef(new Map<string, { boardId: string; timer: ReturnType<typeof setTimeout> }>());
  const exits = useRef(new Map<HTMLElement, { boardId: string; animation: Animation }>());
  const creation = useRef(new NoteCreationLifecycle());

  const dispose = useCallback((outgoingBoard?: string) => {
    creation.current.clear(outgoingBoard);
    entryTimers.current.forEach((entry, id) => {
      if (outgoingBoard !== undefined && entry.boardId !== outgoingBoard) return;
      clearTimeout(entry.timer);
      entryTimers.current.delete(id);
    });
    exits.current.forEach((entry, element) => {
      if (outgoingBoard !== undefined && entry.boardId !== outgoingBoard) return;
      entry.animation.cancel();
      element.remove();
      exits.current.delete(element);
    });
  }, []);
  const clear = useCallback((outgoingBoard?: string) => {
    dispose(outgoingBoard);
    setEntries(previous => previous.ids.size && (outgoingBoard === undefined || previous.boardId === outgoingBoard) ? { ...previous, ids: EMPTY_IDS } : previous);
  }, [dispose]);
  const complete = useCallback((id: string) => {
    const entry = entryTimers.current.get(id);
    if (entry) clearTimeout(entry.timer);
    entryTimers.current.delete(id);
    setEntries(previous => {
      if (!previous.ids.has(id)) return previous;
      const ids = new Set(previous.ids);
      ids.delete(id);
      return { ...previous, ids };
    });
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const stop = () => { if (media.matches) clear(); };
    media.addEventListener('change', stop);
    return () => { media.removeEventListener('change', stop); clear(boardId); };
  }, [boardId, clear]);

  /** Call only after focus leaves the whole card, not between fields inside it. */
  const leaveCard = useCallback((id: string) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { clear(); return; }
    if (!creation.current.leave(boardId, id)) return;
    setEntries(previous => ({ boardId, ids: new Set([...(previous.boardId === boardId ? previous.ids : EMPTY_IDS), id]) }));
    const old = entryTimers.current.get(id);
    if (old) clearTimeout(old.timer);
    entryTimers.current.set(id, { boardId, timer: setTimeout(() => complete(id), 1200) });
  }, [boardId, clear, complete]);

  const prepare = (before: Board, after: Board) => {
    const { removed } = creation.current.prepare(before, after);
    removed.forEach(complete);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { creation.current.clear(); return; }

    const surface = canvas.current;
    if (!surface || !removed.length) return;
    const bounds = surface.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const elements = new Map(Array.from(surface.querySelectorAll<HTMLElement>('.world > [data-card-id]')).map(element => [element.dataset.cardId, element]));
    for (const id of removed) {
      if (exits.current.size >= MAX_EXIT_SNAPSHOTS) break;
      const element = elements.get(id);
      if (!element?.parentElement || typeof element.animate !== 'function') continue;
      const rect = element.getBoundingClientRect();
      if (rect.right <= bounds.left || rect.left >= bounds.right || rect.bottom <= bounds.top || rect.top >= bounds.bottom) continue;
      // Snapshot the already-rendered content; no editor, handlers, or model survive.
      const snapshot = element.cloneNode(true) as HTMLElement;
      snapshot.querySelectorAll('.card-toolbar,.connector,.resize-edge,.resize-handle,.type-label,.note-pixel-reveal').forEach(child => child.remove());
      for (const child of [snapshot, ...snapshot.querySelectorAll<HTMLElement>('*')]) {
        child.removeAttribute('id');
        child.removeAttribute('data-card-id');
        child.removeAttribute('data-card-kind');
        child.removeAttribute('autofocus');
      }
      const sourceFields = element.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>('textarea,input');
      snapshot.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>('textarea,input').forEach((field, index) => { field.value = sourceFields[index]?.value || ''; });
      const sourceScroll = element.querySelector<HTMLElement>('.card-scroll');
      snapshot.removeAttribute('aria-label');
      snapshot.removeAttribute('tabindex');
      snapshot.setAttribute('aria-hidden', 'true');
      snapshot.inert = true;
      snapshot.classList.remove('selected', 'editing', 'card-toolbar-hover');
      snapshot.classList.add('note-removal-snapshot');
      snapshot.style.width = `${element.offsetWidth}px`;
      snapshot.style.height = `${element.offsetHeight}px`;
      element.parentElement.appendChild(snapshot);
      const targetScroll = snapshot.querySelector<HTMLElement>('.card-scroll');
      if (sourceScroll && targetScroll) { targetScroll.scrollTop = sourceScroll.scrollTop; targetScroll.scrollLeft = sourceScroll.scrollLeft; }
      const animation = snapshot.animate([
        { opacity: 1, transform: 'translateY(0) scale(1)' },
        { opacity: 0, transform: 'translateY(3px) scale(.975)' },
      ], { duration: 160, easing: 'cubic-bezier(.3,0,.8,.25)', fill: 'forwards' });
      exits.current.set(snapshot, { boardId: after.id, animation });
      const finish = () => { snapshot.remove(); exits.current.delete(snapshot); };
      void animation.finished.then(finish, finish);
    }
  };

  return { enteringIds: entries.boardId === boardId ? entries.ids : EMPTY_IDS, prepare, leaveCard, complete, clear };
}
