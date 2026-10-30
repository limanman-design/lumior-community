import type { Board, Card, View } from './canvas-model';

export type BoardTabViewState = {
  view: View;
  readId: string | null;
  externalPdf: Card | null;
  sizes: Record<string, number>;
  aiMode: 'closed' | 'floating' | 'sidebar';
  informationOpen: boolean;
  pinnedId: string | null;
};

function copy(state: BoardTabViewState): BoardTabViewState {
  return { ...state, view: { ...state.view }, sizes: { ...state.sizes } };
}

/** Disposable UI state: a tab switch must not change the saved board document. */
export function createBoardTabViewState() {
  const states = new Map<string, BoardTabViewState>();
  return {
    remember(boardId: string, state: BoardTabViewState) {
      states.set(boardId, copy(state));
    },
    restore(board: Pick<Board, 'id' | 'cards'>, externalIds: readonly string[] = []) {
      const stored = states.get(board.id);
      if (!stored) return undefined;
      const next = copy(stored);
      const ids = new Set([...board.cards.map(card => card.id), ...externalIds]);
      if (next.externalPdf) ids.add(next.externalPdf.id);
      if (!next.readId || !ids.has(next.readId)) next.readId = null;
      if (next.pinnedId && !ids.has(next.pinnedId)) next.pinnedId = null;
      next.sizes = Object.fromEntries(Object.entries(next.sizes).filter(([id]) => board.cards.some(card => card.id === id)));
      return next;
    },
    forget(boardId: string) { states.delete(boardId); },
    prune(boardIds: readonly string[]) {
      const keep = new Set(boardIds);
      for (const id of states.keys()) if (!keep.has(id)) states.delete(id);
    },
    clear() { states.clear(); },
  };
}
