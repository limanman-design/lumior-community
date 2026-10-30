'use client';

import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react';
import { createTabReadingSessionStore, finiteScrollPosition, tabReadingSessionKey, type TabScrollPosition } from './tab-reading-session-model';

type Store = ReturnType<typeof createTabReadingSessionStore>;
const ReadingSessionContext = createContext<{ boardId: string; store: Store } | null>(null);

export function TabReadingSessionProvider({ boardId, validBoardIds, resetKey = 0, children }: {
  boardId: string;
  validBoardIds?: readonly string[];
  resetKey?: number;
  children: ReactNode;
}) {
  const { store } = useMemo(() => ({ resetKey, store: createTabReadingSessionStore() }), [resetKey]);
  useLayoutEffect(() => { store.prune(validBoardIds); }, [store, validBoardIds]);
  const value = useMemo(() => ({ boardId, store }), [boardId, store]);
  return <ReadingSessionContext.Provider value={value}>{children}</ReadingSessionContext.Provider>;
}

export function useTabReadingSession<T>(cardId: string, slot: string, sourceKey = '') {
  const context = useContext(ReadingSessionContext);
  const boardId = context?.boardId ?? '';
  const store = context?.store;
  const sessionKey = tabReadingSessionKey(boardId, cardId, slot, sourceKey);
  const save = useCallback((snapshot: T) => { store?.save(boardId, sessionKey, snapshot); }, [boardId, sessionKey, store]);
  return { sessionKey, snapshot: store?.get<T>(sessionKey), save };
}

/** Wait for lazily mounted document content rather than restoring against an empty box. */
export function useTabReadingScroll(cardId: string, slot: string, ref: RefObject<HTMLElement | null>, options: {
  sourceKey?: string;
  enabled?: boolean;
  restore?: boolean;
  contentSelector?: string;
} = {}) {
  const { sourceKey = '', enabled = true, restore: shouldRestore = true, contentSelector } = options;
  const session = useTabReadingSession<TabScrollPosition>(cardId, slot, sourceKey);
  const latest = useRef(session);
  useLayoutEffect(() => { latest.current = session; }, [session]);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!enabled || !root) return;
    const { snapshot, save } = latest.current;
    const desired = shouldRestore && snapshot ? finiteScrollPosition(snapshot) : undefined;
    let restoring = !!desired, frame = 0;
    let mutation: MutationObserver | undefined, resize: ResizeObserver | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const capture = () => save(finiteScrollPosition(root));
    const stopRestoring = () => {
      restoring = false;
      mutation?.disconnect(); resize?.disconnect();
      if (timeout) clearTimeout(timeout);
      cancelAnimationFrame(frame); frame = 0;
    };
    const restore = () => {
      frame = 0;
      if (!restoring || !desired || contentSelector && !root.querySelector(contentSelector)) return;
      root.scrollTo({ top: desired.scrollTop, left: desired.scrollLeft, behavior: 'instant' });
      if (desired.scrollTop <= Math.max(0, root.scrollHeight - root.clientHeight) + 1 && desired.scrollLeft <= Math.max(0, root.scrollWidth - root.clientWidth) + 1) stopRestoring();
    };
    const schedule = () => { if (restoring && !frame) frame = requestAnimationFrame(restore); };
    const onScroll = () => { if (!restoring) capture(); };
    const onInput = () => { stopRestoring(); capture(); };
    root.addEventListener('scroll', onScroll, { passive: true });
    for (const name of ['wheel', 'touchstart', 'pointerdown', 'keydown']) root.addEventListener(name, onInput, { passive: true });
    if (restoring) {
      mutation = new MutationObserver(schedule);
      mutation.observe(root, { childList: true, subtree: true, characterData: true });
      resize = new ResizeObserver(schedule);
      resize.observe(root);
      if (root.firstElementChild) resize.observe(root.firstElementChild);
      timeout = setTimeout(() => { restore(); stopRestoring(); capture(); }, 20000);
      restore();
    }
    return () => {
      // Do not overwrite an unfulfilled restoration with the temporarily empty DOM.
      if (!restoring && root.isConnected) capture();
      stopRestoring();
      root.removeEventListener('scroll', onScroll);
      for (const name of ['wheel', 'touchstart', 'pointerdown', 'keydown']) root.removeEventListener(name, onInput);
    };
  }, [session.sessionKey, session.save, ref, enabled, shouldRestore, contentSelector]);
}
