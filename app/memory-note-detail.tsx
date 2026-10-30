'use client';

import dynamic from 'next/dynamic';
import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowUpRight, CalendarDays, Check, FileText, PanelsTopLeft, Pencil, X } from 'lucide-react';
import { DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useI18n } from './i18n';
import type { LumiorMemory } from './memory-atlas-data';
import type { Card } from './canvas-model';
import './memory-note-detail.css';

const BlockEditor = dynamic(() => import('./block-editor'), { ssr: false });

export function MemoryNoteDetail({ memory, onLocate, onBeginEdit, onChange }: {
  memory: LumiorMemory;
  onLocate: (boardId: string, cardId: string) => void;
  onBeginEdit?: () => boolean;
  onChange?: (patch: Partial<Card>) => void;
}) {
  const { t, locale } = useI18n();
  const [editing, setEditing] = useState(false);
  const title = useRef<HTMLTextAreaElement>(null);
  const editable = editing && !!onChange;
  useLayoutEffect(() => {
    if (editable) title.current?.focus({ preventScroll: true });
  }, [editable]);
  useLayoutEffect(() => {
    if (!editable || !title.current) return;
    title.current.style.height = '0px';
    title.current.style.height = `${title.current.scrollHeight}px`;
  }, [editable, memory.card.title]);
  const beginEdit = () => {
    if (!onChange || onBeginEdit?.() === false) return;
    setEditing(true);
  };
  const parsedDate = new Date(`${memory.date}T12:00:00Z`);
  const date = Number.isFinite(parsedDate.getTime()) ? new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(parsedDate) : memory.date;

  return <DialogContent className={`memory-note-detail${editable ? ' is-editing' : ''}`} overlayClassName="memory-atlas-detail-overlay memory-note-overlay" showCloseButton={false}>
    <header className="memory-note-header">
      <div className="memory-note-toolbar">
        <span className="memory-note-type"><FileText size={15} strokeWidth={1.6} aria-hidden="true"/>{memory.card.kind === 'text' ? t('Text', '文本') : t('Note', '笔记')}</span>
        <div className="memory-note-actions">{onChange && <button type="button" className="memory-note-edit" aria-label={editable ? t('Finish editing note', '完成编辑') : t('Edit note', '编辑笔记')} onClick={editable ? () => setEditing(false) : beginEdit}>{editable ? <Check size={14} aria-hidden="true"/> : <Pencil size={14} aria-hidden="true"/>}<span>{editable ? t('Done', '完成') : t('Edit', '编辑')}</span></button>}<DialogClose className="memory-note-close" aria-label={t('Close note', '关闭笔记')}><X size={18} strokeWidth={1.7} aria-hidden="true"/></DialogClose></div>
      </div>
      <DialogTitle className={editable ? 'sr-only' : undefined}>{memory.card.title || t('Untitled', '未命名')}</DialogTitle>
      {editable && <textarea ref={title} rows={1} className="memory-note-title-input" aria-label={t('Note title', '笔记标题')} placeholder={t('Untitled', '未命名')} value={memory.card.title === 'Untitled' ? '' : memory.card.title} onChange={event => onChange?.({ title: event.target.value || 'Untitled' })}/>}
      <div className="memory-note-meta">
        <DialogDescription className="memory-note-date"><CalendarDays size={13} strokeWidth={1.5} aria-hidden="true"/><time dateTime={memory.date}>{date}</time>{memory.simulatedDate && <><span aria-hidden="true">·</span><span>{t('Simulated creation date', '模拟创建日期')}</span></>}</DialogDescription>
        <div className="memory-note-locations">{memory.locations.map(location => <button type="button" key={`${location.boardId}:${location.cardId}`} aria-label={t('Locate in {board}', '在画板“{board}”中定位', { board: location.boardTitle })} onClick={() => onLocate(location.boardId, location.cardId)}>
          <PanelsTopLeft size={12} strokeWidth={1.5} aria-hidden="true"/><span>{location.boardTitle}</span><ArrowUpRight size={12} strokeWidth={1.6} aria-hidden="true"/>
        </button>)}</div>
      </div>
    </header>
    <div className="memory-note-content"><BlockEditor card={memory.card} editable={editable} onChange={onChange}/></div>
  </DialogContent>;
}
