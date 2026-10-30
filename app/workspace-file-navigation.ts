export type WorkspaceFileScopeState = {
  selectedEntryId?: string;
  /** Folder-row selection is distinct from the directory being browsed. */
  selectedFolderRowId?: string;
  expandedFolderIds: string[];
  search?: string;
  /** Legacy values remain readable; the current UI always shows all five types. */
  typeFilter?: string;
  sort?: string;
  scrollTop?: number;
  previewOpen?: boolean;
};
export type WorkspaceFileScopeNavigation = WorkspaceFileScopeState & { folderId: string | null };
export type WorkspaceFilesNavigation = WorkspaceFileScopeState & {
  selectedFolderId?: string | null;
  /** Additive history; the top-level fields remain the active-scope snapshot. */
  scopes?: WorkspaceFileScopeNavigation[];
};

const defaultState = (): WorkspaceFileScopeState => ({ expandedFolderIds: [], previewOpen: false });
const snapshot = (state: WorkspaceFileScopeState): WorkspaceFileScopeState => ({
  selectedEntryId: state.selectedEntryId,
  selectedFolderRowId: state.selectedFolderRowId,
  expandedFolderIds: [...state.expandedFolderIds],
  search: state.search,
  typeFilter: state.typeFilter,
  sort: state.sort,
  scrollTop: state.scrollTop,
  previewOpen: state.previewOpen,
});
const replaceScope = (scopes: readonly WorkspaceFileScopeNavigation[], folderId: string | null, state: WorkspaceFileScopeState) => [
  ...scopes.filter(scope => scope.folderId !== folderId),
  { folderId, ...snapshot(state) },
];
function capturedScopes(navigation: WorkspaceFilesNavigation): WorkspaceFileScopeNavigation[] {
  return replaceScope(navigation.scopes || [], navigation.selectedFolderId ?? null, navigation);
}

export function patchWorkspaceFileNavigation(
  navigation: WorkspaceFilesNavigation | undefined,
  patch: Partial<WorkspaceFileScopeState>,
): WorkspaceFilesNavigation {
  const current = navigation || { ...defaultState(), selectedFolderId: null };
  const next = { ...snapshot(current), ...patch };
  return { ...current, ...next, scopes: replaceScope(capturedScopes(current), current.selectedFolderId ?? null, next) };
}

/** Leaving a scope saves its exact reading/list state; entering restores its own. */
export function navigateWorkspaceFileScope(navigation: WorkspaceFilesNavigation | undefined, folderId: string | null): WorkspaceFilesNavigation {
  const current = navigation || { ...defaultState(), selectedFolderId: null };
  if ((current.selectedFolderId ?? null) === folderId) return current;
  const scopes = capturedScopes(current);
  const destination = scopes.find(scope => scope.folderId === folderId) || defaultState();
  return { ...current, ...snapshot(destination), selectedFolderId: folderId, scopes: replaceScope(scopes, folderId, destination) };
}

/** Remove navigation references only after a real deletion/reconciliation. */
export function pruneWorkspaceFileNavigation(
  navigation: WorkspaceFilesNavigation,
  folderIds: ReadonlySet<string>,
  entryIds: ReadonlySet<string>,
  folderParents?: ReadonlyMap<string, string | null>,
  entryFolders?: ReadonlyMap<string, string | null>,
): WorkspaceFilesNavigation {
  const contains = (folderId: string | null, scopeId: string | null) => {
    if (scopeId === null) return true;
    const seen = new Set<string>();
    let id = folderId;
    while (id && !seen.has(id)) {
      if (id === scopeId) return true;
      seen.add(id);
      id = folderParents?.get(id) ?? null;
    }
    return false;
  };
  const clean = (state: WorkspaceFileScopeState, scopeId: string | null): WorkspaceFileScopeState => {
    const selectedEntryId = state.selectedEntryId && entryIds.has(state.selectedEntryId)
      && (!entryFolders || contains(entryFolders.get(state.selectedEntryId) ?? null, scopeId)) ? state.selectedEntryId : undefined;
    const selectedFolderRowId = state.selectedFolderRowId && folderIds.has(state.selectedFolderRowId)
      && (!folderParents || scopeId !== null && state.selectedFolderRowId !== scopeId && contains(state.selectedFolderRowId, scopeId)) ? state.selectedFolderRowId : undefined;
    return {
      ...snapshot(state), selectedEntryId, selectedFolderRowId,
      expandedFolderIds: [...new Set(state.expandedFolderIds.filter(id => folderIds.has(id)))],
      ...(state.selectedEntryId && !selectedEntryId && !selectedFolderRowId || state.selectedFolderRowId && !selectedFolderRowId && !selectedEntryId ? { previewOpen: false } : {}),
    };
  };
  const activeExists = navigation.selectedFolderId == null || folderIds.has(navigation.selectedFolderId);
  const scopes = capturedScopes(navigation)
    .filter(scope => scope.folderId === null || folderIds.has(scope.folderId))
    .map(scope => ({ folderId: scope.folderId, ...clean(scope, scope.folderId) }));
  const active = activeExists ? clean(navigation, navigation.selectedFolderId ?? null) : clean(scopes.find(scope => scope.folderId === null) || defaultState(), null);
  const selectedFolderId = activeExists ? navigation.selectedFolderId ?? null : null;
  const result: WorkspaceFilesNavigation = { ...navigation, ...active, selectedFolderId };
  // Old records need not grow history until the user actually navigates/edits it.
  if (navigation.scopes) result.scopes = replaceScope(scopes, selectedFolderId, active);
  return result;
}

export function validWorkspaceFileNavigation(value: unknown, folderIds: ReadonlySet<string>, entryIds: ReadonlySet<string>): value is WorkspaceFilesNavigation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const navigation = value as WorkspaceFilesNavigation;
  const validState = (state: WorkspaceFileScopeState) => !!state && typeof state === 'object'
    && Array.isArray(state.expandedFolderIds) && state.expandedFolderIds.every(id => typeof id === 'string' && folderIds.has(id))
    && (state.selectedEntryId === undefined || typeof state.selectedEntryId === 'string' && entryIds.has(state.selectedEntryId))
    && (state.selectedFolderRowId === undefined || typeof state.selectedFolderRowId === 'string' && folderIds.has(state.selectedFolderRowId))
    && (state.scrollTop === undefined || typeof state.scrollTop === 'number' && Number.isFinite(state.scrollTop) && state.scrollTop >= 0)
    && (state.previewOpen === undefined || typeof state.previewOpen === 'boolean')
    && ['search', 'typeFilter', 'sort'].every(key => state[key as 'search'] === undefined || typeof state[key as 'search'] === 'string');
  if (!validState(navigation) || navigation.selectedFolderId != null && !folderIds.has(navigation.selectedFolderId)) return false;
  if (navigation.scopes === undefined) return true;
  if (!Array.isArray(navigation.scopes) || navigation.scopes.length > folderIds.size + 1) return false;
  const seen = new Set<string | null>();
  return navigation.scopes.every(scope => {
    if (!scope || (scope.folderId !== null && !folderIds.has(scope.folderId)) || seen.has(scope.folderId) || !validState(scope)) return false;
    seen.add(scope.folderId);
    return true;
  });
}

/** Backup merge remaps folder-row, active-scope, expansion and file identities. */
export function remapWorkspaceFileNavigation(navigation: WorkspaceFilesNavigation, folders: ReadonlyMap<string, string>, entries: ReadonlyMap<string, string>): WorkspaceFilesNavigation {
  const remap = (state: WorkspaceFileScopeState): WorkspaceFileScopeState => ({
    ...snapshot(state),
    selectedEntryId: state.selectedEntryId ? entries.get(state.selectedEntryId) : undefined,
    selectedFolderRowId: state.selectedFolderRowId ? folders.get(state.selectedFolderRowId) : undefined,
    expandedFolderIds: state.expandedFolderIds.flatMap(id => folders.has(id) ? [folders.get(id)!] : []),
  });
  return {
    ...remap(navigation), selectedFolderId: navigation.selectedFolderId ? folders.get(navigation.selectedFolderId) ?? null : null,
    ...(navigation.scopes ? { scopes: navigation.scopes.map(scope => ({ folderId: scope.folderId === null ? null : folders.get(scope.folderId)!, ...remap(scope) })) } : {}),
  };
}

export function mergeWorkspaceFileNavigation(current: WorkspaceFilesNavigation | undefined, incoming: WorkspaceFilesNavigation): WorkspaceFilesNavigation {
  const base = current || { ...defaultState(), selectedFolderId: null };
  const active = snapshot(base);
  // Keep the current workspace's Home state when restored Home state collides.
  const scopes = capturedScopes(base);
  for (const scope of capturedScopes(incoming)) if (!scopes.some(existing => existing.folderId === scope.folderId)) scopes.push(scope);
  // Keep the legacy merge's expansion union without changing current scope.
  active.expandedFolderIds = [...new Set([...active.expandedFolderIds, ...incoming.expandedFolderIds])];
  return { ...base, ...active, scopes: replaceScope(scopes, base.selectedFolderId ?? null, active) };
}
