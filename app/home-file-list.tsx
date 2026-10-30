'use client';
/* oxlint-disable next/no-img-element -- Only the selected item's supplied thumbnail is loaded. */
/* oxlint-disable jsx-a11y/no-noninteractive-element-to-interactive-role -- The table is an ARIA grid with selectable keyboard rows. */
import {
  Fragment,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  type ReactElement,
} from 'react';
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Home,
  ImageIcon,
  Layers,
  PanelRight,
  Plus,
  Upload,
  Video,
} from 'lucide-react';
import { useI18n } from './i18n';
import { MaterialIcon } from './material-icon';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { homeFileDragType } from './home-file-tree-model';
import { isHomeFileDrop, readHomeFileDrop } from './home-file-drop';
import {
  directoryBreadcrumbs,
  type HomeFileSort,
  type HomeDirectoryFolder,
  type HomeDirectoryRow,
} from './home-file-directory-model';
import './content-type-colors.css';
import './home-file-list.css';

export type HomeFileKind =
  | 'literature'
  | 'board'
  | 'notePage'
  | 'video'
  | 'image';
export type HomeFileTypeFilter = 'all' | HomeFileKind;
export type { HomeFileSort } from './home-file-directory-model';

/** A display projection. The parent owns content identity, storage and references. */
export type HomeFileListItem = {
  id: string;
  title: string;
  kind: HomeFileKind;
  authors?: readonly string[];
  year?: string | number;
  tags?: readonly string[];
  lastOpenedAt?: string | number;
  updatedAt?: string | number;
  location?: string;
  folderId?: string | null;
  thumbnailUrl?: string;
  excerpt?: string;
  details?: readonly { label: string; value: string }[];
};

export type HomeFileListProps = {
  items: readonly HomeFileListItem[];
  scopeTitle?: string;
  query: string;
  onQueryChange: (query: string) => void;
  typeFilter: HomeFileTypeFilter;
  onTypeFilterChange: (filter: HomeFileTypeFilter) => void;
  sort: HomeFileSort;
  onSortChange: (sort: HomeFileSort) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpen: (item: HomeFileListItem) => void;
  previewOpen: boolean;
  onPreviewOpenChange: (open: boolean) => void;
  /** The parent can retain an offset per folder/filter and restore it on return. */
  scopeKey?: string;
  scrollOffset?: number;
  onScrollOffsetChange?: (offset: number) => void;
  onNew?: () => void;
  onImport?: () => void;
  onDropFiles?: (files: File[], folderId: string | null) => void;
  onFileDropError?: (message: string) => void;
  draggable?: boolean;
  renderRowMenu?: (row: HomeDirectoryRow<HomeFileListItem>, trigger: ReactElement) => ReactNode;
  renderEmptySpaceMenu?: (trigger: ReactElement) => ReactNode;
  renderItemActions?: (item: HomeFileListItem) => ReactNode;
  /** Related content appears only in this selected-item panel, never in the list. */
  renderRelatedContent?: (item: HomeFileListItem) => ReactNode;
  /** A caller-owned, already searched/sorted projection of the current directory. */
  directoryRows?: readonly HomeDirectoryRow<HomeFileListItem>[];
  /** Actual archive folders, independent of the current browsing scope. */
  folders?: readonly HomeDirectoryFolder[];
  directoryScopeId?: string | null;
  breadcrumbs?: readonly { id: string | null; title: string }[];
  onNavigateFolder?: (folderId: string | null) => void;
  onToggleFolder?: (folderId: string, expanded: boolean) => void;
  selectedFolderRowId?: string | null;
  onSelectFolder?: (folderId: string) => void;
  onNewFolder?: () => void;
  renderFolderActions?: (
    folder: Extract<HomeDirectoryRow<HomeFileListItem>, { kind: 'folder' }>,
  ) => ReactNode;
  onMove?: (id: string, folderId: string | null) => void;
  canMove?: (id: string, folderId: string | null) => boolean;
};

type DirectoryKeyAction = {
  focusId?: string;
  toggle?: { folderId: string; expanded: boolean };
  open?: boolean;
  select?: boolean;
  parentScope?: boolean;
};

/** Visible-row keyboard navigation also works when search temporarily opens ancestors. */
export function homeFileListKeyAction(
  rows: readonly HomeDirectoryRow<HomeFileListItem>[],
  id: string,
  key: string,
): DirectoryKeyAction | null {
  const index = rows.findIndex((row) => row.id === id);
  if (index < 0) return null;
  const row = rows[index];
  if (key === 'ArrowDown')
    return { focusId: rows[Math.min(rows.length - 1, index + 1)].id };
  if (key === 'ArrowUp') return { focusId: rows[Math.max(0, index - 1)].id };
  if (key === 'Home') return { focusId: rows[0].id };
  if (key === 'End') return { focusId: rows[rows.length - 1].id };
  if (key === 'Enter') return { open: true };
  if (key === ' ') return { select: true };
  if (key === 'ArrowRight') {
    if (row.kind !== 'folder' || !row.hasChildren) return {};
    if (!row.expanded)
      return { toggle: { folderId: row.folderId, expanded: true } };
    const child = rows[index + 1];
    return child?.parentId === row.folderId ? { focusId: child.id } : {};
  }
  if (key === 'ArrowLeft') {
    if (row.kind === 'folder' && row.expanded)
      return { toggle: { folderId: row.folderId, expanded: false } };
    const parent = rows.find(
      (entry) => entry.kind === 'folder' && entry.folderId === row.parentId,
    );
    return parent ? { focusId: parent.id } : { parentScope: true };
  }
  return null;
}

const fileKinds: readonly HomeFileKind[] = [
  'literature',
  'board',
  'notePage',
  'video',
  'image',
];
const kindIcons = {
  literature: BookOpen,
  board: Layers,
  notePage: FileText,
  video: Video,
  image: ImageIcon,
};
const normalizeSearch = (value: string) =>
  value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
const fileTime = (item: HomeFileListItem, key: 'lastOpenedAt' | 'updatedAt') => {
  const value =
    typeof item[key] === 'number'
      ? item[key]
      : item[key]
        ? Date.parse(item[key])
        : NaN;
  return Number.isFinite(value) && Math.abs(value) <= 8.64e15 ? value : null;
};
const thumbnailSource = (value?: string) => {
  const source = value?.trim();
  return source &&
    (/^(https?:|blob:)/i.test(source) ||
      /^\/(?!\/)/.test(source) ||
      /^data:image\/(png|jpe?g|webp|gif|avif);base64,/i.test(source))
    ? source
    : undefined;
};

function SortIndicator({
  column,
  sort,
}: {
  column: HomeFileSort['key'];
  sort: HomeFileSort;
}) {
  if (sort.key !== column) return null;
  return sort.direction === 'asc' ? (
    <ArrowUp size={12} aria-hidden="true" />
  ) : (
    <ArrowDown size={12} aria-hidden="true" />
  );
}

export function HomeFileList({
  items,
  scopeTitle,
  query,
  onQueryChange,
  sort,
  onSortChange,
  selectedId,
  onSelect,
  onOpen,
  previewOpen,
  onPreviewOpenChange,
  scopeKey,
  scrollOffset,
  onScrollOffsetChange,
  onNew,
  onImport,
  onDropFiles,
  onFileDropError,
  draggable = false,
  renderRowMenu,
  renderEmptySpaceMenu,
  renderItemActions,
  renderRelatedContent,
  directoryRows,
  folders = [],
  directoryScopeId,
  breadcrumbs,
  onNavigateFolder,
  onToggleFolder,
  selectedFolderRowId,
  onSelectFolder,
  onNewFolder,
  renderFolderActions,
  onMove,
  canMove,
}: HomeFileListProps) {
  const { t, locale } = useI18n();
  const title = scopeTitle || t('Home', '首页');
  const sortOptions: { key: HomeFileSort['key']; direction: HomeFileSort['direction']; label: string }[] = [
    { key: 'updatedAt', direction: 'desc', label: t('Last modified', '最近修改') },
    { key: 'updatedAt', direction: 'asc', label: t('Oldest modified', '最早修改') },
    { key: 'lastOpenedAt', direction: 'desc', label: t('Last opened', '最近打开') },
    { key: 'lastOpenedAt', direction: 'asc', label: t('Oldest opened', '最早打开') },
    { key: 'title', direction: 'asc', label: t('Name · A–Z', '名称 · 升序') },
    { key: 'title', direction: 'desc', label: t('Name · Z–A', '名称 · 降序') },
    { key: 'type', direction: 'asc', label: t('Type · ascending', '类型 · 升序') },
    { key: 'type', direction: 'desc', label: t('Type · descending', '类型 · 降序') },
  ];
  const currentSortLabel = sortOptions.find(option => option.key === sort.key && option.direction === sort.direction)?.label;
  const sortLabel = t('Sort files: {sort}', '文件排序：{sort}', { sort: currentSortLabel || '' });
  const kindNames: Record<HomeFileKind, string> = {
    literature: t('Literature', '文献'),
    board: t('Whiteboard', '画板'),
    notePage: 'NotePage',
    video: t('Video', '视频'),
    image: t('Image', '图片'),
  };
  const scrollRef = useRef<HTMLElement>(null);
  const searchId = useId();
  const searchInput = useRef<HTMLInputElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchExpanded = searchOpen || Boolean(query);
  useEffect(() => {
    if (searchOpen) searchInput.current?.focus();
  }, [searchOpen]);
  const closeSearch = () => {
    onQueryChange('');
    setSearchOpen(false);
    searchButton.current?.focus();
  };
  const locationRef = useRef<HTMLElement>(null);
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null | undefined>();
  const [fileDropTarget, setFileDropTarget] = useState<{ id: string | null; title: string } | null>(null);
  const fileDragDepth = useRef(0);
  useEffect(() => {
    const clear = () => { fileDragDepth.current = 0; setFileDropTarget(null); };
    const cancel = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') clear(); };
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear);
    window.addEventListener('blur', clear);
    window.addEventListener('keydown', cancel);
    return () => {
      window.removeEventListener('dragend', clear);
      window.removeEventListener('drop', clear);
      window.removeEventListener('blur', clear);
      window.removeEventListener('keydown', cancel);
    };
  }, []);
  const hasRowFocus = useRef(false);
  const pendingDirectoryFocus = useRef(false);
  const draggingId = useRef<string | null>(null);
  // Ignore unrecognised kinds even if a caller supplies untyped legacy data.
  // In particular, summaries cannot enter either this list or its counts.
  const knownItems = useMemo(
    () => [
      ...new Map(
        items
          .filter((item) => fileKinds.includes(item.kind))
          .map((item) => [item.id, item]),
      ).values(),
    ],
    [items],
  );
  const visibleItems = useMemo(() => {
    const terms = normalizeSearch(query).split(' ').filter(Boolean);
    const filtered = knownItems.filter((item) => {
      const searchable = normalizeSearch(
        [
          item.title,
          ...(item.kind === 'literature'
            ? [
                ...(item.authors || []),
                item.year === undefined ? '' : String(item.year),
              ]
            : []),
          ...(item.tags || []),
        ].join(' '),
      );
      return terms.every((term) => searchable.includes(term));
    });
    const direction = sort.direction === 'asc' ? 1 : -1;
    return filtered.sort((a, b) => {
      let comparison = 0;
      if (sort.key === 'lastOpenedAt' || sort.key === 'updatedAt') {
        const aTime = fileTime(a, sort.key),
          bTime = fileTime(b, sort.key);
        // Unknown dates remain after recorded dates in both directions.
        if (aTime === null || bTime === null)
          return aTime === bTime
            ? a.title.localeCompare(b.title, locale)
            : aTime === null
              ? 1
              : -1;
        comparison = aTime - bTime;
      } else if (sort.key === 'type')
        comparison = fileKinds.indexOf(a.kind) - fileKinds.indexOf(b.kind);
      else
        comparison = a.title.localeCompare(b.title, locale, { numeric: true });
      return (
        comparison * direction ||
        a.title.localeCompare(b.title, locale, { numeric: true })
      );
    });
  }, [knownItems, query, sort.key, sort.direction, locale]);
  const rows = useMemo(() => {
    if (!directoryRows)
      return visibleItems.map((item) => ({
        kind: 'file' as const,
        id: item.id,
        item,
        depth: 0,
        parentId: null,
      }));
    const seen = new Set<string>();
    return directoryRows.filter((row) => {
      if (
        seen.has(row.id) ||
        (row.kind === 'file' && !fileKinds.includes(row.item.kind))
      )
        return false;
      seen.add(row.id);
      return true;
    });
  }, [directoryRows, visibleItems]);
  const selectedFolder = rows.find(
    (row) => row.kind === 'folder' && row.folderId === selectedFolderRowId,
  );
  const selectedDirectoryRow = directoryRows
    ? rows.find((row) => row.kind === 'file' && row.id === selectedId)
    : undefined;
  const selected = selectedFolder
    ? undefined
    : directoryRows
      ? selectedDirectoryRow?.kind === 'file'
        ? selectedDirectoryRow.item
        : undefined
      : visibleItems.find((item) => item.id === selectedId);
  const selectedRowId =
    selectedFolder?.id ||
    (rows.some((row) => row.id === selected?.id) ? selected?.id : undefined);
  const tabStopId = rows.some((row) => row.id === focusedId)
    ? focusedId
    : selectedRowId || rows[0]?.id;
  const folderCount = rows.filter((row) => row.kind === 'folder').length;
  const fileCount = rows.length - folderCount;
  const thumbnail = thumbnailSource(selected?.thumbnailUrl);
  const relatedContent = selected ? renderRelatedContent?.(selected) : null;
  const locationFolderId =
    selectedFolder?.kind === 'folder'
      ? selectedFolder.folderId
      : selected
        ? (selected.folderId ?? null)
        : (directoryScopeId ?? null);
  const locationFolders = directoryBreadcrumbs(folders, locationFolderId);
  const scopeLocation =
    !selected && !selectedFolder && breadcrumbs?.length
      ? breadcrumbs
      : undefined;
  const locationKnown =
    !!scopeLocation ||
    locationFolderId === null ||
    (locationFolders.length > 0 &&
      locationFolders[0].parentId === null &&
      locationFolders[locationFolders.length - 1].id === locationFolderId);
  const locationCrumbs = scopeLocation || [
    { id: null, title: t('Home', '首页') },
    ...locationFolders.map((folder) => ({
      id: folder.id,
      title: folder.title,
    })),
  ];
  const locationTitle = [
    ...(locationKnown
      ? locationCrumbs.map((crumb) => crumb.title)
      : [t('Location unavailable', '位置不可用')]),
    ...(selected ? [selected.title || t('Untitled', '未命名')] : []),
  ].join(' › ');
  const LocationFileIcon = selected ? kindIcons[selected.kind] : null;
  useLayoutEffect(() => {
    // Keep the selected filename reachable without scrolling the file list.
    const node = locationRef.current;
    if (node) node.scrollLeft = node.scrollWidth;
  }, [locationTitle]);
  const dateKey = sort.key === 'updatedAt' ? 'updatedAt' : 'lastOpenedAt';
  const dateLabel = dateKey === 'updatedAt' ? t('Last modified', '最近修改') : t('Last opened', '最近打开');
  const dateDescription = dateKey === 'updatedAt'
    ? t('Created, imported or modified in Lumior', '在 Lumior 中新建、导入或修改的时间')
    : t('Recently opened, including newly created and imported files', '最近打开，含新建和导入的文件');
  const formatDate = (item: HomeFileListItem) => {
    const time = fileTime(item, dateKey);
    return time === null
      ? '—'
      : new Intl.DateTimeFormat(locale, {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }).format(time);
  };
  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (
      node &&
      scrollOffset !== undefined &&
      Number.isFinite(scrollOffset) &&
      Math.abs(node.scrollTop - scrollOffset) > 1
    )
      node.scrollTop = Math.max(0, scrollOffset);
  }, [scopeKey, scrollOffset]);

  useLayoutEffect(() => {
    // A collapsed subtree or opened directory can remove the focused row.
    // Restore a visible roving tab stop without disturbing the saved offset.
    if ((hasRowFocus.current || pendingDirectoryFocus.current) && tabStopId)
      rowRefs.current.get(tabStopId)?.focus({ preventScroll: true });
    else if (pendingDirectoryFocus.current && !rows.length)
      scrollRef.current?.focus({ preventScroll: true });
    pendingDirectoryFocus.current = false;
  }, [scopeKey, tabStopId, rows.length]);

  const chooseSort = (key: HomeFileSort['key']) =>
    onSortChange({
      key,
      direction:
        sort.key === key
          ? sort.direction === 'asc'
            ? 'desc'
            : 'asc'
          : key === 'lastOpenedAt' || key === 'updatedAt'
            ? 'desc'
            : 'asc',
    });
  const selectRow = (row: HomeDirectoryRow<HomeFileListItem>) => {
    if (row.kind === 'folder') onSelectFolder?.(row.folderId);
    else onSelect(row.item.id);
  };
  const focusRow = (id: string) => {
    const row = rows.find((entry) => entry.id === id);
    if (!row) return;
    setFocusedId(id);
    selectRow(row);
    const element = rowRefs.current.get(id);
    element?.focus({ preventScroll: true });
    element?.scrollIntoView({ block: 'nearest' });
  };
  const openRow = (row: HomeDirectoryRow<HomeFileListItem>) => {
    if (row.kind === 'folder') {
      pendingDirectoryFocus.current = hasRowFocus.current;
      onNavigateFolder?.(row.folderId);
    } else onOpen(row.item);
  };
  const rowKeyDown = (
    event: KeyboardEvent<HTMLTableRowElement>,
    row: HomeDirectoryRow<HomeFileListItem>,
  ) => {
    if (
      event.target !== event.currentTarget ||
      event.nativeEvent.isComposing ||
      event.altKey ||
      event.metaKey ||
      event.ctrlKey
    )
      return;
    const action = homeFileListKeyAction(rows, row.id, event.key);
    if (!action) return;
    event.preventDefault();
    if (action.focusId) focusRow(action.focusId);
    if (action.toggle)
      onToggleFolder?.(action.toggle.folderId, action.toggle.expanded);
    if (action.select) selectRow(row);
    if (action.open && !event.repeat) openRow(row);
    if (
      action.parentScope &&
      directoryRows &&
      breadcrumbs &&
      breadcrumbs.length > 1
    ) {
      pendingDirectoryFocus.current = true;
      onNavigateFolder?.(breadcrumbs[breadcrumbs.length - 2].id);
    }
  };
  const dragOver = (event: DragEvent, folderId: string | null) => {
    if (
      !onMove ||
      !canMove ||
      !event.dataTransfer.types.includes(homeFileDragType)
    )
      return;
    event.stopPropagation();
    if (draggingId.current && !canMove(draggingId.current, folderId)) {
      event.dataTransfer.dropEffect = 'none';
      setDropTarget(undefined);
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTarget(folderId);
  };
  const drop = (event: DragEvent, folderId: string | null) => {
    if (
      !onMove ||
      !canMove ||
      !event.dataTransfer.types.includes(homeFileDragType)
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    const id = event.dataTransfer.getData(homeFileDragType);
    if (
      id &&
      id.length <= 512 &&
      (!draggingId.current || id === draggingId.current) &&
      canMove(id, folderId)
    )
      onMove(id, folderId);
    draggingId.current = null;
    setDropTarget(undefined);
  };
  const fileDestination = (event: DragEvent<HTMLElement>) => {
    const row = event.target instanceof Element ? event.target.closest('[data-home-folder-id]') : null;
    const folder = row && event.currentTarget.contains(row)
      ? folders.find(item => item.id === row.getAttribute('data-home-folder-id'))
      : undefined;
    return folder
      ? { id: folder.id, title: folder.title }
      : { id: directoryScopeId ?? null, title };
  };
  const fileDragOver = (event: DragEvent<HTMLElement>) => {
    if (!onDropFiles || !isHomeFileDrop(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    const destination = fileDestination(event);
    setFileDropTarget(previous => previous?.id === destination.id && previous.title === destination.title ? previous : destination);
  };
  return (
    // Native file imports are separate from the existing internal move handlers.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- The existing Import button provides the keyboard alternative.
    <section
      className={`home-file-page${previewOpen ? ' home-file-with-preview' : ''}`}
      aria-label={title}
      onDragEnterCapture={(event) => {
        if (!onDropFiles || !isHomeFileDrop(event.dataTransfer)) return;
        fileDragDepth.current++;
        fileDragOver(event);
      }}
      onDragOverCapture={fileDragOver}
      onDragLeaveCapture={(event) => {
        if (!onDropFiles || !isHomeFileDrop(event.dataTransfer)) return;
        fileDragDepth.current = Math.max(0, fileDragDepth.current - 1);
        if (!fileDragDepth.current) setFileDropTarget(null);
      }}
      onDropCapture={(event) => {
        if (!onDropFiles || !isHomeFileDrop(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        const destination = fileDestination(event);
        const { files, directories } = readHomeFileDrop(event.dataTransfer);
        fileDragDepth.current = 0;
        setFileDropTarget(null);
        if (files.length) onDropFiles(files, destination.id);
        if (directories) onFileDropError?.(t(
          'Folders were skipped. Open them and drag the files inside to import.',
          '已跳过文件夹。请打开文件夹，将其中的文件拖入导入。',
        ));
        else if (!files.length) onFileDropError?.(t(
          'No readable files were received. Try the Import button.',
          '未收到可读取的文件，请尝试使用“导入”按钮。',
        ));
      }}
    >
      {fileDropTarget && (
        <output className="home-file-drop-overlay" aria-live="polite">
          <span className="home-file-drop-hint">
            <Upload size={24} aria-hidden="true" />
            <strong>{t('Drop to import into “{folder}”', '松开以导入到「{folder}」', { folder: fileDropTarget.title })}</strong>
            <span>{t('PDF, Word (.docx), text, images and videos', 'PDF、Word（.docx）、文本、图片和视频')}</span>
          </span>
        </output>
      )}
      <header className="home-file-heading">
        <div className="home-file-location">
          {breadcrumbs?.length && onNavigateFolder ? (
            <nav
              className="home-file-breadcrumbs"
              aria-label={t('Folder path', '文件夹路径')}
            >
              {breadcrumbs.map((crumb, index) => (
                <span key={crumb.id || 'home'}>
                  {index > 0 && <ChevronRight size={12} aria-hidden="true" />}
                  <button
                    type="button"
                    aria-current={
                      index === breadcrumbs.length - 1 ? 'page' : undefined
                    }
                    onClick={() => onNavigateFolder(crumb.id)}
                    title={crumb.title}
                  >
                    {crumb.title}
                  </button>
                </span>
              ))}
            </nav>
          ) : (
            <h1>{title}</h1>
          )}
        </div>
        <div className="home-file-toolbar">
          <div className="home-file-search" data-expanded={searchExpanded}
            onBlur={(event) => {
              if (!query && !event.currentTarget.contains(event.relatedTarget as Node | null)) setSearchOpen(false);
            }}>
            <button type="button" ref={searchButton} className="home-file-search-toggle"
              aria-label={t('Search here', '搜索当前范围')}
              title={t('Search here', '搜索当前范围')}
              aria-expanded={searchExpanded} aria-controls={searchExpanded ? searchId : undefined}
              onClick={() => {
                if (searchExpanded) searchInput.current?.focus();
                else setSearchOpen(true);
              }}>
              <MaterialIcon name="search_outlined" size={20} />
            </button>
            {searchExpanded && <input
              id={searchId}
              ref={searchInput}
              value={query}
              onChange={(event) => onQueryChange(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  event.stopPropagation();
                  closeSearch();
                }
              }}
              placeholder={t('Search here…', '搜索当前范围…')}
              aria-label={t('Search in {scope}', '搜索{scope}', {
                scope: title,
              })}
            />}
            {query && <button type="button" className="home-file-search-clear"
              aria-label={t('Clear search', '清除搜索')} onClick={closeSearch}>
              <MaterialIcon name="close" size={16} />
            </button>}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger className="home-file-sort-toggle" aria-label={sortLabel} title={sortLabel}>
              <MaterialIcon name="sort" size={20} />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="home-file-sort-menu" align="end" aria-label={t('Sort files', '文件排序')}>
              <DropdownMenuRadioGroup
                value={`${sort.key}:${sort.direction}`}
                onValueChange={(value) => {
                  const option = sortOptions.find(option => `${option.key}:${option.direction}` === value);
                  if (option) onSortChange({ key: option.key, direction: option.direction });
                }}
              >
                {sortOptions.map(option => (
                  <DropdownMenuRadioItem key={`${option.key}:${option.direction}`} value={`${option.key}:${option.direction}`} closeOnClick>
                    {option.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            type="button"
            className="home-file-preview-toggle"
            aria-label={
              previewOpen
                ? t('Hide preview', '收起预览')
                : t('Show preview', '显示预览')
            }
            aria-expanded={previewOpen}
            onClick={() => onPreviewOpenChange(!previewOpen)}
          >
            <PanelRight size={16} aria-hidden="true" />
          </button>
          <div className="home-file-actions">
            {onImport && (
              <button
                type="button"
                onClick={onImport}
                aria-label={t('Import', '导入')}
                title={t('Import', '导入')}
              >
                <Upload size={14} aria-hidden="true" />
                <span>{t('Import', '导入')}</span>
              </button>
            )}
            {onNewFolder && (
              <button
                type="button"
                onClick={onNewFolder}
                aria-label={t('New folder', '新建文件夹')}
                title={t('New folder', '新建文件夹')}
              >
                <FolderPlus size={15} aria-hidden="true" />
                <span>{t('Folder', '文件夹')}</span>
              </button>
            )}
            {onNew && (
              <button
                type="button"
                className="home-file-new"
                onClick={onNew}
                aria-label={t('New', '新建')}
                title={t('New', '新建')}
              >
                <Plus size={14} aria-hidden="true" />
                <span>{t('New', '新建')}</span>
              </button>
            )}
          </div>
        </div>
      </header>
      <div className="home-file-body">
        <div className="home-file-results">
          {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- The focusable scroll region lets keyboard users leave an empty directory. */}
          <section
            className="home-file-table-scroll"
            aria-label={t('Contents of {scope}', '{scope}的内容', {
              scope: title,
            })}
            ref={scrollRef}
            tabIndex={rows.length ? -1 : 0}
            data-drop-target={
              directoryRows &&
              dropTarget !== undefined &&
              dropTarget === directoryScopeId
                ? true
                : undefined
            }
            onKeyDown={(event) => {
              if (
                event.target !== event.currentTarget ||
                event.key !== 'ArrowLeft' ||
                !breadcrumbs ||
                breadcrumbs.length < 2 ||
                event.altKey ||
                event.ctrlKey ||
                event.metaKey
              )
                return;
              event.preventDefault();
              pendingDirectoryFocus.current = true;
              onNavigateFolder?.(breadcrumbs[breadcrumbs.length - 2].id);
            }}
            onScroll={(event) =>
              onScrollOffsetChange?.(event.currentTarget.scrollTop)
            }
            onDragOver={
              directoryRows
                ? (event) => dragOver(event, directoryScopeId ?? null)
                : undefined
            }
            onDrop={
              directoryRows
                ? (event) => drop(event, directoryScopeId ?? null)
                : undefined
            }
            onDragLeave={(event) => {
              if (
                !event.currentTarget.contains(
                  event.relatedTarget as Node | null,
                )
              )
                setDropTarget(undefined);
            }}
            onFocusCapture={(event) => {
              if ((event.target as Element).closest('tbody tr'))
                hasRowFocus.current = true;
            }}
            onBlurCapture={(event) => {
              if (
                !event.currentTarget.contains(
                  event.relatedTarget as Node | null,
                )
              )
                hasRowFocus.current = false;
            }}
          >
            {/* A table-based ARIA grid keeps column semantics and selectable keyboard rows. */}
            <table
              className="home-file-table"
              role={directoryRows ? 'treegrid' : 'grid'}
              aria-label={t('Files in {scope}', '{scope}中的文件', {
                scope: title,
              })}
              aria-rowcount={rows.length + 1}
              aria-colcount={4}
            >
              <colgroup>
                <col className="home-file-col-name" />
                <col className="home-file-col-type" />
                <col className="home-file-col-tags" />
                <col className="home-file-col-opened" />
              </colgroup>
              <thead>
                <tr>
                  <th
                    scope="col"
                    aria-sort={
                      sort.key === 'title'
                        ? sort.direction === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                    }
                  >
                    <button type="button" onClick={() => chooseSort('title')}>
                      {t('Name', '名称')}
                      <SortIndicator column="title" sort={sort} />
                    </button>
                  </th>
                  <th scope="col" className="home-file-type-cell"
                    aria-sort={sort.key === 'type' ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}>
                    <button type="button" onClick={() => chooseSort('type')}>
                      {t('File type', '文件类型')}
                      <SortIndicator column="type" sort={sort} />
                    </button>
                  </th>
                  <th scope="col" className="home-file-tags-cell">
                    {t('Tags', '标签')}
                  </th>
                  <th
                    scope="col"
                    className="home-file-opened-cell"
                    aria-sort={
                      sort.key === dateKey
                        ? sort.direction === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                    }
                  >
                    <button
                      type="button"
                      onClick={() => chooseSort(dateKey)}
                      title={dateDescription}
                    >
                      {dateLabel}
                      <SortIndicator column={dateKey} sort={sort} />
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const folder = row.kind === 'folder' ? row : undefined;
                  const item = row.kind === 'file' ? row.item : undefined;
                  const Icon = folder
                    ? folder.expanded
                      ? FolderOpen
                      : Folder
                    : kindIcons[item!.kind];
                  const rowTitle =
                    folder?.title || item?.title || t('Untitled', '未命名');
                  const kindName = folder
                    ? t('Folder', '文件夹')
                    : kindNames[item!.kind];
                  const rowElement = (
                    <tr
                      key={row.id}
                      draggable={draggable}
                      className={folder ? 'home-file-folder-row' : undefined}
                      data-home-folder-id={folder?.folderId}
                      data-drop-target={
                        folder && (dropTarget === folder.folderId || fileDropTarget?.id === folder.folderId)
                          ? true
                          : undefined
                      }
                      onDragStart={
                        draggable
                          ? (event) => {
                              draggingId.current = row.id;
                              event.dataTransfer.setData(
                                homeFileDragType,
                                row.id,
                              );
                              event.dataTransfer.effectAllowed = 'move';
                            }
                          : undefined
                      }
                      onDragEnd={() => {
                        draggingId.current = null;
                        setDropTarget(undefined);
                      }}
                      onDragOver={
                        folder
                          ? (event) => dragOver(event, folder.folderId)
                          : undefined
                      }
                      onDrop={
                        folder
                          ? (event) => drop(event, folder.folderId)
                          : undefined
                      }
                      onDragLeave={
                        folder
                          ? (event) => {
                              if (
                                !event.currentTarget.contains(
                                  event.relatedTarget as Node | null,
                                )
                              )
                                setDropTarget(undefined);
                            }
                          : undefined
                      }
                      ref={(element) => {
                        if (element) rowRefs.current.set(row.id, element);
                        else rowRefs.current.delete(row.id);
                      }}
                      tabIndex={tabStopId === row.id ? 0 : -1}
                      aria-level={directoryRows ? row.depth + 1 : undefined}
                      aria-expanded={folder ? folder.expanded : undefined}
                      aria-selected={selectedRowId === row.id}
                      aria-label={`${rowTitle} · ${kindName}`}
                      onFocus={(event) => {
                        if (event.target === event.currentTarget)
                          setFocusedId(row.id);
                      }}
                      onClick={(event) => {
                        selectRow(row);
                        setFocusedId(row.id);
                        event.currentTarget.focus({ preventScroll: true });
                      }}
                      onDoubleClick={() => openRow(row)}
                      onKeyDown={(event) => {
                        if (renderRowMenu && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) {
                          event.preventDefault();
                          setFocusedId(row.id);
                          const rect = event.currentTarget.getBoundingClientRect();
                          event.currentTarget.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, button: 2, clientX: rect.left + 24, clientY: rect.top + rect.height / 2 }));
                        } else rowKeyDown(event, row);
                      }}
                    >
                      <td className="home-file-name-cell" aria-label={rowTitle}>
                        <div
                          style={
                            { '--home-file-depth': row.depth } as CSSProperties
                          }
                        >
                          {directoryRows &&
                            (folder ? (
                              <button
                                type="button"
                                className="home-file-disclosure"
                                tabIndex={-1}
                                aria-label={
                                  folder.expanded
                                    ? t('Collapse {folder}', '收起{folder}', {
                                        folder: folder.title,
                                      })
                                    : t('Expand {folder}', '展开{folder}', {
                                        folder: folder.title,
                                      })
                                }
                                disabled={!folder.hasChildren}
                                aria-expanded={folder.expanded}
                                onDoubleClick={(event) =>
                                  event.stopPropagation()
                                }
                                onClick={(event) => {
                                  event.stopPropagation();
                                  selectRow(row);
                                  setFocusedId(row.id);
                                  rowRefs.current
                                    .get(row.id)
                                    ?.focus({ preventScroll: true });
                                  onToggleFolder?.(
                                    folder.folderId,
                                    !folder.expanded,
                                  );
                                }}
                              >
                                {folder.hasChildren && (
                                  <ChevronRight size={13} aria-hidden="true" />
                                )}
                              </button>
                            ) : (
                              <span className="home-file-disclosure-spacer" />
                            ))}
                          <span
                            className={`home-file-kind home-file-kind-${folder ? 'folder' : item!.kind}`}
                            data-file-kind={item?.kind}
                            title={kindName}
                          >
                            <Icon
                              size={17}
                              strokeWidth={1.7}
                              aria-hidden="true"
                            />
                          </span>
                          <span className="home-file-name" title={rowTitle}>
                            {rowTitle}
                          </span>
                        </div>
                      </td>
                      <td className="home-file-type-cell">{kindName}</td>
                      <td className="home-file-tags-cell">
                        <div>
                          {item?.tags?.map((tag, tagIndex) => (
                            <span
                              key={`${tag}:${tagIndex}`}
                              className="home-file-tag"
                              title={tag}
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="home-file-opened-cell">
                        {item ? (
                          <time
                            dateTime={
                              fileTime(item, dateKey) === null
                                ? undefined
                                : new Date(fileTime(item, dateKey)!).toISOString()
                            }
                          >
                            {formatDate(item)}
                          </time>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                  return <Fragment key={row.id}>{renderRowMenu ? renderRowMenu(row, rowElement) : rowElement}</Fragment>;
                })}
              </tbody>
            </table>
            {(() => {
              const emptySpace = (
                <section className="home-file-empty-space">
                  {!rows.length && (
                    <div className="home-file-empty">
                      <FileText size={25} strokeWidth={1.4} aria-hidden="true" />
                      <h2>
                        {query
                          ? t('No matching files', '没有匹配的文件')
                          : t('This folder is empty', '这里还没有文件')}
                      </h2>
                      <p>
                        {query
                          ? t('Try a different search.', '试试其他关键词。')
                          : t(
                              'Create a whiteboard or NotePage, or import a file.',
                              '新建画板、NotePage，或导入文件。',
                            )}
                      </p>
                    </div>
                  )}
                </section>
              );
              return renderEmptySpaceMenu ? renderEmptySpaceMenu(emptySpace) : emptySpace;
            })()}
          </section>
          <footer className="home-file-list-footer">
            <nav
              ref={locationRef}
              className="home-file-selection-path"
              aria-label={t('Item location', '项目位置')}
              aria-live="polite"
              title={locationTitle}
            >
              {locationKnown ? (
                locationCrumbs.map((crumb, index) => (
                  <span
                    className="home-file-path-part"
                    key={crumb.id || 'home'}
                  >
                    {index > 0 && <ChevronRight size={12} aria-hidden="true" />}
                    <button
                      type="button"
                      disabled={!onNavigateFolder}
                      title={crumb.title}
                      onClick={() => onNavigateFolder?.(crumb.id)}
                    >
                      {crumb.id === null ? (
                        <Home size={13} aria-hidden="true" />
                      ) : (
                        <Folder size={13} aria-hidden="true" />
                      )}
                      <span>{crumb.title}</span>
                    </button>
                  </span>
                ))
              ) : (
                <span className="home-file-path-unavailable">
                  {t('Location unavailable', '位置不可用')}
                </span>
              )}
              {selected && LocationFileIcon && (
                <span
                  className="home-file-path-part home-file-path-file"
                  aria-current="location"
                >
                  <ChevronRight size={12} aria-hidden="true" />
                  <LocationFileIcon
                    className="home-file-path-type"
                    size={13}
                    data-file-kind={selected.kind}
                    aria-hidden="true"
                  />
                  <span>{selected.title || t('Untitled', '未命名')}</span>
                </span>
              )}
            </nav>
            <div className="home-file-list-status">
              <span className="home-file-list-count" aria-live="polite">
                {t('{count} shown', '显示 {count} 个项目', {
                  count: fileCount,
                })}
                {folderCount > 0 &&
                  t(' · {count} folders', ' · {count} 个文件夹', {
                    count: folderCount,
                  })}
              </span>
            </div>
          </footer>
        </div>
        {previewOpen && (
          <aside
            className="home-file-preview"
            aria-label={t('File preview and information', '文件预览与信息')}
          >
            <header>
              <h2>{t('Preview', '预览')}</h2>
              <button
                type="button"
                aria-label={t('Hide preview', '收起预览')}
                onClick={() => onPreviewOpenChange(false)}
              >
                <PanelRight size={16} aria-hidden="true" />
              </button>
            </header>
            {selectedFolder?.kind === 'folder' ? (
              <div className="home-file-preview-content">
                <div className="home-file-preview-cover home-file-folder-cover">
                  <FolderOpen size={38} strokeWidth={1.2} aria-hidden="true" />
                </div>
                <span className="home-file-preview-kind">
                  {t('Folder', '文件夹')}
                </span>
                <h3>{selectedFolder.title || t('Untitled', '未命名')}</h3>
                <button
                  type="button"
                  className="home-file-open-button"
                  onClick={() => onNavigateFolder?.(selectedFolder.folderId)}
                >
                  {t('Open folder', '打开文件夹')}
                </button>
                {renderFolderActions?.(selectedFolder)}
                <dl>
                  <div>
                    <dt>{t('Contents', '内容')}</dt>
                    <dd>
                      {t('{count} files', '{count} 个文件', {
                        count: selectedFolder.itemCount,
                      })}
                    </dd>
                  </div>
                </dl>
              </div>
            ) : selected ? (
              <div className="home-file-preview-content">
                <div
                  className={`home-file-preview-cover home-file-preview-cover-${selected.kind}`}
                  data-file-kind={selected.kind}
                >
                  {thumbnail ? (
                    <img
                      key={thumbnail}
                      src={thumbnail}
                      alt=""
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    (() => {
                      const Icon = kindIcons[selected.kind];
                      return (
                        <Icon size={38} strokeWidth={1.2} aria-hidden="true" />
                      );
                    })()
                  )}
                </div>
                <span className="home-file-preview-kind">
                  {kindNames[selected.kind]}
                </span>
                <h3>{selected.title || t('Untitled', '未命名')}</h3>
                <button
                  type="button"
                  className="home-file-open-button"
                  onClick={() => onOpen(selected)}
                >
                  {t('Open {kind}', '打开{kind}', {
                    kind: kindNames[selected.kind],
                  })}
                </button>
                {renderItemActions?.(selected)}
                {selected.excerpt && (
                  <p className="home-file-preview-excerpt">
                    {selected.excerpt}
                  </p>
                )}
                <dl>
                  {selected.kind === 'literature' && (
                    <>
                      <div>
                        <dt>{t('Authors', '作者')}</dt>
                        <dd>
                          {selected.authors?.filter(Boolean).join(', ') ||
                            t('Not recorded', '未记录')}
                        </dd>
                      </div>
                      <div>
                        <dt>{t('Publication year', '发表年份')}</dt>
                        <dd>
                          {selected.year !== undefined &&
                          String(selected.year).trim()
                            ? selected.year
                            : t('Not recorded', '未记录')}
                        </dd>
                      </div>
                    </>
                  )}
                  {selected.location && (
                    <div>
                      <dt>{t('Folder', '文件夹')}</dt>
                      <dd>{selected.location}</dd>
                    </div>
                  )}
                  <div>
                    <dt title={dateDescription}>{dateLabel}</dt>
                    <dd>
                      {fileTime(selected, dateKey) === null
                        ? t('Not recorded', '未记录')
                        : formatDate(selected)}
                    </dd>
                  </div>
                  {selected.details?.map((detail, index) => (
                    <div key={`${detail.label}:${index}`}>
                      <dt>{detail.label}</dt>
                      <dd>{detail.value}</dd>
                    </div>
                  ))}
                </dl>
                {!!selected.tags?.length && (
                  <div
                    className="home-file-preview-tags"
                    aria-label={t('Tags', '标签')}
                  >
                    {selected.tags.map((tag, index) => (
                      <span className="home-file-tag" key={`${tag}:${index}`}>
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                {relatedContent && (
                  <section className="home-file-related">
                    <h4>{t('Related content', '关联内容')}</h4>
                    {relatedContent}
                  </section>
                )}
              </div>
            ) : (
              <div className="home-file-preview-empty">
                <PanelRight size={25} strokeWidth={1.4} aria-hidden="true" />
                <p>
                  {t(
                    'Select a file to preview its information.',
                    '选择文件，查看预览与信息。',
                  )}
                </p>
              </div>
            )}
          </aside>
        )}
      </div>
    </section>
  );
}
