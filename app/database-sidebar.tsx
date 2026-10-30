'use client';
import { useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { useI18n } from './i18n';
import { RecentBoards } from './recent-boards';
import { partitionPinnedBoards } from './workspace-store';
import type { WorkspaceDatabase } from './database-model';

export function DatabaseSidebar({ databases, activeId, onNew, onOpen, onRename, onDuplicate, onDelete, onPin }: {
  databases: WorkspaceDatabase[];
  activeId: string | null;
  onNew: () => void;
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onPin: (id: string, pinned: boolean) => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const matching = databases.filter(database => database.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const { pinned, recent } = partitionPinnedBoards(matching);
  const actions = { onOpen, onRename, onDuplicate, onDelete, onPin };
  return <section className="workspace-board-panel workspace-database-panel" aria-label={t('Database sidebar', '多维表侧边栏')}>
    <div className="workspace-board-actions">
      <label className="workspace-board-search database-sidebar-search"><Search size={14} aria-hidden="true"/><input type="search" aria-label={t('Search databases', '搜索多维表')} placeholder={t('Search databases', '搜索多维表')} value={query} onChange={event => setQuery(event.target.value)}/></label>
      <button type="button" className="workspace-board-icon-button" aria-label={t('New database', '新建多维表')} title={t('New database', '新建多维表')} onClick={() => { setQuery(''); onNew(); }}><Plus size={18}/></button>
    </div>
    <div className="workspace-board-scroll">
      {pinned.length > 0 && <section className="workspace-board-section"><h2 className="workspace-board-list-label">{t('Pinned', '置顶')}</h2><RecentBoards entity="database" label={t('Pinned databases', '置顶多维表')} boards={pinned} activeId={activeId} {...actions}/></section>}
      <section className="workspace-board-section"><h2 className="workspace-board-list-label">{t('Databases', '多维表')}</h2><RecentBoards entity="database" label={t('Database list', '多维表列表')} boards={recent} activeId={activeId} {...actions}/></section>
      {!matching.length && <p className="workspace-board-empty">{databases.length ? t('No matching databases.', '没有匹配的多维表。') : t('Create a database to organize tasks, plans, and more.', '新建多维表，整理任务、计划与日常事务。')}</p>}
    </div>
  </section>;
}
