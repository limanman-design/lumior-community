'use client';
import { useState } from 'react';
import dynamic from 'next/dynamic';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useI18n } from './i18n';
import { MaterialIcon } from './material-icon';
import './canvas-selection-toolbar.css';
import type { WorkspaceFiles } from './workspace-files';
import type { Board } from './canvas-model';
import type { DailyConnection } from './daily-connections';
import { DailyBoardPreview, type DailyPreviewRenderer } from './daily-board-preview';
const DailySourcePreview = dynamic(() => import('./daily-source-preview').then(module => module.DailySourcePreview), { ssr: false });
import './daily-connection-dialog.css';

type Props = { connections: DailyConnection[]; initialId: string; files: WorkspaceFiles; boards: Board[]; busy: boolean; onClose: () => void; onOpen: (id: string) => void; onOpenBoard: (id: string) => void; onLink: (connection: DailyConnection) => void; onDismiss: (connection: DailyConnection) => void; renderCard: DailyPreviewRenderer };
export function DailyConnectionDialog({ connections, initialId, files, boards, busy, onClose, onOpen, onOpenBoard, onLink, onDismiss, renderCard }: Props) {
  const { t } = useI18n();
  const [activeId, setActiveId] = useState(initialId);
  const active = connections.find(item => item.id === activeId) || connections[0];
  const group = connections.filter(item => item.contentId === active?.contentId);
  const foundIndex = group.findIndex(item => item.id === active?.id);
  const index = foundIndex < 0 ? 0 : foundIndex;
  const source = files.contents.find(item => item.id === active?.contentId)?.card;
  const board = boards.find(item => item.id === active?.boardId);
  if (!active || !source) return null;
  const sourcePanel = <section className="daily-relation-source-pane" aria-label={t('New Daily content', '日常新内容')}>
    <DialogTitle className="sr-only">{t('Possible connections', '潜在联系')}</DialogTitle>
    <div className="daily-source-reader"><DailySourcePreview card={source} page={active.example ? active.captureEvidence?.page : undefined} quote={active.example ? active.captureEvidence?.quote || active.captureQuote : active.captureQuote} onOpen={() => onOpen(active.contentId)} />
    <div className="daily-source-actions canvas-selection-toolbar" role="toolbar" aria-label={t('Connection actions', '关联操作')}>{group.length > 1 && <div className="daily-relation-switch"><button type="button" disabled={index === 0} aria-label={t('Previous connection', '上一条关联')} onClick={() => setActiveId(group[index - 1].id)}><ChevronLeft size={16} /></button><span>{index + 1}/{group.length}</span><button type="button" disabled={index === group.length - 1} aria-label={t('Next connection', '下一条关联')} onClick={() => setActiveId(group[index + 1].id)}><ChevronRight size={16} /></button></div>}<button type="button" className="canvas-selection-chat" disabled={busy || !board} onClick={() => onLink(active)}><MaterialIcon name="library_add" size={20} />{t('Add to board', '加入画板')}</button><span className="tool-divider" aria-hidden="true" /><button type="button" className="daily-relation-dismiss" disabled={busy} onClick={() => onDismiss(active)}><MaterialIcon name="schedule" size={20} />{t('Dismiss', '暂不提醒')}</button></div></div>
  </section>;
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="daily-relation-dialog" data-daily-ui aria-describedby={undefined}>
      <DailyBoardPreview key={board?.id || active.boardId} board={board || {id:active.boardId,title:active.boardTitle,cards:[],edges:[]}} sourceId={active.sourceId} renderCard={renderCard} onOpenBoard={board ? () => onOpenBoard(board.id) : undefined} sourcePanel={sourcePanel} />
    </DialogContent>
  </Dialog>;
}
