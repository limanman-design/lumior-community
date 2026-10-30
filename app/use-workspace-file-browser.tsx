'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  FileText,
  FolderInput,
  FolderPlus,
  Layers,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Settings2,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator,
} from '@/components/ui/context-menu';
import type { Board, Card } from './canvas-model';
import { documentText } from './card-document';
import {
  HomeFileList,
  type HomeFileListItem,
} from './home-file-list';
import { directoryBreadcrumbs, directoryFolderIds, homeFileSortFromNavigation as sortFromNavigation, projectHomeDirectoryRows, type HomeDirectoryRow } from './home-file-directory-model';
import { navigateWorkspaceFileScope, patchWorkspaceFileNavigation, type WorkspaceFileScopeState } from './workspace-file-navigation';
import type { HomeFileTreeAction } from './home-file-tree';
import type { HomeFileTreeNode } from './home-file-tree-model';
import {
  WorkspaceFileSidebar,
  type WorkspaceFileSidebarLeaf,
} from './workspace-file-sidebar';
import {
  createWorkspaceFolder,
  deleteWorkspaceFolder,
  markWorkspaceEntryOpened,
  moveWorkspaceEntry,
  moveWorkspaceFolder,
  projectWorkspaceFiles,
  renameWorkspaceFolder,
  setWorkspaceEntryPinned,
  type WorkspaceFiles,
  type WorkspaceFilesNavigation,
  type WorkspaceHomeItem,
} from './workspace-files';
import { recycleRetentionDays } from './recycle-policy';
import { useI18n } from './i18n';
import type { LocalImportProgress } from './local-file-import';
import { BibliographyDialog } from './bibliography-dialog';
import './workspace-file-browser.css';

export type WorkspaceFileBrowserOptions = {
  files: WorkspaceFiles;
  boards: readonly Board[];
  onChangeFiles: (files: WorkspaceFiles) => void;
  onNavigateHome: () => void;
  onOpenEntry: (entryId: string) => void;
  onOpenContent: (contentId: string) => void;
  onCreateBoard: (folderId: string | null) => void;
  onCreateNotePage: (folderId: string | null) => void;
  onImportFiles: (folderId: string | null) => void;
  onImportObsidian?: (folderId: string | null, format: 'folder' | 'zip') => void;
  onDropFiles?: (files: File[], folderId: string | null) => void;
  onPatchContent: (contentId: string, patch: Partial<Card>) => void;
  onReference: (contentId: string, boardId: string) => void;
  onRecycleContent: (contentId: string) => void;
  onDeleteBoard: (boardId: string) => void;
  onRenameBoard: (boardId: string, title: string) => void;
  onCreateSummary?: (sourceContentId: string) => void;
  importing?: boolean;
  importProgress?: LocalImportProgress | null;
  onPauseImport?: () => void;
  statusMessage?: string;
};

type BrowserDialog = {
  kind:
    | 'import'
    | 'create'
    | 'newFolder'
    | 'rename'
    | 'move'
    | 'reference'
    | 'metadata'
    | 'summary'
    | 'recycle'
    | 'deleteFolder';
  target: 'folder' | 'entry';
  id: string;
  name: string;
  folderId: string | null;
  boardId: string;
  authors: string;
  year: string;
  tags: string;
  sourceId: string;
};
const makeDialog = (
  kind: BrowserDialog['kind'],
  patch: Partial<BrowserDialog> = {},
): BrowserDialog => ({
  kind,
  target: 'entry',
  id: '',
  name: '',
  folderId: null,
  boardId: '',
  authors: '',
  year: '',
  tags: '',
  sourceId: '',
  ...patch,
});
const treeFolderId = (id: string) => `folder:${id}`;
const fromTreeFolderId = (id: string | null) =>
  id?.startsWith('folder:') ? id.slice(7) : null;
const defaultNavigation = (): WorkspaceFilesNavigation => ({
  expandedFolderIds: [],
  selectedFolderId: null,
  previewOpen: false,
});

/** File navigation and user actions only. The parent owns all content mutations. */
export function useWorkspaceFileBrowser(options: WorkspaceFileBrowserOptions): {
  home: ReactNode;
  sidebar: ReactNode;
  dialogs: ReactNode;
  newFolder: () => void;
  createBoard: () => void;
  createNotePage: () => void;
  importFiles: () => void;
  goHome: () => void;
  openFolder: (folderId: string | null) => void;
  addToBoard: (contentId: string) => void;
  editContentMetadata: (contentId: string) => void;
} {
  const {
    files,
    boards,
    onChangeFiles,
    onNavigateHome,
    onOpenEntry,
    onOpenContent,
    onCreateBoard,
    onCreateNotePage,
    onImportFiles,
    onImportObsidian,
    onDropFiles,
    onPatchContent,
    onReference,
    onRecycleContent,
    onDeleteBoard,
    onRenameBoard,
    onCreateSummary,
    importing = false,
    importProgress,
    onPauseImport,
    statusMessage,
  } = options;
  const { t, locale } = useI18n();
  const [dialog, setDialog] = useState<BrowserDialog | null>(null);
  const [error, setError] = useState('');
  const latestFiles = useRef(files);
  useEffect(() => {
    latestFiles.current = files;
  }, [files]);
  const navigation = files.navigation || defaultNavigation();
  const selectedFolderId = navigation.selectedFolderId || null;
  const currentFolder = files.folders.find(
    (folder) => folder.id === selectedFolderId,
  );
  const allItems = useMemo(
    () => projectWorkspaceFiles(files, boards),
    [files, boards],
  );
  const byEntryId = useMemo(
    () => new Map(allItems.map((item) => [item.id, item])),
    [allItems],
  );
  const folderById = useMemo(
    () => new Map(files.folders.map((folder) => [folder.id, folder])),
    [files.folders],
  );
  const folderPath = (folderId: string | null) => {
    const names: string[] = [],
      seen = new Set<string>();
    let id = folderId;
    while (id && !seen.has(id)) {
      seen.add(id);
      const folder = folderById.get(id);
      if (!folder) break;
      names.unshift(folder.title);
      id = folder.parentId;
    }
    return names.join(' / ') || t('Root', '根目录');
  };
  const changeFiles = (next: WorkspaceFiles) => {
    latestFiles.current = next;
    onChangeFiles(next);
  };
  const patchNavigation = (patch: Partial<WorkspaceFileScopeState>) => {
    const current = latestFiles.current;
    changeFiles({
      ...current,
      navigation: patchWorkspaceFileNavigation(current.navigation, patch),
    });
  };
  const openDialog = (next: BrowserDialog) => {
    setError('');
    setDialog(next);
  };
  const openFolder = (folderId: string | null) => {
    if (folderId !== null && !latestFiles.current.folders.some(folder => folder.id === folderId)) return;
    // Each scope keeps its own search, expansion, selection and scroll state.
    if (
      (latestFiles.current.navigation?.selectedFolderId || null) === folderId
    ) {
      onNavigateHome();
      return;
    }
    changeFiles({ ...latestFiles.current, navigation: navigateWorkspaceFileScope(latestFiles.current.navigation, folderId) });
    onNavigateHome();
  };
  const goHome = () => openFolder(null);
  const openEntry = (id: string) => {
    const current = latestFiles.current;
    if (!current.entries.some((entry) => entry.id === id)) return;
    const opened = markWorkspaceEntryOpened(current, id);
    changeFiles({
      ...opened,
      navigation: patchWorkspaceFileNavigation(opened.navigation, { selectedEntryId: id, selectedFolderRowId: undefined }),
    });
    onOpenEntry(id);
  };
  const createBoard = () =>
    onCreateBoard(latestFiles.current.navigation?.selectedFolderId || null);
  const createNotePage = () =>
    onCreateNotePage(latestFiles.current.navigation?.selectedFolderId || null);
  const importFiles = () => openDialog(makeDialog('import'));
  const newFolder = () =>
    openDialog(
      makeDialog('newFolder', {
        folderId: latestFiles.current.navigation?.selectedFolderId || null,
      }),
    );
  const newRootFolder = () => openDialog(makeDialog('newFolder', { folderId: null }));
  const move = (id: string, folderId: string | null) => {
    const current = latestFiles.current;
    try {
      const next = id.startsWith('folder:')
        ? moveWorkspaceFolder(current, fromTreeFolderId(id)!, folderId)
        : moveWorkspaceEntry(current, id, folderId);
      const expanded = next.navigation?.expandedFolderIds || [];
      changeFiles({
        ...next,
        navigation: patchWorkspaceFileNavigation(next.navigation, {
          expandedFolderIds:
            folderId && !expanded.includes(folderId)
              ? [...expanded, folderId]
              : expanded,
        }),
      });
      setError('');
    } catch {
      setError(
        t(
          'This move is not allowed. A folder cannot contain itself or its descendants.',
          '无法移动到这里，文件夹不能移入自己或自己的后代。',
        ),
      );
    }
  };
  const canMove = (id: string, targetId: string | null) => {
    const folderId = fromTreeFolderId(targetId);
    if (
      targetId !== null &&
      (!targetId.startsWith('folder:') || !folderById.has(folderId!))
    )
      return false;
    try {
      if (id.startsWith('folder:')) {
        const folder = folderById.get(fromTreeFolderId(id)!);
        if (!folder || folder.parentId === folderId) return false;
        moveWorkspaceFolder(files, folder.id, folderId);
      } else {
        const entry = files.entries.find((entry) => entry.id === id);
        if (!entry || entry.folderId === folderId) return false;
        moveWorkspaceEntry(files, id, folderId);
      }
      return true;
    } catch {
      return false;
    }
  };
  const actOnEntry = (item: WorkspaceHomeItem, action: HomeFileTreeAction) => {
    if (action === 'delete' && item.entry.kind === 'board' && item.entry.boardId) {
      onDeleteBoard(item.entry.boardId);
    } else if (action === 'pin' || action === 'unpin') {
      changeFiles(
        setWorkspaceEntryPinned(latestFiles.current, item.id, action === 'pin'),
      );
    } else if (action === 'rename')
      openDialog(makeDialog('rename', { id: item.id, name: item.title }));
    else if (action === 'move')
      openDialog(
        makeDialog('move', {
          id: item.id,
          name: item.title,
          folderId: item.entry.folderId,
        }),
      );
  };
  const actOnNode = (node: HomeFileTreeNode, action: HomeFileTreeAction) => {
    if (node.kind !== 'folder') {
      const item = byEntryId.get(node.id);
      if (item) actOnEntry(item, action);
      return;
    }
    const folder = folderById.get(fromTreeFolderId(node.id)!);
    if (!folder) return;
    if (action === 'rename' || action === 'move')
      openDialog(
        makeDialog(action, {
          target: 'folder',
          id: folder.id,
          name: folder.title,
          folderId: folder.parentId,
        }),
      );
  };
  const leafForItem = (item: WorkspaceHomeItem): WorkspaceFileSidebarLeaf => ({
    id: item.id,
    title: item.title,
    kind: item.kind,
    pinned: item.entry.pinnedAt !== undefined,
  });
  const buildFolders = (
    parentId: string | null,
    seen = new Set<string>(),
  ): HomeFileTreeNode[] =>
    files.folders
      .filter((folder) => folder.parentId === parentId && !seen.has(folder.id))
      .sort((a, b) => a.title.localeCompare(b.title, locale, { numeric: true }))
      .map((folder) => {
        const visited = new Set(seen);
        visited.add(folder.id);
        return {
          id: treeFolderId(folder.id),
          title: folder.title,
          kind: 'folder',
          children: [
            ...buildFolders(folder.id, visited),
            ...allItems
              .filter((item) => item.entry.folderId === folder.id)
              .map(leafForItem),
          ],
        };
      });
  const nodes = buildFolders(null);
  const pinned = allItems
    .filter((item) => item.entry.pinnedAt !== undefined)
    .sort((a, b) => (b.entry.pinnedAt || 0) - (a.entry.pinnedAt || 0))
    .map(leafForItem);
  const recent = allItems
    .filter((item) => item.lastOpenedAt !== undefined)
    .sort((a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0))
    .slice(0, 16)
    .map(leafForItem);
  const scopeFolderIds = currentFolder ? directoryFolderIds(files.folders, currentFolder.id) : null;
  const scopedItems = scopeFolderIds
    ? allItems.filter((item) => item.entry.folderId !== null && scopeFolderIds.has(item.entry.folderId))
    : allItems;
  const listItems: HomeFileListItem[] = scopedItems.map((item) => {
    const card = item.content?.card;
    const details: { label: string; value: string }[] = [];
    if (item.kind === 'literature' && card?.pdf?.pages)
      details.push({ label: t('Page count', '页数'), value: String(card.pdf.pages) });
    if (item.kind === 'video' && card?.video?.duration)
      details.push({
        label: t('Duration', '时长'),
        value: `${Math.floor(card.video.duration / 60)}:${String(Math.floor(card.video.duration % 60)).padStart(2, '0')}`,
      });
    if (card?.bibliography) {
      const bibliography = card.bibliography;
      if (bibliography.journal) details.push({ label: t('Journal / source', '期刊／来源'), value: bibliography.journal });
      if (bibliography.doi) details.push({ label: 'DOI', value: bibliography.doi });
      details.push({ label: t('Literature information', '文献信息'), value: bibliography.status === 'pending' ? t('Identifying…', '正在识别…') : bibliography.status === 'resolved' ? t('Completed via DOI', 'DOI 已补全') : bibliography.status === 'review' ? t('Review information', '待核对') : t('Not identified', '待补全') });
    }
    if (card?.sourceName)
      details.push({ label: t('Source name', '来源名称'), value: card.sourceName });
    return {
      ...item,
      folderId: item.entry.folderId,
      details,
      location: folderPath(item.entry.folderId),
      thumbnailUrl:
        card?.pdf?.thumbnail ||
        card?.video?.poster ||
        (card?.pdfExcerpt ? undefined : card?.image),
      excerpt: card?.blocks?.length ? documentText(card.blocks) : card?.body,
    };
  });
  const directoryRows = currentFolder ? projectHomeDirectoryRows({
    items: listItems, folders: files.folders, currentFolderId: currentFolder.id,
    expandedFolderIds: navigation.expandedFolderIds, query: navigation.search || '',
    sort: sortFromNavigation(navigation.sort), locale,
  }) : undefined;
  const breadcrumbs = [
    { id: null, title: t('Home', '首页') },
    ...directoryBreadcrumbs(files.folders, selectedFolderId).map(folder => ({ id: folder.id, title: folder.title })),
  ];
  const folderOptions = files.folders
    .map((folder) => ({ id: folder.id, label: folderPath(folder.id) }))
    .sort((a, b) => a.label.localeCompare(b.label, locale, { numeric: true }));
  const editContentMetadata = (contentId: string) => {
    const content = latestFiles.current.contents.find(
      (content) => content.id === contentId,
    );
    if (!content) return;
    openDialog(
      makeDialog('metadata', {
        id: content.id,
        name: content.card.title,
        authors: (content.authors || []).join('\n'),
        year: content.year === undefined ? '' : String(content.year),
        tags: (content.card.tags || []).join(', '),
      }),
    );
  };
  const addToBoard = (contentId: string) => {
    const content = latestFiles.current.contents.find(
      (content) => content.id === contentId,
    );
    if (!content) return;
    openDialog(
      makeDialog('reference', {
        id: content.id,
        name: content.card.title,
        boardId: boards[0]?.id || '',
      }),
    );
  };
  const entryMenu = (item: Pick<HomeFileListItem, 'id'>, context = false) => {
    const original = byEntryId.get(item.id);
    if (!original) return null;
    const content = original.content;
    const Item = context ? ContextMenuItem : DropdownMenuItem;
    const Separator = context ? ContextMenuSeparator : DropdownMenuSeparator;
    return <>
            <Item onClick={() => actOnEntry(original, 'rename')}>
              <Pencil size={15} aria-hidden="true" />
              {t('Rename', '重命名')}
            </Item>
            <Item onClick={() => actOnEntry(original, 'move')}>
              <FolderInput size={15} aria-hidden="true" />
              {t('Move to…', '移动到…')}
            </Item>
            <Item
              onClick={() =>
                actOnEntry(
                  original,
                  original.entry.pinnedAt !== undefined ? 'unpin' : 'pin',
                )
              }
            >
              {original.entry.pinnedAt !== undefined ? (
                <PinOff size={15} aria-hidden="true" />
              ) : (
                <Pin size={15} aria-hidden="true" />
              )}
              {original.entry.pinnedAt !== undefined
                ? t('Unpin', '取消置顶')
                : t('Pin', '置顶')}
            </Item>
            {content && (
              <>
                <Item
                  onClick={() => editContentMetadata(content.id)}
                >
                  <Settings2 size={15} aria-hidden="true" />
                  {t('Edit information', '编辑信息')}
                </Item>
                <Item
                  disabled={!boards.length}
                  onClick={() => addToBoard(content.id)}
                >
                  <Layers size={15} aria-hidden="true" />
                  {t('Add reference to whiteboard', '引用到画板')}
                </Item>
                {content.role === 'literature' && onCreateSummary && (
                  <Item onClick={() => onCreateSummary(content.id)}>
                    <Plus size={15} aria-hidden="true" />
                    {t('New linked summary', '新建关联摘要')}
                  </Item>
                )}
                {content.role === 'notePage' && (
                  <Item
                    onClick={() =>
                      openDialog(
                        makeDialog('summary', {
                          id: content.id,
                          name: original.title,
                          sourceId: content.sourceContentId || '',
                        }),
                      )
                    }
                  >
                    <FileText size={15} aria-hidden="true" />
                    {t('Mark as literature summary…', '设为文献摘要…')}
                  </Item>
                )}
                <Separator />
                <Item
                  className="workspace-file-danger"
                  onClick={() =>
                    openDialog(
                      makeDialog('recycle', {
                        id: content.id,
                        name: original.title,
                      }),
                    )
                  }
                >
                  <Trash2 size={15} aria-hidden="true" />
                  {t('Move to Trash…', '移入回收站…')}
                </Item>
              </>
            )}
            {original.entry.kind === 'board' && <>
              <Separator />
              <Item variant="destructive" onClick={() => actOnEntry(original, 'delete')}>
                <Trash2 size={15} aria-hidden="true" />
                {t('Move to Trash', '移入回收站')}
              </Item>
            </>}
    </>;
  };
  const folderMenu = (folderId: string, context = false) => {
    const folder = folderById.get(folderId);
    if (!folder) return null;
    const Item = context ? ContextMenuItem : DropdownMenuItem;
    const Separator = context ? ContextMenuSeparator : DropdownMenuSeparator;
    const node: HomeFileTreeNode = { id: treeFolderId(folder.id), title: folder.title, kind: 'folder', children: [] };
    return <>
          <Item onClick={() => actOnNode(node, 'rename')}><Pencil size={15} aria-hidden="true" />{t('Rename', '重命名')}</Item>
          <Item onClick={() => actOnNode(node, 'move')}><FolderInput size={15} aria-hidden="true" />{t('Move to…', '移动到…')}</Item>
          <Item onClick={() => openDialog(makeDialog('newFolder', { folderId: folder.id }))}><FolderPlus size={15} aria-hidden="true" />{t('New subfolder', '新建子文件夹')}</Item>
          <Separator />
          <Item variant="destructive" onClick={() => openDialog(makeDialog('deleteFolder', { target: 'folder', id: folder.id, name: folder.title }))}><Trash2 size={15} aria-hidden="true" />{t('Delete folder…', '删除文件夹…')}</Item>
    </>;
  };
  const moreButton = (menu: ReactNode) => <div className="workspace-file-item-actions">
    <DropdownMenu>
      <DropdownMenuTrigger className="workspace-file-action-trigger">
        <MoreHorizontal size={15} aria-hidden="true" />{t('More actions', '更多操作')}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="lumior-menu" align="start">{menu}</DropdownMenuContent>
    </DropdownMenu>
  </div>;
  const renderActions = (item: HomeFileListItem) => moreButton(entryMenu(item));
  const renderFolderActions = (row: Extract<HomeDirectoryRow<HomeFileListItem>, { kind: 'folder' }>) => moreButton(folderMenu(row.folderId));
  const home = (
    <div className="workspace-file-home">
      {(importing || statusMessage) && (
        <output className="notice workspace-file-status" aria-live="polite">
          <span>
            {importing
              ? importProgress
                ? t(
                    'Importing files {current} / {total}…',
                    '正在导入文件 {current} / {total}…',
                    {
                      current: Math.min(
                        importProgress.completed + 1,
                        importProgress.total,
                      ),
                      total: importProgress.total,
                    },
                  )
                : t('Importing files…', '正在导入文件…')
              : statusMessage}
          </span>
          {importing && importProgress?.name && (
            <span
              className="workspace-file-status-name"
              title={importProgress.name}
            >
              {importProgress.name}
            </span>
          )}
          {importing && onPauseImport && <button type="button" onClick={onPauseImport}>{t('Pause import', '暂停导入')}</button>}
        </output>
      )}
      {error && !dialog && (
        <div className="workspace-file-error" role="alert">
          {error}
          <button type="button" onClick={() => setError('')}>
            {t('Dismiss', '关闭')}
          </button>
        </div>
      )}
      <HomeFileList
        items={listItems}
        scopeTitle={currentFolder?.title}
        query={navigation.search || ''}
        onQueryChange={(search) => patchNavigation({ search, scrollTop: 0 })}
        typeFilter="all"
        onTypeFilterChange={() => patchNavigation({ typeFilter: 'all', scrollTop: 0 })}
        sort={sortFromNavigation(navigation.sort)}
        onSortChange={(sort) =>
          patchNavigation({
            sort: `${sort.key}:${sort.direction}`,
            scrollTop: 0,
          })
        }
        selectedId={navigation.selectedEntryId || null}
        onSelect={(selectedEntryId) =>
          patchNavigation({ selectedEntryId, selectedFolderRowId: undefined, previewOpen: true })
        }
        onOpen={(item) => openEntry(item.id)}
        previewOpen={navigation.previewOpen === true}
        onPreviewOpenChange={(previewOpen) => patchNavigation({ previewOpen })}
        scopeKey={selectedFolderId || 'all'}
        scrollOffset={navigation.scrollTop || 0}
        onScrollOffsetChange={(scrollTop) => patchNavigation({ scrollTop })}
        onNew={() => openDialog(makeDialog('create'))}
        onNewFolder={newFolder}
        onImport={importFiles}
        onDropFiles={onDropFiles ? (incoming, folderId) => { setError(''); onDropFiles(incoming, folderId); } : undefined}
        onFileDropError={setError}
        draggable
        directoryRows={directoryRows}
        folders={files.folders}
        directoryScopeId={currentFolder?.id}
        breadcrumbs={breadcrumbs}
        onNavigateFolder={(id) => id === null ? goHome() : openFolder(id)}
        onToggleFolder={(id, expanded) => {
          if (!latestFiles.current.folders.some(folder => folder.id === id)) return;
          const current = latestFiles.current.navigation?.expandedFolderIds || [];
          patchNavigation({ expandedFolderIds: expanded ? [...new Set([...current, id])] : current.filter(folderId => folderId !== id) });
        }}
        selectedFolderRowId={navigation.selectedFolderRowId || null}
        onSelectFolder={(id) => patchNavigation({ selectedFolderRowId: id, selectedEntryId: undefined, previewOpen: true })}
        renderFolderActions={renderFolderActions}
        renderEmptySpaceMenu={(trigger) => <ContextMenu>
          <ContextMenuTrigger
            render={trigger}
            tabIndex={0}
            aria-label={t('Create content in this folder', '在当前文件夹中新建内容')}
            onKeyDown={(event) => {
              if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                event.preventDefault();
                const rect = event.currentTarget.getBoundingClientRect();
                event.currentTarget.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, button: 2, clientX: rect.left + 24, clientY: rect.top + 24 }));
              }
            }}
          />
          <ContextMenuContent className="lumior-menu workspace-file-context-menu">
            <ContextMenuItem onClick={createBoard}><Layers size={15} aria-hidden="true" />{t('New whiteboard', '新建画板')}</ContextMenuItem>
            <ContextMenuItem onClick={createNotePage}><FileText size={15} aria-hidden="true" />{t('New NotePage', '新建 NotePage')}</ContextMenuItem>
            <ContextMenuItem onClick={newFolder}><FolderPlus size={15} aria-hidden="true" />{t('New folder', '新建文件夹')}</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>}
        renderRowMenu={(row, trigger) => <ContextMenu>
          <ContextMenuTrigger render={trigger} />
          <ContextMenuContent className="lumior-menu workspace-file-context-menu">
            <ContextMenuItem onClick={() => row.kind === 'folder' ? openFolder(row.folderId) : openEntry(row.item.id)}>
              <FileText size={15} aria-hidden="true" />{t('Open', '打开')}
            </ContextMenuItem>
            <ContextMenuSeparator />
            {row.kind === 'folder' ? folderMenu(row.folderId, true) : entryMenu(row.item, true)}
          </ContextMenuContent>
        </ContextMenu>}
        canMove={(sourceId, targetId) => canMove(sourceId, targetId === null ? null : treeFolderId(targetId))}
        onMove={(sourceId, targetId) => move(sourceId, targetId)}
        renderItemActions={renderActions}
        renderRelatedContent={(item) => {
          const content = byEntryId.get(item.id)?.content;
          if (!content || content.role !== 'literature') return null;
          const related = files.contents.filter(
            (summary) =>
              summary.role === 'summary' &&
              summary.sourceContentId === content.id,
          );
          return related.length ? (
            <div className="workspace-file-related-list">
              {related.map((summary) => (
                <button
                  type="button"
                  key={summary.id}
                  onClick={() => onOpenContent(summary.id)}
                >
                  <FileText size={14} aria-hidden="true" />
                  <span>
                    {summary.card.title || t('Untitled summary', '未命名摘要')}
                  </span>
                </button>
              ))}
            </div>
          ) : null;
        }}
      />
    </div>
  );
  const sidebar = (
    <WorkspaceFileSidebar
      nodes={nodes}
      pinned={pinned}
      recent={recent}
      expandedIds={navigation.expandedFolderIds.map(treeFolderId)}
      selectedId={selectedFolderId ? treeFolderId(selectedFolderId) : null}
      onNewFolder={newRootFolder}
      onToggle={(id, expanded) => {
        const folderId = fromTreeFolderId(id);
        if (!folderId) return;
        const current = latestFiles.current.navigation?.expandedFolderIds || [];
        patchNavigation({
          expandedFolderIds: expanded
            ? [...new Set([...current, folderId])]
            : current.filter((id) => id !== folderId),
        });
      }}
      onSelect={(node) => {
        if (node.kind === 'folder') openFolder(fromTreeFolderId(node.id));
        else {
          const item = byEntryId.get(node.id);
          if (item) {
            const current = latestFiles.current;
            changeFiles({ ...current, navigation: patchWorkspaceFileNavigation(navigateWorkspaceFileScope(current.navigation, item.entry.folderId), { selectedEntryId: item.id, selectedFolderRowId: undefined, previewOpen: true }) });
            onNavigateHome();
          }
        }
      }}
      onOpen={(node) =>
        node.kind === 'folder'
          ? openFolder(fromTreeFolderId(node.id))
          : openEntry(node.id)
      }
      renderMenu={(node, context) => node.kind === 'folder' ? folderMenu(fromTreeFolderId(node.id)!, context) : entryMenu(node, context)}
      canMove={canMove}
      onMove={(id, targetId) => move(id, fromTreeFolderId(targetId))}
    />
  );

  const submitDialog = () => {
    if (!dialog) return;
    const current = latestFiles.current;
    try {
      if (dialog.kind === 'newFolder') {
        if (!dialog.name.trim()) {
          setError(t('Enter a folder name.', '请输入文件夹名称。'));
          return;
        }
        const created = createWorkspaceFolder(
          current,
          dialog.name,
          dialog.folderId,
        );
        const createdFolder = created.folders.at(-1)!;
        const inCurrentScope = (current.navigation?.selectedFolderId ?? null) === dialog.folderId;
        changeFiles({
          ...created,
          navigation: patchWorkspaceFileNavigation(created.navigation, {
            expandedFolderIds: [...new Set([
              ...(created.navigation?.expandedFolderIds || []),
              ...directoryBreadcrumbs(created.folders, dialog.folderId).map(folder => folder.id),
            ])],
            ...(inCurrentScope && dialog.folderId !== null ? {
              search: '', selectedEntryId: undefined, selectedFolderRowId: createdFolder.id, previewOpen: true,
            } : {}),
          }),
        });
      } else if (dialog.kind === 'rename') {
        if (!dialog.name.trim()) {
          setError(t('Enter a name.', '请输入名称。'));
          return;
        }
        if (dialog.target === 'folder')
          changeFiles(renameWorkspaceFolder(current, dialog.id, dialog.name));
        else {
          const entry = current.entries.find((entry) => entry.id === dialog.id);
          if (entry?.kind === 'board' && entry.boardId)
            onRenameBoard(entry.boardId, dialog.name.trim());
          else if (entry?.contentId)
            onPatchContent(entry.contentId, { title: dialog.name.trim() });
        }
      } else if (dialog.kind === 'move') {
        const moved =
          dialog.target === 'folder'
            ? moveWorkspaceFolder(current, dialog.id, dialog.folderId)
            : moveWorkspaceEntry(current, dialog.id, dialog.folderId);
        changeFiles({
          ...moved,
          navigation: patchWorkspaceFileNavigation(moved.navigation, {
            expandedFolderIds: dialog.folderId
              ? [
                  ...new Set([
                    ...(moved.navigation?.expandedFolderIds || []),
                    dialog.folderId,
                  ]),
                ]
              : moved.navigation?.expandedFolderIds || [],
          }),
        });
      } else if (dialog.kind === 'reference') {
        if (
          !dialog.boardId ||
          !boards.some((board) => board.id === dialog.boardId)
        ) {
          setError(t('Choose a whiteboard.', '请选择画板。'));
          return;
        }
        onReference(dialog.id, dialog.boardId);
      } else if (dialog.kind === 'metadata') {
        const content = current.contents.find(
          (content) => content.id === dialog.id,
        );
        if (!content) return;
        const year = dialog.year.trim()
          ? Number(dialog.year.trim())
          : undefined;
        if (
          content.role === 'literature' &&
          year !== undefined &&
          (!/^\d{1,4}$/.test(dialog.year.trim()) || !Number.isInteger(year))
        ) {
          setError(
            t(
              'Enter a valid publication year, or leave it empty.',
              '请输入有效发表年份，或留空。',
            ),
          );
          return;
        }
        onPatchContent(dialog.id, {
          tags: [
            ...new Set(
              dialog.tags
                .split(/[,，\n]/)
                .map((tag) => tag.trim())
                .filter(Boolean),
            ),
          ],
          ...(content.role === 'literature'
            ? {
                authors: dialog.authors
                  .split(/\n/)
                  .map((author) => author.trim())
                  .filter(Boolean),
                year,
              }
            : {}),
        });
      } else if (dialog.kind === 'summary') {
        if (
          !dialog.sourceId ||
          !current.contents.some(
            (content) =>
              content.id === dialog.sourceId && content.role === 'literature',
          )
        ) {
          setError(t('Choose the source literature.', '请选择来源文献。'));
          return;
        }
        onPatchContent(dialog.id, {
          contentRole: 'summary',
          sourceContentId: dialog.sourceId,
        });
      } else if (dialog.kind === 'recycle') onRecycleContent(dialog.id);
      else if (dialog.kind === 'deleteFolder') changeFiles(deleteWorkspaceFolder(current, dialog.id));
      setDialog(null);
      setError('');
    } catch {
      setError(
        t(
          'This action could not be completed. Check the destination and try again.',
          '暂时无法完成，请检查名称或目标文件夹后重试。',
        ),
      );
    }
  };
  const dialogTitle =
    dialog?.kind === 'import' ? t('Import', '导入') : dialog?.kind === 'newFolder'
      ? t('New folder', '新建文件夹')
      : dialog?.kind === 'rename'
        ? t('Rename', '重命名')
        : dialog?.kind === 'move'
          ? t('Move to folder', '移动到文件夹')
          : dialog?.kind === 'reference'
            ? t('Add reference to whiteboard', '引用到画板')
            : dialog?.kind === 'metadata'
              ? t('Edit information', '编辑信息')
              : dialog?.kind === 'summary'
                ? t('Set source literature', '设置来源文献')
                : dialog?.kind === 'recycle'
                  ? t('Move to Trash', '移入回收站')
                  : dialog?.kind === 'deleteFolder'
                    ? t('Delete folder', '删除文件夹')
                  : t('New', '新建');
  const metadataContent =
    dialog?.kind === 'metadata'
      ? files.contents.find((content) => content.id === dialog.id)
      : undefined;
  const dialogs = metadataContent?.card.kind === 'pdf' ? (
    <BibliographyDialog key={metadataContent.id} card={metadataContent.card}
      onClose={() => { setDialog(null); setError(''); }}
      onSave={patch => { if (latestFiles.current.contents.some(item => item.id === metadataContent.id)) onPatchContent(metadataContent.id, patch); setDialog(null); }}
      onRecognize={async signal => {
        const current = latestFiles.current.contents.find(item => item.id === metadataContent.id);
        if (!current || current.card.kind !== 'pdf') throw new Error(t('This file is no longer available.', '此文件已不存在。'));
        const { readPdfBibliography } = await import('./pdf-bibliography');
        return readPdfBibliography(current.card, signal);
      }} />
  ) : (
    <Dialog
      open={!!dialog}
      onOpenChange={(open) => {
        if (!open) {
          setDialog(null);
          setError('');
        }
      }}
    >
      <DialogContent
        className="workspace-file-dialog"
        overlayClassName="workspace-file-dialog-overlay"
      >
        <DialogTitle>{dialogTitle}</DialogTitle>
        <DialogDescription>
          {dialog?.kind === 'import'
            ? t('Import files, or migrate an Obsidian vault into a new folder. Existing content is kept.', '导入文件，或将 Obsidian 笔记库迁入一个新文件夹，已有内容会保留。')
            : dialog?.kind === 'recycle'
            ? t(
                'Move “{title}” and its whiteboard references to the trash for {days} days. Restoring brings back the file and references on whiteboards that still exist. Whiteboards are kept.',
                '将“{title}”及其画板引用移入回收站，保留 {days} 天。恢复时会找回文件和仍存在画板中的引用，画板本身保留。',
                { title: dialog.name, days: recycleRetentionDays },
              )
            : dialog?.kind === 'deleteFolder'
              ? t('Delete the folder “{title}”? Its files and subfolders will move to the root. No content will be deleted, and the structure inside subfolders will be kept.', '删除文件夹“{title}”？其中的文件和子文件夹会移到根目录。内容不会被删除，子文件夹内部结构保持不变。', { title: dialog.name })
            : dialog?.kind === 'summary'
              ? t(
                  'The note body is kept. It will be available through its source literature and the card library, and removed from the Home list.',
                  '正文保持原样，可从来源文献和卡片库访问，首页列表中不再展示。',
                )
              : dialog?.kind === 'reference'
                ? t(
                    'The content stays shared. Each whiteboard keeps its own position and size.',
                    '正文保持同步，各画板保留独立的位置与尺寸。',
                  )
                : dialog?.kind === 'newFolder'
                  ? t(
                      'Folders organise files without changing their contents.',
                      '使用文件夹归档，文件内容保持原样。',
                    )
                  : dialog?.kind === 'create'
                    ? t(
                        'New content is saved in the current folder.',
                        '新内容保存在当前文件夹中。',
                      )
                    : dialog?.name ||
                      t(
                        'Choose a name or destination.',
                        '设置名称或目标位置。',
                      )}
        </DialogDescription>
        {dialog?.kind === 'import' ? (
          <div className="workspace-file-create-options">
            <button type="button" onClick={() => { setDialog(null); onImportFiles(selectedFolderId); }}>
              <Upload size={17} aria-hidden="true" />{t('Local files', '本地文件')}
            </button>
            {onImportObsidian && <>
              <button type="button" disabled={importing} onClick={() => { setDialog(null); onImportObsidian(selectedFolderId, 'folder'); }}>
                <FolderInput size={17} aria-hidden="true" />{t('Obsidian vault folder', 'Obsidian 笔记库文件夹')}
              </button>
              <button type="button" disabled={importing} onClick={() => { setDialog(null); onImportObsidian(selectedFolderId, 'zip'); }}>
                <Upload size={17} aria-hidden="true" />{t('Obsidian vault ZIP', 'Obsidian 笔记库 ZIP')}
              </button>
              <p className="workspace-file-import-help">{t('Keeps folders, notes and attachments. Note embeds become links; heading and block links open the note. Plugins, Canvas and syncing are not included.', '保留目录、笔记与附件。笔记嵌入转为链接，标题和段落链接打开整篇笔记；不迁移插件、Canvas，也不持续同步。')}</p>
            </>}
          </div>
        ) : dialog?.kind === 'create' ? (
          <div className="workspace-file-create-options">
            <button
              type="button"
              onClick={() => {
                setDialog(null);
                createBoard();
              }}
            >
              <Layers size={17} aria-hidden="true" />
              {t('New whiteboard', '新建画板')}
            </button>
            <button
              type="button"
              onClick={() => {
                setDialog(null);
                createNotePage();
              }}
            >
              <FileText size={17} aria-hidden="true" />
              {t('New NotePage', '新建 NotePage')}
            </button>
            <button type="button" onClick={newFolder}>
              <FolderPlus size={17} aria-hidden="true" />
              {t('New folder', '新建文件夹')}
            </button>
            <button
              type="button"
              onClick={() => {
                setDialog(null);
                importFiles();
              }}
            >
              <Upload size={17} aria-hidden="true" />
              {t('Import files', '导入文件')}
            </button>
          </div>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submitDialog();
            }}
          >
            {(dialog?.kind === 'newFolder' || dialog?.kind === 'rename') && (
              <label>
                {t('Name', '名称')}
                <input
                  value={dialog.name}
                  maxLength={200}
                  onChange={(event) =>
                    setDialog({ ...dialog, name: event.currentTarget.value })
                  }
                />
              </label>
            )}
            {(dialog?.kind === 'newFolder' || dialog?.kind === 'move') && (
              <label>
                {dialog.kind === 'newFolder'
                  ? t('Parent folder', '上级文件夹')
                  : t('Destination', '目标文件夹')}
                <select
                  value={dialog.folderId || ''}
                  onChange={(event) =>
                    setDialog({
                      ...dialog,
                      folderId: event.currentTarget.value || null,
                    })
                  }
                >
                  <option value="">{t('Root', '根目录')}</option>
                  {folderOptions.map((folder) => {
                    let disabled = false;
                    if (dialog.target === 'folder') {
                      try {
                        moveWorkspaceFolder(files, dialog.id, folder.id);
                      } catch {
                        disabled = true;
                      }
                    }
                    return (
                      <option
                        key={folder.id}
                        value={folder.id}
                        disabled={disabled}
                      >
                        {folder.label}
                      </option>
                    );
                  })}
                </select>
              </label>
            )}
            {dialog?.kind === 'reference' && (
              <label>
                {t('Whiteboard', '画板')}
                <select
                  value={dialog.boardId}
                  onChange={(event) =>
                    setDialog({ ...dialog, boardId: event.currentTarget.value })
                  }
                >
                  {boards.map((board) => (
                    <option value={board.id} key={board.id}>
                      {board.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {dialog?.kind === 'summary' && (
              <label>
                {t('Source literature', '来源文献')}
                <select
                  value={dialog.sourceId}
                  onChange={(event) =>
                    setDialog({
                      ...dialog,
                      sourceId: event.currentTarget.value,
                    })
                  }
                >
                  <option value="">{t('Choose literature', '选择文献')}</option>
                  {files.contents
                    .filter((content) => content.role === 'literature')
                    .map((content) => (
                      <option value={content.id} key={content.id}>
                        {content.card.title}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {dialog?.kind === 'metadata' && (
              <>
                {metadataContent?.role === 'literature' && (
                  <>
                    <label>
                      {t('Authors · one per line', '作者 · 每行一位')}
                      <textarea
                        rows={3}
                        value={dialog.authors}
                        onChange={(event) =>
                          setDialog({
                            ...dialog,
                            authors: event.currentTarget.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      {t('Publication year', '发表年份')}
                      <input
                        inputMode="numeric"
                        maxLength={4}
                        placeholder={t('Not recorded', '未记录')}
                        value={dialog.year}
                        onChange={(event) =>
                          setDialog({
                            ...dialog,
                            year: event.currentTarget.value,
                          })
                        }
                      />
                    </label>
                  </>
                )}
                <label>
                  {t('Tags · separated by commas', '标签 · 用逗号分隔')}
                  <input
                    value={dialog.tags}
                    onChange={(event) =>
                      setDialog({ ...dialog, tags: event.currentTarget.value })
                    }
                  />
                </label>
              </>
            )}
            {error && (
              <p className="workspace-file-form-error" role="alert">
                {error}
              </p>
            )}
            <div className="workspace-file-dialog-actions">
              <button type="button" onClick={() => setDialog(null)}>
                {t('Cancel', '取消')}
              </button>
              <button
                type="submit"
                className={
                  dialog?.kind === 'recycle' || dialog?.kind === 'deleteFolder'
                    ? 'workspace-file-danger'
                    : 'workspace-file-primary'
                }
              >
                {dialog?.kind === 'recycle'
                  ? t('Move to Trash', '移入回收站')
                  : dialog?.kind === 'deleteFolder'
                    ? t('Delete folder', '删除文件夹')
                  : dialog?.kind === 'newFolder'
                    ? t('Create folder', '创建文件夹')
                    : dialog?.kind === 'move'
                      ? t('Move', '移动')
                      : dialog?.kind === 'reference'
                        ? t('Add reference', '添加引用')
                        : t('Save', '保存')}
              </button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
  return {
    home,
    sidebar,
    dialogs,
    newFolder,
    createBoard,
    createNotePage,
    importFiles,
    goHome,
    openFolder,
    addToBoard,
    editContentMetadata,
  };
}
