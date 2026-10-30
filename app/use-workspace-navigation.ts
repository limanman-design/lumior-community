'use client';
import { useCallback, useReducer } from 'react';
import { initialNavigation, libraryModeFor, workspaceNavigation, type LibraryMode } from './workspace-navigation';

export function useWorkspaceNavigation() {
  const [state, dispatch] = useReducer(workspaceNavigation, initialNavigation);
  const navigate = useCallback((page: string) => dispatch({ type: 'navigate', page }), []);
  // Compatibility setters for existing canvas controls; all share the same page state.
  const setShowBoards = useCallback((visible: boolean) => dispatch({ type: 'page-visible', page: 'boards', visible }), []);
  const setLibraryMode = useCallback((mode: LibraryMode | ((previous: LibraryMode) => LibraryMode)) => dispatch({ type: 'library', mode }), []);
  return {
    navigate, activePage: state.page,
    atlasOpen: state.page === 'atlas',
    showBoards: state.page === 'boards', setShowBoards,
    libraryMode: libraryModeFor(state), setLibraryMode,
  };
}
