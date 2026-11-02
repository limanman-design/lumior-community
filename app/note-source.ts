import type { Card } from './canvas-model';
import { bibliographyFields, validBibliographyFields, normalizeDoi, type BibliographyFields } from '../lib/bibliography.ts';

export type NoteSource = {
  version: 1;
  contentId: string;
  title: string;
  kind: 'note' | 'pdf';
  viaId?: string;
  viaTitle?: string;
  /** PDF file page numbers, not the publication's printed page numbers. */
  pages?: number[];
  quote?: string;
  bibliography?: BibliographyFields;
};
export const noteSourcePrefix = '#lumior-source=';
export const openNoteSourceEvent = 'lumior-open-note-source';
const text = (value: unknown, limit: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= limit;
export function parseNoteSource(href: string): NoteSource | undefined {
  // Match the existing bibliography limits, including large author lists and
  // percent-encoded CJK names, so valid source snapshots remain readable.
  if (!href.startsWith(noteSourcePrefix) || href.length > 2000000) return;
  try {
    const s = JSON.parse(decodeURIComponent(href.slice(noteSourcePrefix.length))) as NoteSource;
    if (!s || s.version !== 1 || !text(s.contentId, 512) || !text(s.title, 2000) || !['note', 'pdf'].includes(s.kind)) return;
    if (s.viaId !== undefined && !text(s.viaId, 512) || s.viaTitle !== undefined && !text(s.viaTitle, 2000)) return;
    if (s.pages !== undefined && (!Array.isArray(s.pages) || s.pages.length > 100 || s.pages.some(p => !Number.isInteger(p) || p < 1 || p > 100000))) return;
    if (s.quote !== undefined && !text(s.quote, 12000) || s.bibliography !== undefined && !validBibliographyFields(s.bibliography)) return;
    return s;
  } catch { return; }
}
export const noteSourceLink = (source: NoteSource) => noteSourcePrefix + encodeURIComponent(JSON.stringify(source));
export function remapNoteSourceLink(href: string, ids: ReadonlyMap<string, string>): string {
  const source = parseNoteSource(href);
  if (!source) return href;
  return noteSourceLink({ ...source, contentId: ids.get(source.contentId) || source.contentId,
    ...(source.viaId ? { viaId: ids.get(source.viaId) || source.viaId } : {}) });
}
export function captureNoteSource(card: Card, resolve: (id: string) => Card | undefined): NoteSource {
  const identity = card.sharedId || card.id;
  const excerpt = card.pdfExcerpt;
  let origin = card;
  const seen = new Set([identity]);
  for (let depth = 0; depth < 8; depth++) {
    const id = origin.pdfExcerpt?.sourceId || origin.sourceContentId;
    if (!id || seen.has(id)) break;
    seen.add(id);
    const next = resolve(id);
    if (!next) break;
    origin = next;
  }
  const pdf = origin.kind === 'pdf' || !!excerpt;
  const sourceId = origin.kind === 'pdf' ? origin.sharedId || origin.id : excerpt?.sourceId || identity;
  const title = (origin.kind === 'pdf' ? origin.title : excerpt?.sourceTitle || card.title).trim() || 'Untitled';
  const bibliography = Object.fromEntries(bibliographyFields.flatMap(key => {
    const value = origin.bibliography?.[key] ?? (key === 'authors' ? origin.authors : key === 'year' ? origin.year : undefined);
    return value === undefined ? [] : [[key, value]];
  })) as BibliographyFields;
  const pages = [...new Set(excerpt?.mark.fragments.map(item => item.page).filter(page => Number.isInteger(page) && page > 0 && page <= 100000) || [])].sort((a, b) => a - b).slice(0, 100);
  return { version: 1, contentId: sourceId, title: title.slice(0, 2000), kind: pdf ? 'pdf' : 'note',
    ...(sourceId !== identity ? { viaId: identity, viaTitle: card.title.slice(0, 2000) || 'Untitled' } : {}),
    ...(pages.length ? { pages } : {}),
    ...(pages.length === 1 && excerpt?.mark.text.trim() ? { quote: excerpt.mark.text.slice(0, 12000) } : {}),
    ...(pdf && validBibliographyFields(bibliography) ? { bibliography } : {}) };
}
export function sourceLabel(source: NoteSource, language: 'en' | 'zh', number?: number): string {
  const pages = source.pages?.join(', ');
  const pageLabel = pages ? (language === 'zh' ? `PDF 第 ${pages} 页` : `PDF p. ${pages}`) : '';
  if (number !== undefined && source.kind === 'pdf') return `[${number}]`;
  return `${language === 'zh' ? '来源：' : 'Source: '}${source.title}${pageLabel ? ` · ${pageLabel}` : ''}`;
}
export function sourceKey(source: NoteSource): string {
  const doi = normalizeDoi(source.bibliography?.doi);
  return source.kind + ':' + (doi ? 'doi:' + doi : source.contentId);
}
/** Use corrected library metadata when available without changing the saved
 * quotation, page anchor, reference order or fallback for a removed source. */
export function referenceSource(source: NoteSource, resolve: (id: string) => Card | undefined): NoteSource {
  const current = resolve(source.contentId);
  return current?.kind === 'pdf' ? { ...source, bibliography: captureNoteSource(current, resolve).bibliography } : source;
}
export function documentSources(value: unknown): NoteSource[] {
  const output: NoteSource[] = [];
  const visit = (item: unknown) => {
    if (!item || typeof item !== 'object') return;
    if (Array.isArray(item)) { item.forEach(visit); return; }
    const object = item as Record<string, unknown>;
    if (object.type === 'link' && typeof object.href === 'string') {
      const source = parseNoteSource(object.href);
      if (source) output.push(source);
    }
    if (object.content) visit(object.content);
    if (object.children) visit(object.children);
    if (object.rows) visit(object.rows);
    if (object.cells) visit(object.cells);
  };
  visit(value);
  return output;
}
export function numberedSources(sources: readonly NoteSource[]) {
  const seen = new Map<string, { source: NoteSource; number: number }>();
  for (const source of sources) if (source.kind === 'pdf' && !seen.has(sourceKey(source)))
    seen.set(sourceKey(source), { source, number: seen.size + 1 });
  return seen;
}

/** Normalize only generated link labels for initial and externally updated documents. */
export function labelNoteSources<T>(value: T, language: 'en' | 'zh', numeric: boolean): T {
  const numbers = numberedSources(documentSources(value));
  const visit = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(visit);
    if (!item || typeof item !== 'object') return item;
    const object = item as Record<string, unknown>;
    if (object.type === 'link' && typeof object.href === 'string') {
      const source = parseNoteSource(object.href);
      if (source) return { ...object, content: [{ type: 'text', text: sourceLabel(source, language, numeric ? numbers.get(sourceKey(source))?.number : undefined), styles: {} }] };
    }
    return Object.fromEntries(Object.entries(object).map(([key, child]) => [key, ['content', 'children', 'rows', 'cells'].includes(key) ? visit(child) : child]));
  };
  return visit(value) as T;
}
