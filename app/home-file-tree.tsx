'use client';
/* oxlint-disable jsx-a11y/prefer-tag-over-role -- ARIA tree groups require nested lists, not fieldsets. */

import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import {
  BookOpen,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  Layers2,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  FolderInput,
  Trash2,
  Video,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useI18n } from './i18n';
import {
  canMoveHomeFileTransfer,
  homeFileDragType,
  homeFileTreeAncestors,
  homeFileTreeEntries,
  homeFileTreeKeyAction,
  type HomeFileTreeEntry,
  type HomeFileTreeNode,
} from './home-file-tree-model';
import './home-file-tree.css';
import './content-type-colors.css';

export type { HomeFileTreeNode } from './home-file-tree-model';
export type HomeFileTreeAction = 'rename' | 'move' | 'pin' | 'unpin' | 'delete';
export type HomeFileTreeProps = {
  nodes: readonly HomeFileTreeNode[];
  expandedIds: readonly string[];
  selectedId: string | null;
  onToggle: (id: string, expanded: boolean) => void;
  onSelect: (node: HomeFileTreeNode) => void;
  onOpen: (node: HomeFileTreeNode) => void;
  onAction?: (node: HomeFileTreeNode, action: HomeFileTreeAction) => void;
  onMove?: (id: string, folderId: string | null) => void;
  canMove?: (id: string, folderId: string | null) => boolean;
  ariaLabel?: string;
  emptyMessage?: string;
  className?: string;
};

function FileIcon({
  node,
  expanded,
}: {
  node: HomeFileTreeNode;
  expanded: boolean;
}) {
  const props = { size: 16, strokeWidth: 1.6, 'aria-hidden': true as const };
  if (node.kind === 'folder')
    return expanded ? <FolderOpen {...props} /> : <Folder {...props} />;
  if (node.kind === 'literature') return <BookOpen {...props} />;
  if (node.kind === 'board') return <Layers2 {...props} />;
  if (node.kind === 'video') return <Video {...props} />;
  if (node.kind === 'image') return <ImageIcon {...props} />;
  return <FileText {...props} />;
}

/** Presentation only: selection, expansion and accepted moves belong to the caller. */
export function HomeFileTree({
  nodes,
  expandedIds,
  selectedId,
  onToggle,
  onSelect,
  onOpen,
  onAction,
  onMove,
  canMove,
  ariaLabel,
  emptyMessage,
  className = '',
}: HomeFileTreeProps) {
  const { t } = useI18n();
  const all = useMemo(() => homeFileTreeEntries(nodes), [nodes]);
  const visible = useMemo(
    () => homeFileTreeEntries(nodes, expandedIds),
    [nodes, expandedIds],
  );
  const byId = useMemo(
    () => new Map(all.map((entry) => [entry.node.id, entry])),
    [all],
  );
  const visibleIds = new Set(visible.map((entry) => entry.node.id));
  const selectedPath = new Set([
    ...homeFileTreeAncestors(all, selectedId),
    ...(selectedId ? [selectedId] : []),
  ]);
  const [focusedId, setFocusedId] = useState<string | null>(selectedId);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [externalDragActive, setExternalDragActive] = useState(false);
  const [dropTargetId, setDropTargetId] = useState<string | null | undefined>();
  const root = useRef<HTMLUListElement>(null),
    hasFocus = useRef(false);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const actionRefs = useRef(new Map<string, HTMLButtonElement>());
  const focusedAncestor = homeFileTreeAncestors(all, focusedId).find((id) =>
    visibleIds.has(id),
  );
  const tabId =
    focusedId && visibleIds.has(focusedId)
      ? focusedId
      : focusedAncestor ||
        (selectedId && visibleIds.has(selectedId)
          ? selectedId
          : visible[0]?.node.id);

  useLayoutEffect(() => {
    if (
      hasFocus.current &&
      tabId &&
      (!root.current?.contains(document.activeElement) ||
        document.activeElement?.getAttribute('role') === 'treeitem')
    )
      rowRefs.current.get(tabId)?.focus();
  }, [tabId]);

  const focus = (id: string) => {
    setFocusedId(id);
    rowRefs.current.get(id)?.focus();
  };
  const select = (node: HomeFileTreeNode) => {
    focus(node.id);
    onSelect(node);
  };
  const onKey = (
    event: KeyboardEvent<HTMLLIElement>,
    node: HomeFileTreeNode,
  ) => {
    if (event.target !== event.currentTarget || event.nativeEvent.isComposing)
      return;
    if (
      onAction &&
      (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))
    ) {
      event.preventDefault();
      event.stopPropagation();
      actionRefs.current.get(node.id)?.click();
      return;
    }
    const action = homeFileTreeKeyAction(
      visible,
      node.id,
      event.key,
      expandedIds,
    );
    if (!action || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    event.stopPropagation();
    if (action.focusId) focus(action.focusId);
    if (action.toggle) onToggle(action.toggle.id, action.toggle.expanded);
    if (action.selectId) onSelect(node);
    if (action.openId) onOpen(node);
  };
  const allowedMove = (id: string, targetId: string | null) =>
    !!onMove && canMoveHomeFileTransfer(nodes, id, targetId, canMove);
  const dragOver = (event: DragEvent, targetId: string | null) => {
    if (!onMove || !event.dataTransfer.types.includes(homeFileDragType)) return;
    event.stopPropagation();
    const validTarget =
      targetId === null || byId.get(targetId)?.node.kind === 'folder';
    // Drag data is protected until drop. External rows must have a registry
    // permission callback, and their identity is validated when it can be read.
    if (
      !validTarget ||
      (draggingId ? !allowedMove(draggingId, targetId) : !canMove)
    ) {
      event.dataTransfer.dropEffect = 'none';
      setDropTargetId(undefined);
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTargetId(targetId);
  };
  const drop = (event: DragEvent, targetId: string | null) => {
    if (!onMove || !event.dataTransfer.types.includes(homeFileDragType)) return;
    event.preventDefault();
    event.stopPropagation();
    const sourceId = event.dataTransfer.getData(homeFileDragType);
    if (
      sourceId &&
      sourceId.length <= 512 &&
      (!draggingId || sourceId === draggingId) &&
      allowedMove(sourceId, targetId)
    )
      onMove(sourceId, targetId);
    setDraggingId(null);
    setExternalDragActive(false);
    setDropTargetId(undefined);
  };

  const renderEntry = (entry: HomeFileTreeEntry) => {
    const { node } = entry,
      expanded = node.kind === 'folder' && expandedIds.includes(node.id);
    // Use the indexed children so malformed duplicate identities never render twice.
    const childIds = new Set<string>();
    const children =
      node.kind === 'folder'
        ? node.children.flatMap((child) => {
            const indexed = byId.get(child.id);
            if (
              childIds.has(child.id) ||
              indexed?.parentId !== node.id ||
              indexed.node !== child
            )
              return [];
            childIds.add(child.id);
            return [indexed];
          })
        : [];
    return (
      <li
        key={node.id}
        role="treeitem"
        aria-label={node.title}
        aria-level={entry.depth}
        aria-posinset={entry.position}
        aria-setsize={entry.setSize}
        aria-selected={selectedId === node.id}
        aria-expanded={node.kind === 'folder' ? expanded : undefined}
        tabIndex={tabId === node.id ? 0 : -1}
        ref={(element) => {
          if (element) rowRefs.current.set(node.id, element);
          else rowRefs.current.delete(node.id);
        }}
        className={`home-file-tree-item${selectedPath.has(node.id) ? ' is-path' : ''}`}
        onFocus={(event) => {
          if (event.target === event.currentTarget) setFocusedId(node.id);
        }}
        onKeyDown={(event) => onKey(event, node)}
        onClick={(event) => {
          if (
            (event.target as Element).closest('[role="treeitem"]') ===
            event.currentTarget
          )
            select(node);
        }}
        onDoubleClick={(event) => {
          if (
            node.kind !== 'folder' &&
            (event.target as Element).closest('[role="treeitem"]') ===
              event.currentTarget
          )
            onOpen(node);
        }}
      >
        <div
          className="home-file-tree-row"
          data-selected={selectedId === node.id || undefined}
          data-drop-target={dropTargetId === node.id || undefined}
          data-dragging={draggingId === node.id || undefined}
          draggable={!!onMove}
          onDragStart={(event) => {
            event.stopPropagation();
            if (!onMove) return;
            event.dataTransfer.setData(homeFileDragType, node.id);
            event.dataTransfer.effectAllowed = 'move';
            setDraggingId(node.id);
          }}
          onDragEnd={() => {
            setDraggingId(null);
            setDropTargetId(undefined);
          }}
          onDragOver={(event) => {
            if (node.kind === 'folder') dragOver(event, node.id);
          }}
          onDrop={(event) => {
            if (node.kind === 'folder') drop(event, node.id);
          }}
          onDragLeave={(event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            )
              setDropTargetId(undefined);
          }}
        >
          {node.kind === 'folder' ? (
            <button
              type="button"
              className="home-file-tree-toggle"
              tabIndex={-1}
              aria-label={
                expanded
                  ? t('Collapse {title}', '收起 {title}', { title: node.title })
                  : t('Expand {title}', '展开 {title}', { title: node.title })
              }
              onClick={(event) => {
                event.stopPropagation();
                focus(node.id);
                onToggle(node.id, !expanded);
              }}
              onDoubleClick={(event) => event.stopPropagation()}
            >
              <ChevronRight size={12} aria-hidden="true" />
            </button>
          ) : (
            <span className="home-file-tree-toggle-space" aria-hidden="true" />
          )}
          <span
            className="home-file-tree-icon"
            data-file-kind={node.kind === 'folder' ? undefined : node.kind}
          >
            <FileIcon node={node} expanded={expanded} />
          </span>
          <span className="home-file-tree-title" title={node.title}>
            {node.title}
          </span>
          {onAction && (
            <DropdownMenu>
              <DropdownMenuTrigger
                className="home-file-tree-more"
                tabIndex={-1}
                aria-label={t(
                  'More options for {title}',
                  '{title} 的更多选项',
                  { title: node.title },
                )}
                ref={(element) => {
                  if (element) actionRefs.current.set(node.id, element);
                  else actionRefs.current.delete(node.id);
                }}
                onClick={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
              >
                <MoreHorizontal size={15} aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="lumior-menu"
                align="start"
                onClick={(event) => event.stopPropagation()}
              >
                <DropdownMenuItem onClick={() => onAction(node, 'rename')}>
                  <Pencil size={15} aria-hidden="true" />
                  {t('Rename', '重命名')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onAction(node, 'move')}>
                  <FolderInput size={15} aria-hidden="true" />
                  {t('Move to…', '移动到…')}
                </DropdownMenuItem>
                {node.kind !== 'folder' && (
                  <DropdownMenuItem
                    onClick={() =>
                      onAction(node, node.pinned ? 'unpin' : 'pin')
                    }
                  >
                    {node.pinned ? (
                      <PinOff size={15} aria-hidden="true" />
                    ) : (
                      <Pin size={15} aria-hidden="true" />
                    )}
                    {node.pinned ? t('Unpin', '取消置顶') : t('Pin', '置顶')}
                  </DropdownMenuItem>
                )}
                {node.kind === 'board' && <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => onAction(node, 'delete')}>
                    <Trash2 size={15} aria-hidden="true" />
                    {t('Move to Trash', '移入回收站')}
                  </DropdownMenuItem>
                </>}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {node.kind === 'folder' && (
          <div className="home-file-tree-fold" data-expanded={expanded}>
            <div className="home-file-tree-fold-inner" inert={!expanded}>
              <ul
                className="home-file-tree-group"
                role="group"
                aria-hidden={!expanded}
              >
                {children.map(renderEntry)}
              </ul>
            </div>
          </div>
        )}
      </li>
    );
  };

  return (
    <div
      className={`home-file-tree ${className}`}
      onDragEnterCapture={(event) => {
        if (
          !draggingId &&
          onMove &&
          canMove &&
          event.dataTransfer.types.includes(homeFileDragType)
        )
          setExternalDragActive(true);
      }}
      onDragLeaveCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setExternalDragActive(false);
          setDropTargetId(undefined);
        }
      }}
    >
      <ul
        ref={root}
        role="tree"
        aria-label={ariaLabel || t('Folders and files', '文件夹和文件')}
        className="home-file-tree-root"
        onFocusCapture={() => {
          hasFocus.current = true;
        }}
        onBlurCapture={(event) => {
          hasFocus.current =
            !!event.relatedTarget &&
            event.currentTarget.contains(event.relatedTarget as Node);
        }}
      >
        {all.filter((entry) => entry.parentId === null).map(renderEntry)}
      </ul>
      {!all.length && (
        <p className="home-file-tree-empty">
          {emptyMessage || t('No folders yet', '暂无文件夹')}
        </p>
      )}
      {(draggingId
        ? allowedMove(draggingId, null)
        : externalDragActive && !!onMove && !!canMove) && (
        <div
          className="home-file-tree-root-drop"
          data-drop-target={dropTargetId === null || undefined}
          onDragOver={(event) => dragOver(event, null)}
          onDrop={(event) => drop(event, null)}
          onDragLeave={() => setDropTargetId(undefined)}
        >
          {t('Move to root', '移到根目录')}
        </div>
      )}
    </div>
  );
}
