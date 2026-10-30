'use client';
/* oxlint-disable next/no-img-element -- Library previews retain user-owned local and blob URLs. */
import { useI18n } from '@/app/i18n';

import { useState } from 'react';

type Item = {
  id: string; title: string; type: string; board: string;
  text: string; image?: string; references: number;
  kind?: 'note' | 'text' | 'image' | 'video' | 'pdf';
};

/** Lightweight adaptation of the hover-reveal list: actual library content, no remote demo assets. */
export function InteractiveListPreview({ items, onSelect }: {
  items: Item[]; onSelect: (id: string) => void;
}) {
  const { t } = useI18n();
  const [hover, setHover] = useState<{id: string; top: number; height: number} | null>(null);
  const active = items.find(item => item.id === hover?.id);
  const pdfPreview = active?.kind ? active.kind === 'pdf' : active?.type === 'PDF';
  return <div className="library-list" onPointerLeave={() => setHover(null)}>
    <div className="library-list-heading" aria-hidden="true"><span>{t("Card", "卡片")}</span><span>{t("Type", "类型")}</span><span>{t("Whiteboard", "画板")}</span><span>{t("References", "引用")}</span></div>
    <div className="library-list-preview-anchor">{active && hover && <aside key={active.id} className={`library-list-reveal ${!!active.image && !pdfPreview ? 'is-image-preview' : ''}`} aria-hidden="true">
      {active.image && <img src={active.image} alt="" className={pdfPreview ? 'is-pdf' : ''} />}
      <div className="library-list-reveal-content"><small>{active.type} · {active.board}</small><h3>{active.title}</h3><p>{active.text.slice(0, 900) || t('Open this card to view its contents.', '打开这张卡片查看完整内容。')}</p></div>
      <footer>{t("Click to read the complete card ↗", "点击阅读完整卡片 ↗")}</footer>
    </aside>}</div>
    <div className="library-list-rows">
      {hover && active && <div className="library-list-highlight" style={{top: hover.top, height: hover.height}} />}
      {items.map(item => <button key={item.id} className={`library-list-row ${active?.id === item.id ? 'is-hovered' : ''}`}
        aria-label={t("Preview {title}","预览 {title}",{title:item.title})} onClick={() => { setHover(null); onSelect(item.id); }}
        onPointerEnter={event => {
          if (event.pointerType !== 'mouse') return;
          const row = event.currentTarget;
          setHover({id: item.id, top: row.offsetTop, height: row.offsetHeight});
        }}
        onFocus={() => setHover(null)}>
        <span className="library-list-name">{item.title}</span>
        <span className="library-list-type">{item.type}</span>
        <span className="library-list-board">{item.board}</span>
        <span className="library-list-count">{item.references > 1 ? t("{count} whiteboards","{count} 张画板",{count:item.references}) : '—'}</span>
      </button>)}
    </div>

  </div>;
}
