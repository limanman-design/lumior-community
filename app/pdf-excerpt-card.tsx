'use client';

import type { CSSProperties } from 'react';
import type { Card } from './canvas-model';
import type { PdfMark } from './pdf-annotations';
import { useI18n } from './i18n';
import './pdf-excerpt-card.css';

/** Read-only source evidence sits above the user's independently editable notes. */
export function PdfExcerptQuote({ card, mark }: { card: Card; mark?: PdfMark }) {
  const { t } = useI18n();
  const excerpt = card.pdfExcerpt;
  if (!excerpt) return null;
  const source = mark || excerpt.mark;
  const image = source.image || (excerpt.mark.image ? card.image : undefined);
  if (!image && !source.text.trim()) return null;
  return (
    <blockquote
      className={`pdf-excerpt-quote${image ? ' pdf-excerpt-quote-image' : ''}`}
      aria-label={t('Quoted PDF source', 'PDF 原文摘录')}
      style={{ '--pdf-excerpt-accent': source.color || excerpt.mark.color } as CSSProperties}
    >
      {image
        ? <img draggable={false} src={image} alt={source.text || t('Excerpt from the PDF', 'PDF 区域摘录')} />
        : <p>{source.text}</p>}
    </blockquote>
  );
}
