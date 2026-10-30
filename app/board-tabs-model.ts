export type BoardTabsState = { ids: string[]; activeId: string | null };

export const boardTabsStorageKey = 'lumior-board-tabs-v1';
export const emptyBoardTabs: BoardTabsState = { ids: [], activeId: null };

function validIds(ids: readonly unknown[], availableIds: readonly string[]) {
  const available = new Set(availableIds);
  return [...new Set(ids.filter((id): id is string => typeof id === 'string' && available.has(id)))];
}

function adjacentId(ids: readonly string[], removedId: string, remaining: readonly string[]) {
  const position = ids.indexOf(removedId), available = new Set(remaining);
  return ids.slice(position + 1).find(id => available.has(id))
    ?? ids.slice(0, Math.max(0, position)).reverse().find(id => available.has(id))
    ?? null;
}

// Titles and board content stay in the workspace. Only open tab identities are saved.
export function readBoardTabs(raw: string | null, availableIds: readonly string[]): BoardTabsState {
  if (!raw || raw.length > 32_768) return { ids: [], activeId: null };
  try {
    const saved: unknown = JSON.parse(raw);
    if (!saved || typeof saved !== 'object' || !('version' in saved) || saved.version !== 1 || !('ids' in saved) || !Array.isArray(saved.ids)) return { ids: [], activeId: null };
    return { ids: validIds(saved.ids, availableIds), activeId: null };
  } catch {
    return { ids: [], activeId: null };
  }
}

export function serializeBoardTabs(state: BoardTabsState) {
  return JSON.stringify({ version: 1, ids: state.ids });
}

export function reconcileBoardTabs(state: BoardTabsState, availableIds: readonly string[]): BoardTabsState {
  const ids = validIds(state.ids, availableIds);
  const activeId = state.activeId && !ids.includes(state.activeId)
    ? adjacentId(state.ids, state.activeId, ids)
    : state.activeId;
  return { ids, activeId };
}

export function selectBoardTab(state: BoardTabsState, id: string, availableIds: readonly string[]): BoardTabsState {
  const current = reconcileBoardTabs(state, availableIds);
  if (!availableIds.includes(id)) return current;
  return { ids: current.ids.includes(id) ? current.ids : [...current.ids, id], activeId: id };
}

export function closeBoardTab(state: BoardTabsState, id: string): BoardTabsState {
  if (!state.ids.includes(id)) return state;
  const ids = state.ids.filter(value => value !== id);
  return { ids, activeId: state.activeId === id ? adjacentId(state.ids, id, ids) : state.activeId };
}

export function sameBoardTabs(left: BoardTabsState, right: BoardTabsState) {
  return left.activeId === right.activeId && left.ids.length === right.ids.length && left.ids.every((id, index) => id === right.ids[index]);
}
