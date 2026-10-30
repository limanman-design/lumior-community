export type HomeFileKind =
  | 'literature'
  | 'board'
  | 'notePage'
  | 'video'
  | 'image';

export const homeFileDragType = 'application/x-lumior-home-file';

type HomeFileTreeIdentity = { id: string; title: string; pinned?: boolean };
export type HomeFileTreeNode = HomeFileTreeIdentity &
  (
    | { kind: 'folder'; children: readonly HomeFileTreeNode[] }
    | { kind: HomeFileKind }
  );
export type HomeFileTreeEntry = {
  node: HomeFileTreeNode;
  parentId: string | null;
  depth: number;
  position: number;
  setSize: number;
};

/** A malformed duplicate/cycle must not make controlled navigation recurse forever. */
export function homeFileTreeEntries(
  nodes: readonly HomeFileTreeNode[],
  expandedIds?: readonly string[],
): HomeFileTreeEntry[] {
  const result: HomeFileTreeEntry[] = [],
    seen = new Set<string>();
  const expanded = expandedIds === undefined ? undefined : new Set(expandedIds);
  const visit = (
    siblings: readonly HomeFileTreeNode[],
    parentId: string | null,
    depth: number,
  ) => {
    siblings.forEach((node, index) => {
      if (seen.has(node.id)) return;
      seen.add(node.id);
      result.push({
        node,
        parentId,
        depth,
        position: index + 1,
        setSize: siblings.length,
      });
      if (node.kind === 'folder' && (!expanded || expanded.has(node.id)))
        visit(node.children, node.id, depth + 1);
    });
  };
  visit(nodes, null, 1);
  return result;
}

export function homeFileTreeAncestors(
  entries: readonly HomeFileTreeEntry[],
  id: string | null,
): string[] {
  const byId = new Map(entries.map((entry) => [entry.node.id, entry]));
  const ancestors: string[] = [],
    seen = new Set<string>();
  let parentId = id ? byId.get(id)?.parentId : null;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    ancestors.push(parentId);
    parentId = byId.get(parentId)?.parentId;
  }
  return ancestors;
}

/** Moving changes a parent only; folders cannot contain themselves or an ancestor. */
export function canMoveHomeFile(
  nodes: readonly HomeFileTreeNode[],
  id: string,
  folderId: string | null,
): boolean {
  const entries = homeFileTreeEntries(nodes);
  const source = entries.find((entry) => entry.node.id === id);
  if (!source || source.parentId === folderId || id === folderId) return false;
  if (folderId === null) return true;
  const destination = entries.find((entry) => entry.node.id === folderId);
  return (
    destination?.node.kind === 'folder' &&
    !homeFileTreeAncestors(entries, folderId).includes(id)
  );
}

/** External list entries require the caller's registry check. Known folders
 * always retain the intrinsic cycle guard, even when that callback approves. */
export function canMoveHomeFileTransfer(
  nodes: readonly HomeFileTreeNode[],
  id: string,
  folderId: string | null,
  canMove?: (id: string, folderId: string | null) => boolean,
): boolean {
  const entries = homeFileTreeEntries(nodes);
  if (
    folderId !== null &&
    !entries.some(
      (entry) => entry.node.id === folderId && entry.node.kind === 'folder',
    )
  )
    return false;
  if (entries.some((entry) => entry.node.id === id)) {
    if (!canMoveHomeFile(nodes, id, folderId)) return false;
  } else if (!canMove) return false;
  return !canMove || canMove(id, folderId);
}

export type HomeFileTreeKeyAction = {
  focusId?: string;
  toggle?: { id: string; expanded: boolean };
  selectId?: string;
  openId?: string;
};

/** Uses visible rows, so arrow keys never enter a collapsed subtree. */
export function homeFileTreeKeyAction(
  entries: readonly HomeFileTreeEntry[],
  id: string,
  key: string,
  expandedIds: readonly string[],
): HomeFileTreeKeyAction | null {
  const index = entries.findIndex((entry) => entry.node.id === id);
  if (index < 0) return null;
  const entry = entries[index],
    expanded = expandedIds.includes(id);
  if (key === 'ArrowDown')
    return {
      focusId: entries[Math.min(index + 1, entries.length - 1)].node.id,
    };
  if (key === 'ArrowUp')
    return { focusId: entries[Math.max(0, index - 1)].node.id };
  if (key === 'Home') return { focusId: entries[0].node.id };
  if (key === 'End') return { focusId: entries[entries.length - 1].node.id };
  if (key === 'ArrowRight') {
    if (entry.node.kind !== 'folder') return {};
    if (!expanded) return { toggle: { id, expanded: true } };
    return entries[index + 1]?.parentId === id
      ? { focusId: entries[index + 1].node.id }
      : {};
  }
  if (key === 'ArrowLeft') {
    if (entry.node.kind === 'folder' && expanded)
      return { toggle: { id, expanded: false } };
    return entry.parentId ? { focusId: entry.parentId } : {};
  }
  if (key === 'Enter')
    return entry.node.kind === 'folder'
      ? { selectId: id }
      : { selectId: id, openId: id };
  if (key === ' ') return { selectId: id };
  return null;
}
