export type BibliographyFields = {
  title?: string;
  authors?: string[];
  year?: number;
  journal?: string;
  doi?: string;
  type?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  url?: string;
};
export type BibliographyField = keyof BibliographyFields;
export type BibliographyOrigin = 'pdf' | 'doi' | 'manual';
export type Bibliography = BibliographyFields & {
  status: 'pending' | 'review' | 'resolved' | 'unavailable';
  origins?: Partial<Record<BibliographyField, BibliographyOrigin>>;
  manualFields?: BibliographyField[];
  updatedAt?: string;
  reason?: 'no-match' | 'ambiguous' | 'network' | 'no-text' | 'mismatch';
};
export const bibliographyFields: readonly BibliographyField[] = ['title', 'authors', 'year', 'journal', 'doi', 'type', 'volume', 'issue', 'pages', 'url'];

/** Normalize identifiers, never resolve a caller-provided URL. */
export function normalizeDoi(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return undefined;
  let doi = value.trim().replace(/^doi:\s*/i, '');
  if (/^https?:\/\/(?:dx\.)?doi\.org\//i.test(doi)) {
    try {
      const url = new URL(doi);
      if (url.search || url.hash || url.username || url.password) return undefined;
      doi = decodeURIComponent(url.pathname.slice(1));
    } catch { return undefined; }
  }
  if (doi.length > 256 || !/^10\.\d{4,9}\/[^\s<>"\\?#\p{Cc}]+$/iu.test(doi)) return undefined;
  return doi.toLowerCase();
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const fieldName = (key: string): key is BibliographyField => bibliographyFields.includes(key as BibliographyField);
function validFields(value: Record<string, unknown>) {
  return bibliographyFields.every(key => {
    const item = value[key];
    if (item === undefined) return true;
    if (key === 'authors') return Array.isArray(item) && item.length <= 500 && item.every(author => typeof author === 'string' && author.length <= 300);
    if (key === 'year') return Number.isInteger(item) && Number(item) > 0 && Number(item) < 3000;
    const limit = key === 'title' ? 2000 : key === 'journal' ? 500 : key === 'url' ? 2048 : key === 'doi' ? 256 : 300;
    if (typeof item !== 'string' || item.length > limit || /\p{Cc}/u.test(item)) return false;
    if (key === 'doi') return normalizeDoi(item) === item;
    if (key === 'url' && item) { try { return ['http:', 'https:'].includes(new URL(item).protocol); } catch { return false; } }
    return true;
  });
}
export function validBibliographyFields(value: unknown): value is BibliographyFields {
  return record(value) && Object.keys(value).every(fieldName) && validFields(value);
}
export function validBibliography(value: unknown): value is Bibliography {
  if (!record(value) || !validFields(value) || !['pending', 'review', 'resolved', 'unavailable'].includes(value.status as string)) return false;
  if (!Object.keys(value).every(key => fieldName(key) || ['status', 'origins', 'manualFields', 'updatedAt', 'reason'].includes(key))) return false;
  if (value.origins !== undefined && (!record(value.origins) || !Object.entries(value.origins).every(([key, origin]) => fieldName(key) && ['pdf', 'doi', 'manual'].includes(origin as string)))) return false;
  if (value.manualFields !== undefined && (!Array.isArray(value.manualFields) || value.manualFields.length > bibliographyFields.length || !value.manualFields.every(key => typeof key === 'string' && fieldName(key)))) return false;
  if (value.updatedAt !== undefined && (typeof value.updatedAt !== 'string' || value.updatedAt.length > 40 || !Number.isFinite(Date.parse(value.updatedAt)))) return false;
  return value.reason === undefined || ['no-match', 'ambiguous', 'network', 'no-text', 'mismatch'].includes(value.reason as string);
}
