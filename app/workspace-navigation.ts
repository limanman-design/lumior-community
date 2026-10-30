export type LibraryMode = 'sidebar' | 'page' | null;
export type WorkspaceNavigation = { page: string; librarySidebar: boolean };
export type NavigationAction =
  | { type: 'navigate'; page: string }
  | { type: 'page-visible'; page: string; visible: boolean }
  | { type: 'library'; mode: LibraryMode | ((previous: LibraryMode) => LibraryMode) };

export const initialNavigation: WorkspaceNavigation = { page: 'boards', librarySidebar: false };

export function libraryModeFor(state: WorkspaceNavigation): LibraryMode {
  return state.page === 'library' ? 'page' : state.librarySidebar ? 'sidebar' : null;
}

// One active full-page view. New destinations use navigate(page), so leaving
// 'atlas' removes its component regardless of the destination's name.
export function workspaceNavigation(state: WorkspaceNavigation, action: NavigationAction): WorkspaceNavigation {
  if (action.type === 'navigate') return { page: action.page === 'observatory' ? initialNavigation.page : action.page, librarySidebar: false };
  if (action.type === 'page-visible') {
    if (action.page === 'observatory') return state;
    if (action.visible) return { page: action.page, librarySidebar: false };
    return state.page === action.page ? { ...state, page: 'canvas' } : state;
  }
  const mode = typeof action.mode === 'function' ? action.mode(libraryModeFor(state)) : action.mode;
  if (mode === 'page') return { page: 'library', librarySidebar: false };
  if (mode === 'sidebar') return { page: 'canvas', librarySidebar: true };
  return { page: state.page === 'library' ? 'canvas' : state.page, librarySidebar: false };
}
