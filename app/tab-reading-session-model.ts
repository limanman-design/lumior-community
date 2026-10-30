/** Ephemeral reader UI state. Document content and background jobs stay elsewhere. */
export function tabReadingSessionKey(boardId: string, cardId: string, slot: string, sourceKey = '') {
  return JSON.stringify([boardId, cardId, slot, sourceKey]);
}

export function createTabReadingSessionStore() {
  const entries = new Map<string, { boardId: string; value: unknown }>();
  let validBoards: Set<string> | undefined;
  return {
    get<T>(key: string): T | undefined { return entries.get(key)?.value as T | undefined; },
    save<T>(boardId: string, key: string, value: T) {
      if (!validBoards || validBoards.has(boardId)) entries.set(key, { boardId, value });
    },
    prune(boardIds?: readonly string[]) {
      validBoards = boardIds ? new Set(boardIds) : undefined;
      if (validBoards) for (const [key, entry] of entries) if (!validBoards.has(entry.boardId)) entries.delete(key);
    },
  };
}

export type TabScrollPosition = { scrollTop: number; scrollLeft: number };
export function finiteScrollPosition(position: Partial<TabScrollPosition>): TabScrollPosition {
  const safe = (value: number | undefined) => Number.isFinite(value) ? Math.max(0, value!) : 0;
  return { scrollTop: safe(position.scrollTop), scrollLeft: safe(position.scrollLeft) };
}
