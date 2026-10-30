'use client';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  emptyWorkspaceHistory,
  moveWorkspaceHistory,
  recordWorkspaceHistory,
  sameWorkspaceHistory,
  type WorkspaceHistoryEntry,
  type WorkspaceHistoryState,
} from './workspace-history-model';

export function useWorkspaceHistory({ page, boardId, readerReturnBoardId, boardIds, ready, onNavigate }: {
  page: string;
  boardId: string | null;
  readerReturnBoardId?: string | null;
  boardIds: readonly string[];
  ready: boolean;
  onNavigate: (entry: WorkspaceHistoryEntry) => void;
}) {
  const [state, setState] = useState<WorkspaceHistoryState>(emptyWorkspaceHistory);
  const stateRef = useRef(state);
  const identities = JSON.stringify(boardIds);
  const availableIds = useMemo(() => JSON.parse(identities) as string[], [identities]);
  const latest = useRef({ availableIds, ready, onNavigate });
  useLayoutEffect(() => { latest.current = { availableIds, ready, onNavigate }; }, [availableIds, onNavigate, ready]);

  const commit = useCallback((next: WorkspaceHistoryState) => {
    if (sameWorkspaceHistory(stateRef.current, next)) return;
    stateRef.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    if (ready) commit(recordWorkspaceHistory(stateRef.current, {
      page, boardId,
      ...(page.startsWith('content:') && readerReturnBoardId ? { returnBoardId: readerReturnBoardId } : {}),
    }, availableIds));
  }, [availableIds, boardId, commit, page, readerReturnBoardId, ready]);

  const move = useCallback((direction: -1 | 1) => {
    const current = latest.current;
    if (!current.ready) return;
    const next = moveWorkspaceHistory(stateRef.current, direction, current.availableIds);
    // Move the cursor before replay: recording the resulting view becomes a no-op.
    commit(next.state);
    if (next.target) current.onNavigate(next.target);
  }, [commit]);
  const back = useCallback(() => move(-1), [move]);
  const forward = useCallback(() => move(1), [move]);

  return {
    back, forward,
    canGoBack: ready && state.index > 0,
    canGoForward: ready && state.index >= 0 && state.index < state.entries.length - 1,
  };
}
