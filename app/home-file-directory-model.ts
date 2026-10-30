export type HomeDirectoryItem = {
  id: string;
  title: string;
  kind: 'literature' | 'board' | 'notePage' | 'video' | 'image';
  folderId?: string | null;
  authors?: readonly string[];
  year?: string | number;
  tags?: readonly string[];
  lastOpenedAt?: string | number;
  updatedAt?: string | number;
};
export type HomeDirectoryFolder = { id: string; title: string; parentId: string | null };
export type HomeDirectoryRow<Item extends HomeDirectoryItem = HomeDirectoryItem> =
  | { kind: 'folder'; id: string; folderId: string; title: string; depth: number; parentId: string | null; expanded: boolean; hasChildren: boolean; itemCount: number }
  | { kind: 'file'; id: string; item: Item; depth: number; parentId: string | null };
export type HomeFileSort = { key: 'title' | 'type' | 'lastOpenedAt' | 'updatedAt'; direction: 'asc' | 'desc' };
export function homeFileSortFromNavigation(sort?: string): HomeFileSort {
  const [key, direction] = sort?.split(':') || [];
  return {
    key: key === 'title' || key === 'type' || key === 'lastOpenedAt' ? key : 'updatedAt',
    direction: direction === 'asc' ? 'asc' : 'desc',
  };
}
const kinds = ['literature', 'board', 'notePage', 'video', 'image'];
const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();

export function directoryFolderIds(folders: readonly HomeDirectoryFolder[], folderId: string): Set<string> {
  const result = new Set<string>();
  const visit = (id: string) => {
    if (result.has(id)) return;
    result.add(id);
    for (const child of folders) if (child.parentId === id) visit(child.id);
  };
  if (folders.some(folder => folder.id === folderId)) visit(folderId);
  return result;
}

export function directoryBreadcrumbs(folders: readonly HomeDirectoryFolder[], folderId: string | null): HomeDirectoryFolder[] {
  const byId = new Map(folders.map(folder => [folder.id, folder]));
  const result: HomeDirectoryFolder[] = [], seen = new Set<string>();
  let id = folderId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const folder = byId.get(id);
    if (!folder) break;
    result.unshift(folder);
    id = folder.parentId;
  }
  return result;
}

/** Sibling sorting preserves structure; query results temporarily reveal ancestors. */
export function projectHomeDirectoryRows<Item extends HomeDirectoryItem>({
  items, folders, currentFolderId, expandedFolderIds, query, sort, locale,
}: {
  items: readonly Item[];
  folders: readonly HomeDirectoryFolder[];
  currentFolderId: string | null;
  expandedFolderIds: readonly string[];
  query: string;
  sort: HomeFileSort;
  locale?: string;
}): HomeDirectoryRow<Item>[] {
  const terms = normalize(query).split(' ').filter(Boolean);
  const matches = (text: string) => terms.every(term => normalize(text).includes(term));
  const files = [...new Map(items.filter(item => kinds.includes(item.kind)).map(item => [item.id, item])).values()];
  const expanded = new Set(expandedFolderIds);
  const direction = sort.direction === 'asc' ? 1 : -1;
  const titleCompare = (a: { title: string }, b: { title: string }) => a.title.localeCompare(b.title, locale, { numeric: true });
  const opened = (value?: string | number) => {
    const time = typeof value === 'number' ? value : value ? Date.parse(value) : NaN;
    return Number.isFinite(time) && Math.abs(time) <= 8.64e15 ? time : null;
  };
  const fileCompare = (a: Item, b: Item) => {
    let value = 0;
    if (sort.key === 'lastOpenedAt' || sort.key === 'updatedAt') {
      const left = opened(a[sort.key]), right = opened(b[sort.key]);
      if (left === null || right === null) return left === right ? titleCompare(a, b) : left === null ? 1 : -1;
      value = left - right;
    } else if (sort.key === 'type') value = kinds.indexOf(a.kind) - kinds.indexOf(b.kind);
    else value = titleCompare(a, b);
    return value * direction || titleCompare(a, b);
  };
  const children = (parentId: string | null) => folders.filter(folder => folder.parentId === parentId)
    .sort((a, b) => titleCompare(a, b) * (sort.key === 'title' ? direction : 1));
  const itemText = (item: Item) => [item.title, ...(item.kind === 'literature' ? [...(item.authors || []), String(item.year ?? '')] : []), ...(item.tags || [])].join(' ');
  const count = (id: string) => {
    const descendants = directoryFolderIds(folders, id);
    return files.filter(item => descendants.has(item.folderId || '')).length;
  };
  const walk = (parentId: string | null, depth: number, ancestors: Set<string>, parentMatches = false): HomeDirectoryRow<Item>[] => {
    const rows: HomeDirectoryRow<Item>[] = [];
    for (const folder of children(parentId)) {
      if (ancestors.has(folder.id)) continue;
      const nextAncestors = new Set(ancestors).add(folder.id);
      const folderMatches = terms.length > 0 && (parentMatches || matches(folder.title));
      const nested = walk(folder.id, depth + 1, nextAncestors, folderMatches);
      if (terms.length && !folderMatches && !nested.length) continue;
      const hasChildren = children(folder.id).some(child => !nextAncestors.has(child.id)) || files.some(item => item.folderId === folder.id);
      const isExpanded = terms.length ? nested.length > 0 : expanded.has(folder.id);
      rows.push({ kind: 'folder', id: `folder:${folder.id}`, folderId: folder.id, title: folder.title, depth, parentId, expanded: isExpanded, hasChildren, itemCount: count(folder.id) });
      if (isExpanded) rows.push(...nested);
    }
    for (const item of files.filter(item => (item.folderId ?? null) === parentId && (!terms.length || parentMatches || matches(itemText(item)))).sort(fileCompare))
      rows.push({ kind: 'file', id: item.id, item, depth, parentId });
    return rows;
  };
  return walk(currentFolderId, 0, new Set(currentFolderId ? [currentFolderId] : []));
}
