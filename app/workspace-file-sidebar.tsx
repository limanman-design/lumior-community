'use client';

import { useId, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import {
  BookOpen,
  FileText,
  Folder,
  FolderPlus,
  Image as ImageIcon,
  Layers2,
  MoreHorizontal,
  Video,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import type { HomeFileTreeProps } from './home-file-tree';
import {
  canMoveHomeFileTransfer,
  homeFileDragType,
  homeFileTreeAncestors,
  homeFileTreeEntries,
  type HomeFileTreeNode,
} from './home-file-tree-model';
import { canDragRecentContent, writeRecentContentDrag } from './recent-content-drag';
import { useI18n } from './i18n';
import { WorkspaceSidebarLabel } from './workspace-sidebar-label';
import './workspace-file-sidebar.css';
import './content-type-colors.css';

export type WorkspaceFileSidebarLeaf = Exclude<
  HomeFileTreeNode,
  { kind: 'folder' }
>;
export type WorkspaceFileSidebarProps = Pick<
  HomeFileTreeProps,
  | 'nodes'
  | 'expandedIds'
  | 'selectedId'
  | 'onToggle'
  | 'onSelect'
  | 'onOpen'
  | 'onMove'
  | 'canMove'
> & {
  pinned: readonly WorkspaceFileSidebarLeaf[];
  recent: readonly WorkspaceFileSidebarLeaf[];
  onNewFolder?: () => void;
  renderMenu?: (node: HomeFileTreeNode, context: boolean) => ReactNode;
};

function FileRow({
  node,
  selected,
  onOpen,
  renderMenu,
  dragging,
  dropTarget,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onDragLeave,
}: {
  node: HomeFileTreeNode;
  selected: boolean;
  onOpen: (node: HomeFileTreeNode) => void;
  renderMenu?: WorkspaceFileSidebarProps['renderMenu'];
  dragging?: boolean;
  dropTarget?: boolean;
  onDragStart?: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd?: () => void;
  onDragOver?: (event: DragEvent<HTMLButtonElement>) => void;
  onDrop?: (event: DragEvent<HTMLButtonElement>) => void;
  onDragLeave?: (event: DragEvent<HTMLButtonElement>) => void;
}) {
  const { t } = useI18n();
  const suppressDragClick = useRef(false);
  const openContextMenu = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!renderMenu || (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10'))) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, button: 2, clientX: rect.left + 24, clientY: rect.top + rect.height / 2,
    }));
  };
  const FileIcon =
    node.kind === 'folder'
      ? Folder
      : node.kind === 'literature'
      ? BookOpen
      : node.kind === 'board'
        ? Layers2
        : node.kind === 'video'
          ? Video
          : node.kind === 'image'
            ? ImageIcon
            : FileText;
  const row = (
    <li
      className="workspace-file-row"
      data-selected={selected || undefined}
      data-dragging={dragging || undefined}
      data-drop-target={dropTarget || undefined}
    >
      <button
        type="button"
        className="workspace-file-open"
        aria-current={selected ? 'page' : undefined}
        title={node.title}
        onClick={event => {
          if (suppressDragClick.current) {
            suppressDragClick.current = false;
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          onOpen(node);
        }}
        onPointerDown={() => { suppressDragClick.current = false; }}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') suppressDragClick.current = false;
          openContextMenu(event);
        }}
        draggable={!!onDragStart}
        onDragStart={onDragStart ? event => {
          suppressDragClick.current = true;
          onDragStart(event);
        } : undefined}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragLeave={onDragLeave}
      >
        <FileIcon
          size={16}
          strokeWidth={1.6}
          aria-hidden="true"
            data-file-kind={node.kind === 'folder' ? undefined : node.kind}
        />
        <WorkspaceSidebarLabel>{node.title}</WorkspaceSidebarLabel>
      </button>
      {renderMenu && (
        <DropdownMenu>
          <DropdownMenuTrigger
            className="workspace-file-more"
            onKeyDown={openContextMenu}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onDragLeave={onDragLeave}
            aria-label={t('More options for {title}', '{title} 的更多选项', {
              title: node.title,
            })}
          >
            <MoreHorizontal size={15} aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="lumior-menu" align="start">
            {renderMenu?.(node, false)}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
  if (!renderMenu) return row;
  return <ContextMenu>
    <ContextMenuTrigger render={row} />
    <ContextMenuContent className="lumior-menu workspace-file-context-menu">
      <ContextMenuItem onClick={() => onOpen(node)}>
        <FileIcon size={15} aria-hidden="true" />{t('Open', '打开')}
      </ContextMenuItem>
      <ContextMenuSeparator />
      {renderMenu(node, true)}
    </ContextMenuContent>
  </ContextMenu>;
}

/** The parent supplies identities and persisted state; this sidebar only presents them. */
export function WorkspaceFileSidebar({
  pinned,
  recent,
  onNewFolder,
  ...treeProps
}: WorkspaceFileSidebarProps) {
  const { t } = useI18n();
  const id = useId();
  const entries = homeFileTreeEntries(treeProps.nodes);
  const rootFolders = entries.filter(
    entry => entry.parentId === null && entry.node.kind === 'folder',
  );
  const selectedPath = new Set([
    ...homeFileTreeAncestors(entries, treeProps.selectedId),
    ...(treeProps.selectedId ? [treeProps.selectedId] : []),
  ]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [externalDragActive, setExternalDragActive] = useState(false);
  const [dropTargetId, setDropTargetId] = useState<string | null | undefined>();
  const allowedMove = (sourceId: string, folderId: string | null) =>
    !!treeProps.onMove && canMoveHomeFileTransfer(
      treeProps.nodes, sourceId, folderId, treeProps.canMove,
    );
  const clearDrag = () => {
    setDraggingId(null);
    setExternalDragActive(false);
    setDropTargetId(undefined);
  };
  const dragOver = (event: DragEvent, folderId: string | null) => {
    if (!treeProps.onMove || !event.dataTransfer.types.includes(homeFileDragType)) return;
    event.stopPropagation();
    // Protected drag data is unavailable until drop. Known rows retain the
    // complete tree's cycle checks; external rows require registry validation.
    if (draggingId ? !allowedMove(draggingId, folderId) : !treeProps.canMove) {
      event.dataTransfer.dropEffect = 'none';
      setDropTargetId(undefined);
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTargetId(folderId);
  };
  const drop = (event: DragEvent, folderId: string | null) => {
    if (!treeProps.onMove || !event.dataTransfer.types.includes(homeFileDragType)) return;
    event.preventDefault();
    event.stopPropagation();
    const sourceId = event.dataTransfer.getData(homeFileDragType);
    if (sourceId && sourceId.length <= 512 &&
      (!draggingId || sourceId === draggingId) && allowedMove(sourceId, folderId))
      treeProps.onMove(sourceId, folderId);
    clearDrag();
  };
  const fileRows = (items: readonly WorkspaceFileSidebarLeaf[], allowContentDrag = false) => (
    <ul className="workspace-file-short-list">
      {items.map((node) => (
        <FileRow
          key={node.id}
          node={node}
          selected={treeProps.selectedId === node.id}
          onOpen={treeProps.onOpen}
          renderMenu={treeProps.renderMenu}
          dragging={draggingId === node.id}
          onDragStart={allowContentDrag && canDragRecentContent(node) ? event => {
            event.stopPropagation();
            if (writeRecentContentDrag(event.dataTransfer, node)) setDraggingId(node.id);
          } : undefined}
          onDragEnd={clearDrag}
        />
      ))}
    </ul>
  );
  return (
    <div className="workspace-file-sidebar">
      {pinned.length > 0 && (
        <section
          className="workspace-file-section"
          aria-labelledby={id + '-pinned'}
        >
          <div className="workspace-file-section-heading">
            <h2 id={id + '-pinned'}>{t('Pinned', '置顶')}</h2>
          </div>
          {fileRows(pinned)}
        </section>
      )}
      <section
        className="workspace-file-section"
        aria-labelledby={id + '-folders'}
      >
        <div className="workspace-file-section-heading">
          <h2 id={id + '-folders'}>{t('Folders', '文件夹')}</h2>
          {onNewFolder && (
            <button
              type="button"
              className="workspace-file-add-folder"
              aria-label={t('New folder', '新建文件夹')}
              title={t('New folder', '新建文件夹')}
              onClick={onNewFolder}
            >
              <FolderPlus size={14} aria-hidden="true" />
            </button>
          )}
        </div>
        <div
          className="workspace-file-root-folders"
          onDragEnterCapture={event => {
            if (!draggingId && treeProps.onMove && treeProps.canMove &&
              event.dataTransfer.types.includes(homeFileDragType))
              setExternalDragActive(true);
          }}
          onDragLeaveCapture={event => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setExternalDragActive(false);
              setDropTargetId(undefined);
            }
          }}
        >
          <ul className="workspace-file-short-list" aria-label={t('Folders', '文件夹')}>
            {rootFolders.map(({ node }) => (
              <FileRow
                key={node.id}
                node={node}
                selected={selectedPath.has(node.id)}
                onOpen={treeProps.onSelect}
                renderMenu={treeProps.renderMenu}
                dragging={draggingId === node.id}
                dropTarget={dropTargetId === node.id}
                onDragStart={treeProps.onMove ? event => {
                  event.stopPropagation();
                  event.dataTransfer.setData(homeFileDragType, node.id);
                  event.dataTransfer.effectAllowed = 'move';
                  setDraggingId(node.id);
                } : undefined}
                onDragEnd={clearDrag}
                onDragOver={event => dragOver(event, node.id)}
                onDrop={event => drop(event, node.id)}
                onDragLeave={event => {
                  if (!event.currentTarget.closest('li')?.contains(event.relatedTarget as Node | null))
                    setDropTargetId(undefined);
                }}
              />
            ))}
          </ul>
          {!rootFolders.length && <p className="workspace-file-empty">{t('No folders yet', '暂无文件夹')}</p>}
          {(draggingId ? allowedMove(draggingId, null) : externalDragActive && treeProps.onMove && treeProps.canMove) && (
            <div
              className="workspace-file-root-drop"
              data-drop-target={dropTargetId === null || undefined}
              onDragOver={event => dragOver(event, null)}
              onDrop={event => drop(event, null)}
              onDragLeave={() => setDropTargetId(undefined)}
            >
              {t('Move to root', '移到根目录')}
            </div>
          )}
        </div>
      </section>
      <section
        className="workspace-file-section"
        aria-labelledby={id + '-recent'}
      >
        <div className="workspace-file-section-heading">
          <h2 id={id + '-recent'}>{t('Recent', '最近')}</h2>
        </div>
        {recent.length ? (
          fileRows(recent, true)
        ) : (
          <p className="workspace-file-empty">
            {t(
              'Your recently added or opened files appear here.',
              '最近新建、导入或打开的内容会显示在这里。',
            )}
          </p>
        )}
      </section>
    </div>
  );
}
