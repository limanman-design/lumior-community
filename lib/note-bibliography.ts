import type { NoteSource } from '../app/note-source';
import type { BibliographyFields } from './bibliography';

// Original, deliberately bounded GB/T 7714—2025 numeric formatter. This is not
// a CSL interpreter. Rules follow sections 7–9 of the standard; no processor,
// CSL style or locale implementation is bundled or translated into this code.
// Names remain as supplied: arbitrary strings cannot reliably tell a surname
// from a given name or an institution. Flag Latin names for human review.
type Kind = 'journal' | 'book' | 'chapter' | 'conference' | 'proceedings' | 'thesis' | 'report' | 'standard' | 'web' | 'unknown';
const kinds: Record<string, Kind> = {
  'journal-article': 'journal', 'article-journal': 'journal', journal: 'journal', review: 'journal',
  book: 'book', 'book-chapter': 'chapter', chapter: 'chapter',
  'proceedings-article': 'conference', 'paper-conference': 'conference', proceedings: 'proceedings',
  dissertation: 'thesis', thesis: 'thesis', report: 'report', standard: 'standard', webpage: 'web', website: 'web',
};
const codes: Record<Kind, string> = { journal: 'J', book: 'M', chapter: 'M', conference: 'C', proceedings: 'C', thesis: 'D', report: 'R', standard: 'S', web: 'EB', unknown: 'Z' };
export type BibliographyEntry = { text: string; body: string; missing: string[]; warnings: string[] };
const clean = (value: string | undefined) => (value || '').replace(/\s+/gu, ' ').trim();
const sentence = (value: string) => !value ? '' : /[.!?。！？]$/u.test(value) ? value : value + '.';
const join = (values: (string | undefined)[], separator: string) => values.filter(Boolean).join(separator);

function formatEntry(source: NoteSource, number: number): BibliographyEntry {
  const b: BibliographyFields = source.bibliography || {};
  const title = clean(b.title) || clean(source.title);
  const kind = Object.hasOwn(kinds, b.type || '') ? kinds[b.type!] : (!b.type && b.journal ? 'journal' : 'unknown');
  const chinese = /\p{Script=Han}/u.test(title);
  const authors = (b.authors || []).map(clean).filter(Boolean);
  const names = authors.slice(0, 3);
  if (authors.length > 3) names.push(chinese ? '等' : 'et al.');
  const missing: string[] = [];
  const warnings: string[] = [];
  const needField = (key: string, value: unknown) => { if (!value) missing.push(key); };
  needField('title', clean(b.title)); needField('authors', authors.length);
  if (authors.some(name => /[A-Za-z]/u.test(name))) warnings.push('authorNames');
  if (kind === 'unknown') warnings.push('unsupportedType');
  const url = clean(b.url), doi = clean(b.doi);
  const online = kind === 'web' || !!url;
  const year = b.year ? String(b.year) : b.publishedDate?.slice(0, 4) || '';
  const pages = clean(b.pages); // Never substitute source.pages (PDF file positions).
  if (kind !== 'web') needField('year', year);
  const head = join([sentence(names.join(', ')), `${title}[${codes[kind]}${online ? '/OL' : ''}]`], ' ');
  let body = head;
  if (kind === 'journal') {
    needField('journal', clean(b.journal)); needField('pages', pages);
    const volume = clean(b.volume) + (b.issue ? `(${clean(b.issue)})` : '');
    const publication = join([clean(b.journal), year, volume], ', ');
    body = join([sentence(head), publication + (pages ? `${publication ? ': ' : ''}${pages}` : '')], ' ');
  } else if (kind === 'web') {
    needField('url', url); needField('accessedDate', b.accessedDate);
    const date = clean(b.publishedDate) || year;
    body = sentence(head) + (date ? ` (${date})` : '');
  } else {
    const collected = kind === 'chapter' || kind === 'conference';
    if (collected) {
      const container = clean(b.containerTitle) || clean(b.journal);
      needField('containerTitle', container); needField('pages', pages);
      body += '//' + join([sentence(clean(b.containerAuthors)), container], ' ');
    }
    if (kind !== 'unknown') { needField('publisher', clean(b.publisher)); needField('publisherPlace', clean(b.publisherPlace)); }
    const edition = kind === 'book' || kind === 'chapter' ? clean(b.edition) : '';
    const showEdition = edition && !/^(?:1|1st|1版|第1版|第一版)$/iu.test(edition);
    const imprint = join([clean(b.publisherPlace), clean(b.publisher)], ': ');
    const issued = kind === 'report' ? clean(b.publishedDate) || year : year;
    const publication = join([imprint, issued], ', ');
    body = join([sentence(body), showEdition ? sentence(edition) : '', publication + (pages ? `${publication ? ': ' : ''}${pages}` : '')], ' ');
  }
  // A supplied access date is retained, never invented from today's clock.
  if (online && b.accessedDate) body = body.replace(/\.$/u, '') + ` [${b.accessedDate}]`;
  body = join([sentence(body), url ? sentence(url) : '', doi ? sentence(`DOI:${doi}`) : ''], ' ');
  return { body, text: `[${number}] ${body}`, missing, warnings };
}

/** Offline, deterministic formatting; numbering is already in first-citation order. */
export function formatNoteBibliography(sources: readonly NoteSource[]): BibliographyEntry[] {
  return sources.map((source, index) => formatEntry(source, index + 1));
}
