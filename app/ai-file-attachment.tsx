'use client';
/* oxlint-disable next/no-img-element -- Reuse the card's existing local thumbnail without rendering or uploading its file. */
import { useState } from 'react';
import { FileText, Image as ImageIcon, StickyNote, Video, X } from 'lucide-react';
import type { Card } from './canvas-model';
import { aiAttachmentThumbnail } from './ai-file-attachment-model';
import { aiReferenceKind } from './ai-ui-text';
import { useI18n } from './i18n';

type Props = {
  title: string;
  kind: Card['kind'];
  excerpt?: boolean;
  card?: Card;
  onOpen: () => void;
  onRemove?: () => void;
  selected?: boolean;
  actionLabel?: string;
};

export function AiFileAttachment({ title, kind, excerpt = false, card, onOpen, onRemove, selected, actionLabel }: Props) {
  const { t } = useI18n();
  const thumbnail = aiAttachmentThumbnail(card, kind, excerpt);
  const [failedThumbnail, setFailedThumbnail] = useState<string | null>(null);
  const Icon = kind === 'pdf' || excerpt ? FileText : kind === 'image' ? ImageIcon : kind === 'video' ? Video : StickyNote;
  const type = aiReferenceKind(kind, excerpt, t);
  return <div className={`ai-file-attachment${kind === 'pdf' || excerpt ? ' is-pdf' : ''}${onRemove ? ' is-removable' : ''}`}>
    <button type="button" className="ai-file-open" title={title} aria-label={actionLabel || t('Open referenced card: {title}', '打开引用卡片：{title}', { title })} aria-pressed={selected} onClick={onOpen}>
      <span className="ai-file-preview" aria-hidden="true">
        {thumbnail && failedThumbnail !== thumbnail ? <img src={thumbnail} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailedThumbnail(thumbnail)} /> : <Icon size={20} strokeWidth={1.6} />}
      </span>
      <span className="ai-file-details"><strong>{title}</strong><small>{type}</small></span>
    </button>
    {onRemove && <button type="button" className="ai-file-remove" aria-label={t('Remove reference {title}', '移除引用 {title}', { title })} onClick={onRemove}><X size={13} strokeWidth={1.8} aria-hidden="true" /></button>}
  </div>;
}
