'use client';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  boardTabsStorageKey,
  closeBoardTab,
  emptyBoardTabs,
  readBoardTabs,
  reconcileBoardTabs,
  sameBoardTabs,
  selectBoardTab,
  serializeBoardTabs,
  type BoardTabsState,
} from './board-tabs-model';

export type BoardTab = { id: string; title: string; kind?: 'board' | 'home' | 'literature' | 'notePage' | 'video' | 'image' | 'summary' | 'note' | 'text' | 'database' };

export function useBoardTabs({ boards, activeId, ready, onSelect, onEmpty }: {
  boards: readonly BoardTab[];
  activeId: string | null;
  ready: boolean;
  onSelect: (id: string) => void;
  onEmpty: () => void;
}) {
  const [state, setState] = useState<BoardTabsState>(emptyBoardTabs);
  const [hydrated, setHydrated] = useState(false);
  const stateRef = useRef(state), initialized = useRef(false);
  const callbacks = useRef({ onSelect, onEmpty });
  const currentActive = useRef(activeId);
  const identities = JSON.stringify(boards.map(board => board.id));
  const availableIds = useMemo(() => JSON.parse(identities) as string[], [identities]);
  const availableRef = useRef(availableIds);
  useLayoutEffect(() => {
    callbacks.current = { onSelect, onEmpty };
    currentActive.current = activeId;
    availableRef.current = availableIds;
  }, [activeId, availableIds, onEmpty, onSelect]);

  const commit = useCallback((next: BoardTabsState) => {
    if (sameBoardTabs(stateRef.current, next)) return;
    stateRef.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    if (!ready) return;
    let previous = stateRef.current;
    if (!initialized.current) {
      let saved: string | null = null;
      try { saved = window.localStorage.getItem(boardTabsStorageKey); } catch { /* Tabs still work when storage is unavailable. */ }
      previous = readBoardTabs(saved, availableIds);
      initialized.current = true;
      setHydrated(true);
    }
    const next = reconcileBoardTabs(previous, availableIds);
    if (previous.activeId && !availableIds.includes(previous.activeId) && activeId !== null) {
      commit(next);
      if (next.activeId) callbacks.current.onSelect(next.activeId);
      else callbacks.current.onEmpty();
      return;
    }
    commit(activeId === null ? { ...next, activeId: null } : selectBoardTab(next, activeId, availableIds));
  }, [activeId, availableIds, commit, ready]);

  useEffect(() => {
    if (!hydrated || !ready) return;
    try { window.localStorage.setItem(boardTabsStorageKey, serializeBoardTabs(state)); } catch { /* Keep the current session usable without persistence. */ }
  }, [hydrated, ready, state]);

  const select = useCallback((id: string) => {
    if (!availableRef.current.includes(id)) return;
    commit(selectBoardTab(stateRef.current, id, availableRef.current));
    callbacks.current.onSelect(id);
  }, [commit]);

  const close = useCallback((id: string) => {
    const previous = { ...stateRef.current, activeId: currentActive.current };
    if (!previous.ids.includes(id)) return;
    const next = closeBoardTab(previous, id);
    commit(next);
    if (previous.activeId !== id) return;
    if (next.activeId) callbacks.current.onSelect(next.activeId);
    else callbacks.current.onEmpty();
  }, [commit]);

  return { tabs: state.ids, select, close, hydrated };
}
