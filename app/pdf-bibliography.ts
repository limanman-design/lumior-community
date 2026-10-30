import type { Card } from './canvas-model';
import { bibliographyFields, normalizeDoi, validBibliographyFields, type Bibliography, type BibliographyFields } from '../lib/bibliography.ts';
import { bibliographyTitlesMatch, extractPdfBibliography, pdfBibliographyLines, type PdfBibliographySnapshot } from '../lib/pdf-bibliography-extract.ts';

export class BibliographyLookupError extends Error {
  readonly code: 'invalid-doi' | 'no-match' | 'network' | 'invalid-response';
  constructor(code: 'invalid-doi' | 'no-match' | 'network' | 'invalid-response') {
    super(`Bibliography lookup: ${code}`);
    this.name = 'BibliographyLookupError';
    this.code = code;
  }
}

function abortError() { return new DOMException('Operation cancelled', 'AbortError'); }
function throwIfAborted(signal?: AbortSignal) { if (signal?.aborted) throw abortError(); }

function deadline(signal: AbortSignal | undefined, milliseconds: number) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const timer = setTimeout(cancel, milliseconds);
  return { signal: controller.signal, dispose() { clearTimeout(timer); signal?.removeEventListener('abort', cancel); } };
}

/** Stop waiting without destroying a document that the reader may also be using. */
function bounded<T>(value: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(abortError()); return; }
    const cancel = () => { cleanup(); reject(abortError()); };
    const cleanup = () => signal.removeEventListener('abort', cancel);
    signal.addEventListener('abort', cancel, { once: true });
    Promise.resolve(value).then(result => { cleanup(); resolve(result); }, error => { cleanup(); reject(error); });
  });
}

/** Only a DOI leaves the device; no PDF, extracted text, filename, or title is sent. */
export async function lookupDoiBibliography(doi: string, signal?: AbortSignal): Promise<BibliographyFields> {
  const normalized = normalizeDoi(doi);
  if (!normalized) throw new BibliographyLookupError('invalid-doi');
  throwIfAborted(signal);
  const request = deadline(signal, 22000);
  try {
    const response = await bounded(fetch('/api/bibliography', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ doi: normalized }), signal: request.signal,
    }), request.signal);
    if (!response.ok) throw new BibliographyLookupError(response.status === 404 ? 'no-match' : 'network');
    const json: unknown = await bounded(response.json(), request.signal);
    const fields = json && typeof json === 'object' && 'bibliography' in json ? json.bibliography : undefined;
    if (!validBibliographyFields(fields) || fields.doi !== normalized || !bibliographyFields.some(key => !['doi', 'url'].includes(key) && fields[key] !== undefined)) throw new BibliographyLookupError('invalid-response');
    // Copy only the contracted fields rather than retaining the response object.
    return Object.fromEntries(bibliographyFields.filter(key => fields[key] !== undefined).map(key => [key, fields[key]])) as BibliographyFields;
  } catch (error) {
    throwIfAborted(signal);
    if (error instanceof BibliographyLookupError) throw error;
    throw new BibliographyLookupError('network');
  } finally { request.dispose(); }
}

type PdfMetadataDocument = {
  numPages: number;
  getMetadata(): PromiseLike<{ info?: unknown; metadata?: { get?(name: string): unknown; getAll?(): unknown } | null }>;
  getPage(number: number): PromiseLike<{ getTextContent(): PromiseLike<{ items: unknown[] }> }>;
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function xmpFields(metadata: { get?(name: string): unknown; getAll?(): unknown } | null | undefined): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  if (metadata.getAll) return record(metadata.getAll());
  if (!metadata.get) return undefined;
  // PDF.js 6 exposes get()/iteration, earlier supported getAll(). Read only
  // known bibliographic namespaces rather than retaining raw XMP wholesale.
  const result: Record<string, unknown> = {};
  for (const key of ['dc:title', 'dc:creator', 'prism:publicationDate', 'prism:coverDate', 'pdfx:publicationDate',
    'prism:publicationName', 'pdfx:journal', 'pdfx:Journal', 'prism:volume', 'prism:number', 'prism:issueIdentifier',
    'prism:startingPage', 'prism:endingPage', 'prism:doi', 'pdfx:doi', 'pdfx:DOI', 'dc:identifier', 'pdf:Keywords']) {
    const value = metadata.get(key.toLowerCase());
    if (value !== undefined && value !== null) result[key] = value;
  }
  return result;
}

function localBibliography(snapshot: PdfBibliographySnapshot): Bibliography {
  const { fields, ambiguousDoi, hasText } = extractPdfBibliography(snapshot);
  const populated = bibliographyFields.filter(key => fields[key] !== undefined);
  return {
    ...fields, status: populated.length ? 'review' : 'unavailable',
    origins: Object.fromEntries(populated.map(key => [key, 'pdf'])), updatedAt: new Date().toISOString(),
    reason: ambiguousDoi ? 'ambiguous' : !hasText && !populated.length ? 'no-text' : 'no-match',
  };
}

/** Exported to verify bounded PDF reads without a browser worker or real user files. */
export async function readPdfBibliographyDocument(document: PromiseLike<PdfMetadataDocument>, options: {
  signal?: AbortSignal;
  timeoutMs?: number;
  lookup?: typeof lookupDoiBibliography;
} = {}): Promise<Bibliography> {
  throwIfAborted(options.signal);
  const work = deadline(options.signal, options.timeoutMs ?? 25000);
  const snapshot: PdfBibliographySnapshot = { pages: [] };
  try {
    const pdf = await bounded(document, work.signal);
    try {
      const metadata = await bounded(pdf.getMetadata(), work.signal);
      snapshot.info = record(metadata.info);
      snapshot.xmp = xmpFields(metadata.metadata);
    } catch { throwIfAborted(work.signal); }
    const pageCount = Number.isInteger(pdf.numPages) ? Math.max(0, Math.min(2, pdf.numPages)) : 0;
    const pages: NonNullable<PdfBibliographySnapshot['pages']>[number][] = [];
    snapshot.pages = pages;
    for (let number = 1; number <= pageCount; number++) {
      try {
        const page = await bounded(pdf.getPage(number), work.signal);
        const content = await bounded(page.getTextContent(), work.signal);
        pages.push(pdfBibliographyLines(Array.isArray(content.items) ? content.items : []));
      } catch { throwIfAborted(work.signal); }
    }
    const result = localBibliography(snapshot);
    // A DOI in body text may identify a cited work. Without an independent
    // local title we cannot safely assign its metadata to the imported PDF.
    if (!result.doi || !result.title || result.reason === 'ambiguous') return result;
    try {
      const enriched = await bounded((options.lookup || lookupDoiBibliography)(result.doi, work.signal), work.signal);
      if (result.title && enriched.title && !bibliographyTitlesMatch(result.title, enriched.title)) return { ...result, status: 'review', reason: 'mismatch' };
      const origins = { ...result.origins };
      for (const key of bibliographyFields) if (enriched[key] !== undefined) origins[key] = 'doi';
      return { ...result, ...enriched, origins, status: 'resolved', reason: undefined, updatedAt: new Date().toISOString() };
    } catch (error) {
      throwIfAborted(options.signal);
      return { ...result, status: 'review', reason: error instanceof BibliographyLookupError && error.code === 'no-match' ? 'no-match' : 'network' };
    }
  } catch {
    throwIfAborted(options.signal);
    const result = localBibliography(snapshot);
    return { ...result, reason: result.reason === 'ambiguous' ? 'ambiguous' : Object.keys(result.origins || {}).length ? 'network' : 'no-text' };
  } finally { work.dispose(); }
}

export async function readPdfBibliography(card: Card, signal?: AbortSignal): Promise<Bibliography> {
  throwIfAborted(signal);
  if (card.kind !== 'pdf' || !card.pdf?.url) return { status: 'unavailable', reason: 'no-text', updatedAt: new Date().toISOString() };
  // Reuse the reader's lease/cache rather than creating a second worker for a
  // PDF that is already open. Release on success, failure, timeout and cancel.
  const { acquirePdf } = await import('./pdf-runtime');
  throwIfAborted(signal);
  const lease = acquirePdf(card.pdf.url);
  try { return await readPdfBibliographyDocument(lease.promise, { signal }); }
  finally { lease.release(); }
}
