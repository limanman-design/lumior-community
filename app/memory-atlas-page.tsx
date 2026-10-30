'use client';
import { useI18n } from './i18n';
import { translateSystemMessage } from './i18n-core';
/* oxlint-disable next/no-img-element */
import { useCallback, useMemo, useState, type CSSProperties } from 'react';
import dynamic from 'next/dynamic';
import type { Board, Card } from './canvas-model';
import { mapMemoryAtlas, type LumiorMemory } from './memory-atlas-data';
import { MemoryAtlasView } from './memory-atlas-view';
import { MemoryNoteDetail } from './memory-note-detail';
import { resolveAtlasSelection } from './memory-atlas-selection';
import type { MemoryAtlasSelection } from './vendor/memory-atlas/types';
import './board-chrome.css';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ImageCardContent } from './image-card';
import { VideoViewer } from './video-player';
import './memory-atlas.css';
const BlockEditor = dynamic(() => import('./block-editor'), { ssr: false });
const PdfViewer = dynamic(() => import('./pdf-viewer'), { ssr: false });

export default function MemoryAtlasPage({ boards, activeBoardId, sidebarOpen, onExpandSidebar, onClose, onLocate, onEditMemory, onBeginEditMemory }: {
  boards: Board[]; activeBoardId: string; onClose: () => void;
  sidebarOpen: boolean; onExpandSidebar: () => void;
  onLocate: (boardId: string, cardId: string) => void;
  onEditMemory?: (memory: LumiorMemory, patch: Partial<Card>) => void;
  onBeginEditMemory?: (memory: LumiorMemory) => boolean;
}) {
 const {t}=useI18n();
  const data = useMemo(() => {
    const mapped=mapMemoryAtlas(boards, activeBoardId);
    const names:Record<string,string>={note:t('Notes','笔记'),text:t('Text','文本'),image:t('Images','图片'),pdf:'PDF',video:t('Videos','视频')};
    return {...mapped,categories:mapped.categories.map(category=>({...category,name:names[category.id]||category.name}))};
  }, [boards, activeBoardId, t]);
  const [selection, setSelection] = useState<LumiorMemory | null>(null);
  const [error, setError] = useState('');
  const selected = resolveAtlasSelection(boards, activeBoardId, selection, data, !!onEditMemory);
  const choose = useCallback((item: MemoryAtlasSelection | null) => {
    // source retains our original Card object and all of its board locations.
    const source = item?.source as LumiorMemory | undefined;
    setSelection(source?.card ? source : null);
  }, []);
  return <section className="memory-atlas-page" aria-label={t("Memory Atlas", "记忆星图")} style={{ '--atlas-sidebar-offset': sidebarOpen ? 'var(--sidebar-width,280px)' : '0px' } as CSSProperties}>
    {!sidebarOpen && <header className="memory-atlas-header">
      <button className="board-sidebar-toggle" aria-label={t("Expand sidebar", "展开侧边栏")} onClick={onExpandSidebar}>
        <img className="board-heading-logo" src="/assets/board-chrome/logo.png" alt="" width={24} height={24} draggable={false} />
        <img className="board-heading-open" src="/assets/board-chrome/open-sidebar.svg" alt="" width={20} height={20} draggable={false} />
      </button>
    </header>}
    <div className="memory-atlas-stage"><MemoryAtlasView data={data} onSelect={choose} onError={setError} /></div>
    {!data.memories.length && !selected && <div className="memory-atlas-empty"><h2>{t("Your atlas starts with one card", "你的星图，从一张卡片开始")}</h2><p>{t("Add ideas and resources to a whiteboard to light them up here.", "把想法和资料放进画板，它们会在这里亮起。")}</p><button onClick={onClose}>{t("Return to whiteboard", "返回画板")}</button></div>}
    {error && <div className="memory-atlas-empty" role="alert"><h2>{t("The atlas is temporarily unavailable", "星图暂时无法显示")}</h2><p>{translateSystemMessage(error)}</p><button onClick={onClose}>{t("Return to whiteboard", "返回画板")}</button></div>}
    <Dialog open={!!selected} onOpenChange={open => { if (!open) setSelection(null); }}>
      {selected && (selected.card.kind === 'note' || selected.card.kind === 'text'
        ? <MemoryNoteDetail key={selected.id} memory={selected} onLocate={onLocate} onBeginEdit={onEditMemory ? () => onBeginEditMemory?.(selected) !== false : undefined} onChange={onEditMemory ? patch => onEditMemory(selected, patch) : undefined}/>
        : <DialogContent className="memory-atlas-detail" overlayClassName="memory-atlas-detail-overlay">
        <DialogTitle>{selected.card.title}</DialogTitle>
        <DialogDescription>{selected.date} · {selected.simulatedDate ? t("Simulated creation date", "模拟创建日期") : t("Creation date", "创建日期")} · {t('Understanding depth has not been assessed','理解深度暂未评估')}</DialogDescription>
        <div className="memory-atlas-detail-body">
          {selected.card.kind === 'pdf' ? <PdfViewer key={selected.card.id} card={selected.card} />
            : selected.card.kind === 'video' ? <VideoViewer key={selected.card.id} card={selected.card} />
              : selected.card.kind === 'image' ? <ImageCardContent card={selected.card} mode="sidebar" readOnly onChange={() => {}} />
                : <BlockEditor key={selected.card.id} card={selected.card} editable={false} />}
        </div>
        <footer className="memory-atlas-detail-locations"><span>{t("Whiteboard locations", "所在画板")}</span>{selected.locations.map(location => <button key={location.boardId + ':' + location.cardId} onClick={() => onLocate(location.boardId, location.cardId)}>{location.boardTitle}<span aria-hidden="true"> ↗</span></button>)}</footer>
      </DialogContent>)}
    </Dialog>
  </section>;
}
