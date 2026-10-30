'use client';
/* oxlint-disable next/no-img-element -- Header uses the exact bundled navigation SVGs. */
import { useEffect, useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { FileText, House, Image as ImageIcon, Layers2, NotebookPen, Plus, StickyNote, TextQuote, Type, Video, X } from 'lucide-react';
import { useI18n } from './i18n';
import { useDesktopPlatform } from './desktop-bridge';
import { WindowsWindowMenus, WindowsCaptionButtons } from './windows-window-controls';
import type { BoardTab } from './use-board-tabs';
import './board-tabs.css';

const tabIcons = { board: Layers2, home: House, literature: FileText, notePage: NotebookPen, video: Video, image: ImageIcon, summary: TextQuote, note: StickyNote, text: Type };

export function BoardTabs({ boards, tabs, activeId, onSelect, onClose, onNew, newKind = 'board', onToggleSidebar, expandedSidebar, sidebarOpen = expandedSidebar, hasSidebar, onBack, onForward, canGoBack, canGoForward }: {
  boards: readonly BoardTab[];
  tabs: readonly string[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  newKind?: 'board' | 'database';
  onToggleSidebar: () => void;
  expandedSidebar: boolean;
  sidebarOpen?: boolean;
  hasSidebar: boolean;
  onBack: () => void;
  onForward: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
}) {
  const { t } = useI18n();
  const platform = useDesktopPlatform();
  const byId = new Map(boards.map(board => [board.id, board]));
  const visible = tabs.flatMap(id => { const board = byId.get(id); return board ? [board] : []; });
  const focusId = visible.some(board => board.id === activeId) ? activeId : visible[0]?.id;
  const tabButtons = useRef(new Map<string, HTMLButtonElement>());
  const trackRef = useRef<HTMLDivElement>(null);
  const newButton = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<{ id: string } | 'new' | null>(null);
  const visibleIdentities = JSON.stringify(visible.map(board => board.id));

  useEffect(() => {
    const track = trackRef.current;
    if (!activeId || !track) return;
    // Include the close button and follow changes to the window or sidebar width.
    const revealActiveTab = () => tabButtons.current.get(activeId)?.parentElement?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    revealActiveTab();
    const observer = new ResizeObserver(revealActiveTab);
    observer.observe(track);
    return () => observer.disconnect();
  }, [activeId, visibleIdentities]);

  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    if (target === 'new') newButton.current?.focus();
    else (tabButtons.current.get(target.id) ?? newButton.current)?.focus();
  }, [visibleIdentities]);

  const close = (id: string) => {
    const index = visible.findIndex(board => board.id === id);
    const focused = document.activeElement;
    const row = tabButtons.current.get(id)?.parentElement;
    if (focused && row?.contains(focused)) {
      const nextId = visible[index + 1]?.id ?? visible[index - 1]?.id;
      pendingFocus.current = nextId ? { id: nextId } : 'new';
    }
    onClose(id);
  };

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, id: string) => {
    const index = visible.findIndex(board => board.id === id);
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % visible.length;
    else if (event.key === 'ArrowLeft') next = (index + visible.length - 1) % visible.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = visible.length - 1;
    else if (event.key === 'Delete') { event.preventDefault(); event.stopPropagation(); close(id); return; }
    else return;
    event.preventDefault();
    event.stopPropagation();
    const nextId = visible[next].id;
    onSelect(nextId);
    tabButtons.current.get(nextId)?.focus();
  };

  return <div className="board-tabs" data-sidebar-expanded={hasSidebar && expandedSidebar} data-has-sidebar={hasSidebar} data-platform={platform ?? 'browser'}>
    <div className="board-tabs-navigation" aria-label={t('Navigation history', '浏览历史')}>
      <button type="button" className="board-tabs-back" aria-label={t('Back', '后退')} title={t('Back', '后退')} onClick={onBack} disabled={!canGoBack}><img src="/assets/workspace-shell/back.svg" width={16} height={16} alt="" aria-hidden="true" /></button>
      <button type="button" className="board-tabs-forward" aria-label={t('Forward', '前进')} title={t('Forward', '前进')} onClick={onForward} disabled={!canGoForward}><img src="/assets/workspace-shell/back.svg" width={16} height={16} alt="" aria-hidden="true" /></button>
      {hasSidebar && <button type="button" className="board-tabs-sidebar" aria-expanded={sidebarOpen} aria-label={sidebarOpen ? t('Collapse sidebar', '收起侧边栏') : t('Expand sidebar', '展开侧边栏')} title={sidebarOpen ? t('Collapse sidebar', '收起侧边栏') : t('Expand sidebar', '展开侧边栏')} onClick={onToggleSidebar}><img src="/assets/workspace-shell/sidebar-toggle.svg" width={16} height={16} alt="" aria-hidden="true" /></button>}
      {platform === 'win32' && <WindowsWindowMenus />}
    </div>
    <div className="board-tabs-content">
    <div ref={trackRef} className="board-tabs-track" role="tablist" aria-label={t('Open tabs', '已打开的标签页')} onWheel={event => {
      const track = event.currentTarget;
      if (event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX) || track.scrollWidth <= track.clientWidth) return;
      event.preventDefault();
      track.scrollLeft += event.deltaY;
    }}>
      {visible.map(board => {
        const Icon = board.kind === 'database' ? null : tabIcons[board.kind || 'board'];
        const title = board.kind === 'home' ? t('Home', '首页') : board.title || t('Untitled', '未命名');
        return <div key={board.id} className={`board-tabs-item${activeId === board.id ? ' is-active' : ''}`} role="presentation" data-kind={board.kind || 'board'}>
        <button type="button" role="tab" ref={element => { if (element) tabButtons.current.set(board.id, element); else tabButtons.current.delete(board.id); }} aria-selected={activeId === board.id} tabIndex={focusId === board.id ? 0 : -1} title={title} className="board-tabs-select" onClick={() => onSelect(board.id)} onKeyDown={event => onTabKey(event, board.id)}>{board.kind === 'database' ? <img src={`/assets/workspace-shell/table-${activeId === board.id ? 'filled' : 'outline'}.svg`} width={16} height={16} alt="" aria-hidden="true" draggable={false} style={{ flex: '0 0 16px' }}/> : Icon && <Icon size={16} aria-hidden="true"/>}<span>{title}</span></button>
        <button type="button" className="board-tabs-close" aria-label={t('Close tab: {title}', '关闭标签：{title}', { title })} title={t('Close tab', '关闭标签')} tabIndex={focusId === board.id ? 0 : -1} onClick={() => close(board.id)}><X size={12} aria-hidden="true" /></button>
      </div>;
      })}
      {!visible.length && <span className="board-tabs-empty">{t('Whiteboards', '画板')}</span>}
    </div>
    <button type="button" ref={newButton} className="board-tabs-new" aria-label={newKind==='database'?t('New database','新建多维表'):t('New whiteboard', '新建画板')} title={newKind==='database'?t('New database','新建多维表'):t('New whiteboard', '新建画板')} onClick={onNew}><Plus size={16} aria-hidden="true" /></button>
    </div>
    {platform === 'win32' && <WindowsCaptionButtons />}
  </div>;
}
