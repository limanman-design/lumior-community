import { normalizeDoi, type BibliographyFields } from './bibliography.ts';

export type PdfBibliographyLine = { text: string; size?: number; y?: number };
export type PdfBibliographySnapshot = {
  info?: Record<string, unknown>;
  xmp?: Record<string, unknown>;
  pages?: readonly (readonly PdfBibliographyLine[])[];
};
export type PdfBibliographyExtraction = {
  fields: BibliographyFields;
  ambiguousDoi: boolean;
  hasText: boolean;
};

const software = /(?:microsoft|libreoffice|openoffice|adobe|acrobat|distiller|windows|macintosh|latex|texmaker|publisher|springer|elsevier|administrator|anonymous|unknown|default user|username|user name|未命名|管理员)/i;
const genericTitle = /^(?:untitled|document\d*|title|full\s*text|article|manuscript|摘要|正文|未命名|无标题)$/i;
const referenceHeading = /^(?:(?:\d+|[IVX]+)[.\s]+)?(?:references|bibliography|literature cited|参考文献|参考资料)\s*[:：]?$/i;

function cleanText(value: unknown, max = 2000): string | undefined {
  if (typeof value !== 'string') return undefined;
  const clean = value.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim();
  return clean && clean.length <= max ? clean : undefined;
}

function strings(value: unknown): string[] {
  return (Array.isArray(value) ? value.slice(0, 100) : [value])
    .flatMap(item => typeof item === 'string' ? [item.slice(0, 16000)] : []);
}

function title(value: unknown): string | undefined {
  const candidate = cleanText(value);
  const hanLength = candidate?.match(/\p{Script=Han}/gu)?.length || 0;
  if (!candidate || (candidate.length < 12 && hanLength < 6) || genericTitle.test(candidate) || software.test(candidate)
    || /\.(?:docx?|pdf|tex)$/i.test(candidate) || /^(?:doi|https?|www)[\s:/.]/i.test(candidate)
    || /^[A-Z]:\\|^\/(?:Users|home|tmp)\//.test(candidate)) return undefined;
  return candidate;
}

function authorName(value: string): string | undefined {
  const name = cleanText(value, 160)?.replace(/(?:\s*\d+[,*†‡]*|\s*[*†‡])$/g, '').trim();
  if (!name || software.test(name) || /(?:university|institute|department|school|laboratory|journal|college|academy|研究所|大学|学院|通讯作者|作者单位|编辑部)/i.test(name)
    || /[\d@/\\:=<>]/.test(name)) return undefined;
  if (/^(?:摘要|关键词|引言|正文|介绍|文献综述|研究方法)$/.test(name)) return undefined;
  if (/^[\p{Script=Han}·]{2,8}$/u.test(name)) return name;
  if (name.split(/\s+/).length > 7 || !/^[\p{L}\p{M}.'’\-,\s]+$/u.test(name)) return undefined;
  // A single login/surname in PDF Author is insufficient evidence for authorship.
  const words = name.split(/[\s,]+/).filter(Boolean);
  const particles = /^(?:de|del|der|di|van|von|da|dos|du|la|le)$/i;
  return words.length >= 2 && words.every(word => particles.test(word) || /^\p{Lu}/u.test(word)) ? name : undefined;
}

function authors(value: unknown): string[] | undefined {
  const candidates = strings(value).flatMap(item => item.split(/\s*(?:;|\n|\s+and\s+|\s*&\s*|、|；)\s*/i))
    .flatMap(item => /^[\p{Script=Han}·]{2,4}(?:\s+[\p{Script=Han}·]{2,4})+$/u.test(item) ? item.split(/\s+/) : [item])
    .flatMap(item => /,\s+\p{L}+\s+\p{L}+/u.test(item) && item.split(',').every(part => part.trim().split(/\s+/).length >= 2) ? item.split(',') : [item]);
  const result = [...new Set(candidates.map(authorName).filter((item): item is string => !!item))];
  return result.length ? result.slice(0, 100) : undefined;
}

function publicationYear(value: unknown): number | undefined {
  const text = cleanText(value, 300);
  const year = text?.match(/^(?:D:)?((?:18|19|20|21)\d{2})(?:\D|$)/)?.[1];
  return year ? Number(year) : undefined;
}

function doiCandidates(value: unknown): string[] {
  return strings(value).flatMap(text => [...text.replace(/\p{Cc}/gu, ' ').matchAll(/10\.\d{4,9}\/[^\s<>"{}]+/gi)]
    .map(match => {
      let candidate = match[0].replace(/[.,;:]+$/g, '');
      while (candidate.endsWith(')') && (candidate.match(/\)/g)?.length || 0) > (candidate.match(/\(/g)?.length || 0)) candidate = candidate.slice(0, -1);
      return normalizeDoi(candidate);
    }).filter((item): item is string => !!item));
}

function firstValue(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = record[key.toLowerCase()] ?? record[key];
    if (strings(value).some(text => text.trim())) return value;
  }
  return undefined;
}

function firstString(value: unknown, max = 2000): string | undefined {
  return strings(value).map(item => cleanText(item, max)).find(Boolean);
}

function contentBeforeReferences(pages: PdfBibliographySnapshot['pages']): PdfBibliographyLine[] {
  const result: PdfBibliographyLine[] = [];
  for (const page of (pages || []).slice(0, 2)) {
    for (const line of page.slice(0, 500)) {
      const text = cleanText(line.text.slice(0, 2000));
      if (!text) continue;
      if (referenceHeading.test(text)) return result;
      result.push({ ...line, text });
    }
  }
  return result;
}

/** Conservative local candidates only. A plausible filename is never treated as a title. */
export function extractPdfBibliography(snapshot: PdfBibliographySnapshot): PdfBibliographyExtraction {
  const info = snapshot.info || {}, fields: BibliographyFields = {};
  // PDF.js normalizes XMP node names to lowercase, including camelCase PRISM keys.
  const xmp = Object.fromEntries(Object.entries(snapshot.xmp || {}).map(([key, value]) => [key.toLowerCase(), value]));
  const custom = info.Custom instanceof Map ? info.Custom : new Map(Object.entries(info.Custom && typeof info.Custom === 'object' && !Array.isArray(info.Custom) ? info.Custom : {}));
  const lines = contentBeforeReferences(snapshot.pages);
  const firstPage = contentBeforeReferences(snapshot.pages?.slice(0, 1));
  const abstractIndex = firstPage.findIndex(line => /^(?:abstract|摘要|keywords|关键词)\b|^(?:摘要|关键词)/i.test(line.text.trim()));
  const header = firstPage.slice(0, abstractIndex >= 0 ? abstractIndex : 35);
  fields.title = title(firstString(firstValue(xmp, ['dc:title']))) || title(info.Title);
  if (!fields.title) {
    const sized = header.filter(line => line.size && title(line.text) && !/^(?:https?|doi|www|journal|vol\.?|©)/i.test(line.text.trim()));
    const largest = Math.max(0, ...sized.map(line => line.size || 0));
    if (largest >= 11) {
      const index = header.findIndex(line => line === sized.find(item => item.size === largest));
      if (index >= 0) {
        const candidate = [header[index].text];
        for (const next of header.slice(index + 1, index + 4)) {
          if (!next.size || next.size < largest * .9 || !title(next.text)) break;
          candidate.push(next.text);
        }
        fields.title = title(candidate.join(' '));
      }
    }
  }
  fields.authors = authors(firstValue(xmp, ['dc:creator'])) || authors(info.Author);
  if (!fields.authors && fields.title) {
    // Only immediately following the title, before an affiliation/abstract, and
    // requiring a clear list of human names. These remain review candidates.
    const titleLines = header.map((line, index) => fields.title!.includes(line.text) ? index : -1).filter(index => index >= 0);
    const end = titleLines.length ? Math.max(...titleLines) : -1;
    const candidate = end >= 0 ? header.slice(end + 1, end + 4).find(line => line.text.trim()) : undefined;
    if (candidate && candidate.text.length <= 400) fields.authors = authors(candidate.text);
  }
  fields.year = publicationYear(firstValue(xmp, ['prism:publicationDate', 'prism:coverDate', 'pdfx:publicationDate'])) || publicationYear(custom.get('PublicationDate'));
  fields.journal = firstString(firstValue(xmp, ['prism:publicationName', 'pdfx:journal']), 500) || firstString(custom.get('Journal') || custom.get('journal'), 500);
  fields.volume = firstString(firstValue(xmp, ['prism:volume']), 300);
  fields.issue = firstString(firstValue(xmp, ['prism:number', 'prism:issueIdentifier']), 300);
  const start = firstString(firstValue(xmp, ['prism:startingPage']), 100), end = firstString(firstValue(xmp, ['prism:endingPage']), 100);
  if (start) fields.pages = end && end !== start ? `${start}–${end}` : start;
  for (const line of header.slice(0, 15)) {
    const explicit = line.text.match(/\b(?:published(?:\s+online)?|publication\s+date)\s*[:：]?\s*(?:\d{1,2}\s+)?(?:[a-z]+\s+)?((?:19|20)\d{2})\b/i);
    if (!fields.year && explicit) fields.year = Number(explicit[1]);
    const journal = line.text.match(/^([\p{L}][\p{L}\s&,:.-]{8,130}?)\s+(\d{1,5})\s*\(((?:19|20)\d{2})\)\s*(\d{1,6}\s*[–−-]\s*\d{1,6})?$/u);
    if (journal) {
      fields.journal ||= journal[1].trim();
      fields.volume ||= journal[2];
      fields.year ||= Number(journal[3]);
      if (journal[4]) fields.pages ||= journal[4].replace(/\s+/g, '');
    }
  }
  const dois = new Set([
    ...['prism:doi', 'pdfx:doi', 'dc:identifier', 'pdf:keywords'].flatMap(key => doiCandidates(xmp[key])),
    ...['DOI', 'doi', 'Subject', 'Keywords'].flatMap(key => doiCandidates(info[key])),
    ...['DOI', 'doi', 'Doi', 'doi_url'].flatMap(key => doiCandidates(custom.get(key))),
    ...lines.flatMap(line => doiCandidates(line.text)),
  ]);
  if (dois.size === 1) fields.doi = [...dois][0];
  for (const key of Object.keys(fields) as (keyof BibliographyFields)[]) if (fields[key] === undefined) delete fields[key];
  return { fields, ambiguousDoi: dois.size > 1, hasText: !!lines.length };
}

function titleTokens(value: string): string[] {
  const normalized = value.normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '').replace(/[‐‑–−-]\s+/g, '');
  return normalized.match(/[a-z0-9]+|[\p{Script=Han}]/gu) || [];
}

/** Require enough actual title evidence, not a shared generic word or a filename. */
export function bibliographyTitlesMatch(local?: string, remote?: string): boolean {
  if (!local || !remote) return false;
  const a = titleTokens(local), b = titleTokens(remote);
  if (a.join('') === b.join('') && (local.match(/\p{Script=Han}/gu)?.length || 0) >= 6) return true;
  if (Math.min(a.join('').length, b.join('').length) < 12) return false;
  if (a.join('') === b.join('')) return true;
  const left = new Set(a), right = new Set(b);
  const common = [...left].filter(token => right.has(token)).length;
  return common / Math.max(left.size, right.size) >= .8 && common / Math.min(left.size, right.size) >= .9;
}

/** PDF.js coordinates preserve lines much better than joining every item with a space. */
export function pdfBibliographyLines(items: readonly unknown[]): PdfBibliographyLine[] {
  const lines: PdfBibliographyLine[] = [];
  let line: PdfBibliographyLine | undefined, textLength = 0;
  for (const item of items.slice(0, 4000)) {
    if (!item || typeof item !== 'object' || !('str' in item) || typeof item.str !== 'string') continue;
    const value = item as { str: string; transform?: unknown; height?: unknown; hasEOL?: unknown };
    const text = value.str.replace(/\p{Cc}/gu, ' ').slice(0, 2000);
    textLength += text.length;
    if (textLength > 24000 || lines.length >= 500) break;
    const matrix = Array.isArray(value.transform) ? value.transform : [];
    const y = typeof matrix[5] === 'number' && Number.isFinite(matrix[5]) ? matrix[5] : undefined;
    const size = typeof value.height === 'number' && Number.isFinite(value.height) ? Math.abs(value.height)
      : typeof matrix[3] === 'number' && Number.isFinite(matrix[3]) ? Math.abs(matrix[3]) : undefined;
    if (line && y !== undefined && line.y !== undefined && Math.abs(y - line.y) > Math.max(2, (size || 10) * .35)) line = undefined;
    if (!line) { line = { text: '', y, size }; lines.push(line); }
    line.text += (line.text && !/\s$/.test(line.text) && !/^\s/.test(text) ? ' ' : '') + text;
    line.size = Math.max(line.size || 0, size || 0) || undefined;
    if (value.hasEOL) line = undefined;
  }
  return lines.map(item => ({ ...item, text: item.text.trim() })).filter(item => item.text);
}
