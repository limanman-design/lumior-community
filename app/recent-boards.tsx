'use client';
import { useI18n } from './i18n';
import { useEffect, useRef, useState } from 'react';
import { BoardActions } from './board-actions';
import { WorkspaceSidebarLabel } from './workspace-sidebar-label';

type BoardInfo = { id: string; title: string; pinnedAt?: number };
type Actions = {
  entity?: 'board' | 'database';
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onPin?: (id: string, pinned: boolean) => void;
};

function RecentBoardRow({
  board,
  active,
  onOpen,
  onRename,
  onDuplicate,
  onDelete,
  onPin,
  entity = 'board',
}: Actions & { board: BoardInfo; active: boolean }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(board.title);
  const finished = useRef(true);
  const openButton = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);
  const finish = (cancel = false, focus = false) => {
    if (finished.current) return;
    finished.current = true;
    if (!cancel && name.trim() && name.trim() !== board.title)
      onRename(board.id, name.trim());
    setEditing(false);
    if (focus) requestAnimationFrame(() => openButton.current?.focus());
  };
  return (
    <div className={`recent-board-row ${active ? 'active' : ''}`}>
      {editing ? (
        <input
          ref={input}
          className="recent-board-name"
          aria-label={entity === 'database' ? t('Database name', '多维表名称') : t('Recent whiteboard name', '最近画板名称')}
          maxLength={200}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => finish()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Enter' || e.key === 'Escape') {
              e.preventDefault();
              finish(e.key === 'Escape', true);
            }
          }}
        />
      ) : (
        <button
          ref={openButton}
          className="recent-board-open"
          onClick={() => onOpen(board.id)}
          title={board.title}
          aria-current={active ? 'page' : undefined}
        >
          <WorkspaceSidebarLabel className="recent-board-title">{board.title}</WorkspaceSidebarLabel>
        </button>
      )}
      <BoardActions
        pinned={board.pinnedAt !== undefined}
        onPin={
          onPin
            ? () => onPin(board.id, board.pinnedAt === undefined)
            : undefined
        }
        title={board.title}
        label={t('More options for {title}', '{title} 的更多选项', {
          title: board.title,
        })}
        className="recent-board-more"
        onOpen={() => onOpen(board.id)}
        onRename={() => {
          setName(board.title);
          finished.current = false;
          setEditing(true);
        }}
        onDuplicate={() => onDuplicate(board.id)}
        onDelete={() => onDelete(board.id)}
      />
    </div>
  );
}

export function RecentBoards({
  boards,
  activeId,
  label,
  ...actions
}: Actions & { boards: BoardInfo[]; activeId: string | null; label?: string }) {
  const { t } = useI18n();
  return (
    <nav
      className="sidebar-recents"
      aria-label={label || t('Recent whiteboards', '最近画板')}
    >
      {boards.map((board) => (
        <RecentBoardRow
          key={board.id}
          board={board}
          active={activeId === board.id}
          {...actions}
        />
      ))}
    </nav>
  );
}
