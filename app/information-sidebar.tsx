'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Check, ChevronDown, ChevronRight, FileText, ImageIcon, Maximize2, PanelRightClose, Plus, Search, StickyNote, Type, Video, X } from 'lucide-react';
import type { Board, Card, CardVideo } from './canvas-model';
import { cardName } from './card-name';
import { useI18n } from './i18n';
import { ImageCardContent } from './image-card';
import PdfViewer from './pdf-viewer';
import { PdfExcerptQuote } from './pdf-excerpt-card';
import { usePdfAnnotations } from './pdf-annotations';
import { VideoViewer } from './video-player';
import { searchInformationSidebarCards, type InformationSidebarEntry } from './information-sidebar-model';
import './information-sidebar.css';
import { DeferredCardContent } from './deferred-card-content';

const BlockEditor = dynamic(() => import('./block-editor'), { ssr: false });

export type InformationSidebarProps = {
  entries: InformationSidebarEntry[];
  allBoards: Board[];
  onRemove: (key: string) => void;
  onClose: () => void;
  onAdd: (boardId: string, cardId: string) => void;
  onChange: (boardId: string, cardId: string, patch: Partial<Card>) => void;
  onExpand: (boardId: string, cardId: string) => void;
  onVideoChange?: (boardId: string, cardId: string, patch: Partial<Card>, expectedVideo: CardVideo) => boolean;
  onNoteChange?: (boardId: string, cardId: string, markId: string, note: string) => void;
  onExpandTranslate?: (boardId: string, cardId: string) => void;
  activeEntryKey?: string;
};

function CardTypeIcon({ card }: { card: Card }) {
  if (card.pdfExcerpt || card.kind === 'pdf') return <FileText aria-hidden="true" />;
  if (card.kind === 'image') return <ImageIcon aria-hidden="true" />;
  if (card.kind === 'video') return <Video aria-hidden="true" />;
  if (card.kind === 'text') return <Type aria-hidden="true" />;
  return <StickyNote aria-hidden="true" />;
}

function ImageSidebarNote({ card, onChange }: { card: Card; onChange: (patch: Partial<Card>) => void }) {
  const { t } = useI18n();
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!input.current) return;
    input.current.style.height = '0px';
    input.current.style.height = `${Math.max(76, input.current.scrollHeight)}px`;
  }, [card.body]);
  return <textarea ref={input} className="information-image-note" aria-label={t('Image note', '图片笔记')}
    placeholder={t('Write your thoughts about this image…', '写下你对这张图片的想法…')}
    value={card.body} rows={3} onChange={event => onChange({ body: event.target.value })} />;
}

function InformationCard({ entry, allBoards, onChange, onExpand, onVideoChange, onNoteChange, onExpandTranslate }: {
  entry: InformationSidebarEntry;
} & Pick<InformationSidebarProps, 'allBoards' | 'onChange' | 'onExpand' | 'onVideoChange' | 'onNoteChange' | 'onExpandTranslate'>) {
  const { card, boardId } = entry;
  const annotations = usePdfAnnotations();
  const change = (patch: Partial<Card>) => onChange(boardId, card.id, patch);
  if (card.kind === 'pdf' && card.pdf) return <div className="information-pdf-reader">
    <PdfViewer card={card} pageFlow="horizontal" showReadingNotes={false} initialPage={entry.initialPage} focusRequest={entry.focusRequest} focusMark={entry.focusMark}
      excerptCards={allBoards.flatMap(board => board.cards)}
      onNoteChange={(markId, note) => onNoteChange?.(boardId, card.id, markId, note)}
      onCardChange={(cardId, patch) => {
        const owner = allBoards.find(board => board.cards.some(item => item.id === cardId));
        if (owner) onChange(owner.id, cardId, patch);
      }}
      onExpandTranslate={onExpandTranslate ? () => onExpandTranslate(boardId, card.id) : undefined} />
  </div>;
  if (card.kind === 'video' && card.video) return <div className="information-video-reader">
    <VideoViewer card={card} onChange={onVideoChange ? (patch, expectedVideo) => onVideoChange(boardId, card.id, patch, expectedVideo) : undefined} />
  </div>;
  if (card.kind === 'image' && !card.pdfExcerpt) return <>
    <ImageCardContent card={{ ...card, body: '' }} mode="sidebar" onChange={change} onExpand={() => onExpand(boardId, card.id)} />
    <ImageSidebarNote card={card} onChange={change} />
  </>;
  const mark = card.pdfExcerpt ? annotations.marks[card.pdfExcerpt.pdf.url]?.find(mark => mark.id === card.pdfExcerpt!.mark.id) : undefined;
  return <div className="information-document">
    {card.pdfExcerpt && <PdfExcerptQuote card={card} mark={mark} />}
    <BlockEditor card={card} editable onChange={change} />
  </div>;
}

export function InformationSidebar(props: InformationSidebarProps) {
  const { entries, allBoards, onRemove, onClose, onAdd, onChange, onExpand, activeEntryKey } = props;
  const { t } = useI18n();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const container = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const entryKeys = useMemo(() => new Set(entries.map(entry => entry.key)), [entries]);
  const results = useMemo(() => searchOpen ? searchInformationSidebarCards(allBoards, query) : [], [searchOpen, allBoards, query]);
  const focusToken = useMemo(() => {
    const entry = entries.find(entry => entry.key === activeEntryKey);
    return entry?.focusRequest || entry?.focusMark || activeEntryKey;
  }, [entries, activeEntryKey]);
  useEffect(() => {
    if (!activeEntryKey) return;
    setCollapsed(previous => {
      if (!previous.has(activeEntryKey)) return previous;
      const next = new Set(previous); next.delete(activeEntryKey); return next;
    });
    const frame = requestAnimationFrame(() => {
      const item = [...(container.current?.querySelectorAll<HTMLElement>('[data-information-entry]') || [])].find(item => item.dataset.informationEntry === activeEntryKey);
      if (item && container.current) container.current.scrollTo({ top: item.offsetTop - container.current.offsetTop - 8, behavior: 'instant' });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeEntryKey, focusToken]);
  useEffect(() => { if (searchOpen) searchInput.current?.focus(); }, [searchOpen]);
  return <aside className="card-side-panel information-sidebar" aria-label={t('Information sidebar', '信息侧边栏')} data-information-sidebar="true">
    <header className="information-sidebar-header">
      <div><button type="button" data-information-action="add" className={searchOpen ? 'is-active' : ''}
        aria-label={t('Add cards to sidebar', '添加卡片到侧边栏')} aria-expanded={searchOpen}
        onClick={() => { setSearchOpen(open => !open); setQuery(''); }}><Plus size={18} /></button>
        <h2>{t('Information', '信息')}</h2><span className="information-sidebar-count">{entries.length || ''}</span></div>
      <button type="button" aria-label={t('Collapse sidebar', '收起侧边栏')} onClick={onClose}><PanelRightClose size={18} /></button>
    </header>
    {searchOpen && <section className="information-sidebar-search" aria-label={t('Find cards to add', '查找要添加的卡片')}>
      <label><Search size={16} aria-hidden="true" /><input ref={searchInput} value={query}
        aria-label={t('Search all cards', '搜索所有卡片')} placeholder={t('Search by name or content…', '搜索名称或内容…')}
        onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setSearchOpen(false); } }} />
        <button type="button" aria-label={t('Close search', '关闭搜索')} onClick={() => setSearchOpen(false)}><X size={15} /></button></label>
      <div className="information-search-results">
        {results.map(result => <button key={result.key} type="button" disabled={entryKeys.has(result.key)}
          onClick={() => onAdd(result.boardId, result.card.id)}>
          <CardTypeIcon card={result.card} /><span><strong>{cardName(result.card)}</strong><small>{result.boardTitle}</small></span>
          {entryKeys.has(result.key) ? <Check size={15} aria-label={t('Already in sidebar', '已在侧边栏中')} /> : <Plus size={15} aria-hidden="true" />}
        </button>)}
        {!results.length && <p>{t('No matching cards. Try another word.', '没有匹配的卡片，试试其他关键词。')}</p>}
      </div>
    </section>}
    <div className="information-sidebar-scroll" ref={container}>
      {!entries.length && <div className="information-sidebar-empty"><FileText size={28} /><strong>{t('Keep useful cards together', '把需要的资料放在一起')}</strong>
        <p>{t('Add cards with + above, or choose Add to sidebar on a card. You can read and write here while keeping your whiteboard open.', '点击上方 ＋ 搜索卡片，或在卡片上选择「添加到侧边栏」。在这里阅读和记录，随时对照画板。')}</p>
        <button type="button" onClick={() => setSearchOpen(true)}><Plus size={16} />{t('Add a card', '添加卡片')}</button></div>}
      {entries.map(entry => {
        const isCollapsed = collapsed.has(entry.key);
        const titleEditable = !entry.card.pdfExcerpt && (entry.card.kind === 'note' || entry.card.kind === 'text');
        return <section key={entry.key} className={`information-sidebar-item information-type-${entry.card.kind}${entry.card.pdfExcerpt ? ' information-type-excerpt' : ''}`}
          data-information-entry={entry.key} data-card-id={entry.card.id} data-board-id={entry.boardId} data-collapsed={isCollapsed}>
          <header className="information-item-header">
            <button type="button" className="information-item-toggle" aria-label={isCollapsed ? t('Expand {title}', '展开 {title}', { title: cardName(entry.card) }) : t('Collapse {title}', '收起 {title}', { title: cardName(entry.card) })}
              aria-expanded={!isCollapsed} onClick={() => setCollapsed(previous => { const next = new Set(previous); if (next.has(entry.key)) next.delete(entry.key); else next.add(entry.key); return next; })}>
              {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}<CardTypeIcon card={entry.card} /></button>
            {titleEditable ? <input className="information-item-title" value={entry.card.title} aria-label={t('Card title', '卡片标题')}
              placeholder={t('Untitled', '未命名')} onChange={event => onChange(entry.boardId, entry.card.id, { title: event.target.value })} />
              : <button type="button" className="information-item-name" title={cardName(entry.card)} onClick={() => onExpand(entry.boardId, entry.card.id)}>{cardName(entry.card)}</button>}
            <button type="button" className="information-item-expand" aria-label={t('Preview {title}', '预览 {title}', { title: cardName(entry.card) })} onClick={() => onExpand(entry.boardId, entry.card.id)}><Maximize2 size={14} /></button>
            <button type="button" className="information-item-remove" aria-label={t('Remove {title} from sidebar', '从侧边栏移除 {title}', { title: cardName(entry.card) })} onClick={() => onRemove(entry.key)}><X size={16} /></button>
          </header>
          {!isCollapsed && <div className="information-item-body"><DeferredCardContent surface="sidebar" eager={entry.key === activeEntryKey}>{() => <InformationCard {...props} entry={entry} />}</DeferredCardContent></div>}
        </section>;
      })}
    </div>
  </aside>;
}
