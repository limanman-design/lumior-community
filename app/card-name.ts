import type { Card } from './canvas-model';
import type { PdfExcerpt } from './pdf-annotations';
import { getLanguage, type Language } from './i18n-core.ts';

/** Source labels are presentation only; the saved card title stays untouched. */
export function pdfExcerptSourceName(excerpt: PdfExcerpt, language: Language = getLanguage()) {
  const source = excerpt.pdf.name || excerpt.sourceTitle || 'PDF';
  const pages = [...new Set(excerpt.mark.fragments.map(fragment => fragment.page)
    .filter(page => Number.isInteger(page) && page > 0))].sort((a, b) => a - b);
  if (!pages.length) return source;
  const ranges: string[] = [];
  for (let index = 0; index < pages.length; index++) {
    const start = pages[index];
    let end = start;
    while (pages[index + 1] === end + 1) end = pages[++index];
    ranges.push(start === end ? String(start) : `${start}–${end}`);
  }
  const pageLabel = language === 'zh'
    ? `第 ${ranges.join('、')} 页`
    : `${pages.length === 1 ? 'Page' : 'Pages'} ${ranges.join(', ')}`;
  return `${source} · ${pageLabel}`;
}

// Uploaded files retain their original name; native notes and linked videos use
// the card title rather than a type label or the name of a publishing channel.
export function cardName(card: Card, language: Language = getLanguage()) {
  if (card.pdfExcerpt) return pdfExcerptSourceName(card.pdfExcerpt, language);
  if (card.pdf?.name) return card.pdf.name;
  if (card.sourceName && (card.kind !== 'video' || /\.[a-z0-9]{2,5}$/i.test(card.sourceName)))
    return card.sourceName;
  return card.title || 'Untitled';
}
