export type WorkspaceHistoryEntry = {
  page: string;
  boardId: string | null;
  /** A canvas reader belongs to its source board, never to a new content tab. */
  returnBoardId?: string;
};
export type WorkspaceHistoryState = { entries: WorkspaceHistoryEntry[]; index: number };

export const emptyWorkspaceHistory: WorkspaceHistoryState = { entries: [], index: -1 };
export const workspaceHistoryLimit = 100;

export function sameWorkspaceLocation(left: WorkspaceHistoryEntry, right: WorkspaceHistoryEntry) {
  return left.page === right.page && left.boardId === right.boardId
    && left.returnBoardId === right.returnBoardId;
}

function normalize(entry: WorkspaceHistoryEntry, availableIds: readonly string[]): WorkspaceHistoryEntry | null {
  if ((entry.page.startsWith('database:') || entry.page.startsWith('content:')) && !availableIds.includes(entry.page)) return null;
  if (entry.page.startsWith('content:') && entry.returnBoardId !== undefined) {
    if (!availableIds.includes(entry.returnBoardId)) return null;
    return { page: entry.page, boardId: null, returnBoardId: entry.returnBoardId };
  }
  if (entry.page !== 'canvas') return { page: entry.page, boardId: null };
  return entry.boardId && availableIds.includes(entry.boardId) ? { page: entry.page, boardId: entry.boardId } : null;
}

export function sameWorkspaceHistory(left: WorkspaceHistoryState, right: WorkspaceHistoryState) {
  return left.index === right.index && left.entries.length === right.entries.length
    && left.entries.every((entry, index) => sameWorkspaceLocation(entry, right.entries[index]));
}

/** Deleted boards, contents and databases cannot remain history targets. */
export function reconcileWorkspaceHistory(state: WorkspaceHistoryState, availableIds: readonly string[]): WorkspaceHistoryState {
  const entries: WorkspaceHistoryEntry[] = [];
  let index = -1;
  state.entries.forEach((entry, position) => {
    const location = normalize(entry, availableIds);
    if (!location) return;
    const previous = entries.at(-1);
    if (!previous || !sameWorkspaceLocation(previous, location)) entries.push(location);
    if (position <= state.index) index = entries.length - 1;
  });
  if (index < 0 && entries.length) index = 0;
  const next = { entries, index };
  return sameWorkspaceHistory(state, next) ? state : next;
}

export function recordWorkspaceHistory(state: WorkspaceHistoryState, entry: WorkspaceHistoryEntry, availableIds: readonly string[]): WorkspaceHistoryState {
  const current = reconcileWorkspaceHistory(state, availableIds);
  const location = normalize(entry, availableIds);
  if (!location || (current.entries[current.index] && sameWorkspaceLocation(current.entries[current.index], location))) return current;
  const entries = [...current.entries.slice(0, current.index + 1), location].slice(-workspaceHistoryLimit);
  return { entries, index: entries.length - 1 };
}

export function moveWorkspaceHistory(state: WorkspaceHistoryState, direction: -1 | 1, availableIds: readonly string[]) {
  const current = reconcileWorkspaceHistory(state, availableIds);
  const index = current.index + direction;
  if (index < 0 || index >= current.entries.length) return { state: current, target: null };
  return { state: { ...current, index }, target: current.entries[index] };
}
