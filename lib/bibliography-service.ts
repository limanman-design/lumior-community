import { lookupCnkiPage } from './cnki-bibliography.ts';
import { normalizeDoi, type BibliographyFields } from './bibliography.ts';

const maxRequestBytes = 2048;
const maxProviderBytes = 1024 * 1024;
const timeoutMs = 20_000;
const cacheLifetimeMs = 60 * 60 * 1000;
const json = (data: unknown, status = 200) => Response.json(data, {
  status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});
const record = (value: unknown): Record<string, unknown> | undefined => value !== null
  && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

class BibliographyError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

function localRequest(request: Request) {
  const url = new URL(request.url);
  return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    && (!request.headers.get('origin') || request.headers.get('origin') === url.origin);
}

async function boundedText(body: ReadableStream<Uint8Array> | null, limit: number, status: number) {
  if (!body) return '';
  const reader = body.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel().catch(() => {});
        throw new BibliographyError(status === 413 ? '请求内容过大，请只提交 DOI。' : '书目信息服务返回内容过大，请稍后重试。', status);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

// Crossref titles can contain JATS/XML markup. All returned fields are plain
// text; no provider HTML, abstract, reference list, or destination URL is kept.
function plainText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string' || value.length > maxLength * 4) return undefined;
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  const result = value.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, name: string) => {
      if (!name.startsWith('#')) return entities[name.toLowerCase()] || entity;
      const point = name[1]?.toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : '';
    })
    .replace(/<[^>]*>/g, '')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ').trim();
  return result && result.length <= maxLength ? result : undefined;
}

function firstText(value: unknown, maxLength: number) {
  return Array.isArray(value) ? plainText(value[0], maxLength) : undefined;
}

function publicationYear(value: unknown) {
  const parts = record(value)?.['date-parts'];
  const year = Array.isArray(parts) && Array.isArray(parts[0]) ? parts[0][0] : undefined;
  return typeof year === 'number' && Number.isInteger(year) && year >= 1 && year <= 2999 ? year : undefined;
}

function crossrefFields(payload: unknown, doi: string): BibliographyFields {
  const envelope = record(payload), work = record(envelope?.message);
  if (envelope?.status !== 'ok' || envelope['message-type'] !== 'work' || !work
    || normalizeDoi(work.DOI) !== doi) {
    throw new BibliographyError('返回的书目信息与 DOI 不一致，未补全，请核对 DOI。', 502);
  }
  const title = firstText(work.title, 2000);

  const bibliography: BibliographyFields = { doi, title,
    url: `https://doi.org/${doi.split('/').map(encodeURIComponent).join('/')}`,
  };
  if (Array.isArray(work.author) && work.author.length <= 500) {
    const authors = work.author.map(author => {
      const entry = record(author);
      if (!entry) return undefined;
      const given = plainText(entry.given, 150), family = plainText(entry.family, 150);
      return plainText([given, family].filter(Boolean).join(' '), 300) || plainText(entry.name, 300);
    }).filter((author): author is string => !!author);
    if (authors.length) bibliography.authors = authors;
  }
  const year = publicationYear(work['published-print']) ?? publicationYear(work.published)
    ?? publicationYear(work.issued) ?? publicationYear(work['published-online']);
  if (year !== undefined) bibliography.year = year;
  const type = plainText(work.type, 100);
  if (type && /^[a-z][a-z-]*$/.test(type)) bibliography.type = type;
  // The same container field is a book title or proceedings title for other
  // work types. Do not label those containers as academic journals.
  const journal = type && /^journal(?:-|$)/.test(type) ? firstText(work['container-title'], 500) : undefined;
  if (journal) bibliography.journal = journal;
  for (const [field, source] of [['volume', 'volume'], ['issue', 'issue'], ['pages', 'page']] as const) {
    const value = plainText(work[source], 300);
    if (value) bibliography[field] = value;
  }
  return bibliography;
}

/** Only DOI identifiers leave the device; webpage fallbacks use an explicit host allowlist. */
export function createBibliographyService(fetcher: typeof fetch = fetch) {
  const cache = new Map<string, { bibliography: BibliographyFields; expires: number }>();
  let active = 0;
  async function POST(request: Request) {
    if (!localRequest(request)) return json({ error: '书目信息补全仅供本机使用。' }, 403);
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return json({ error: '请使用 JSON 提交 DOI。' }, 415);
    if (Number(request.headers.get('content-length')) > maxRequestBytes) return json({ error: '请求内容过大，请只提交 DOI。' }, 413);
    let body: Record<string, unknown> | undefined;
    try { body = record(JSON.parse(await boundedText(request.body, maxRequestBytes, 413))); }
    catch (error) {
      return json({ error: error instanceof BibliographyError ? error.message : '请求格式不正确，请提交有效 DOI。' }, error instanceof BibliographyError ? error.status : 400);
    }
    const doi = normalizeDoi(body?.doi);
    if (!doi || doi.length > 256) return json({ error: '请输入有效 DOI，例如 10.1000/example。' }, 400);
    if (request.signal.aborted) return json({ error: '书目信息补全已取消。' }, 408);
    const cached = cache.get(doi);
    if (cached && cached.expires > Date.now()) return json({ bibliography: cached.bibliography });
    if (cached) cache.delete(doi);
    if (active >= 4) return json({ error: '正在补全其他文献，请稍后重试。' }, 429);
    active++;
    const deadline = AbortSignal.timeout(timeoutMs);
    const signal = AbortSignal.any([request.signal, deadline]);
    try {
      let bibliography: BibliographyFields | undefined;
      let providerError: unknown;
      try {
        const response = await fetcher(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
          // Workerd supports follow/manual, but not the browser's "error" mode.
          // Manual keeps redirects disabled; the non-2xx check below rejects them.
          method: 'GET', redirect: 'manual', signal: AbortSignal.any([signal, AbortSignal.timeout(7000)]),
          headers: { Accept: 'application/json', 'User-Agent': 'Lumior/0.1 (local bibliographic metadata lookup)' },
        });
        if (response.status === 404) throw new BibliographyError('Crossref 未找到该 DOI；可核对 DOI 或手动填写书目信息。', 404);
        if (response.status === 429 || response.status >= 500) throw new BibliographyError('书目信息服务暂时繁忙，请稍后重试。', 503);
        if (!response.ok || response.redirected) throw new BibliographyError('书目信息服务返回异常，未补全，请稍后重试。', 502);
        if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) throw new BibliographyError('书目信息服务返回格式不正确，未补全。', 502);
        if (Number(response.headers.get('content-length')) > maxProviderBytes) {
          await response.body?.cancel().catch(() => {});
          throw new BibliographyError('书目信息服务返回内容过大，请稍后重试。', 502);
        }
        let payload: unknown;
        try { payload = JSON.parse(await boundedText(response.body, maxProviderBytes, 502)); }
        catch (error) { throw error instanceof BibliographyError ? error : new BibliographyError('书目信息服务返回格式不正确，未补全。', 502); }
        bibliography = crossrefFields(payload, doi);
      } catch (error) { providerError = error; }
      if (!bibliography?.title || !bibliography.authors?.length || !bibliography.year || !bibliography.journal || !bibliography.type || !bibliography.pages || !bibliography.volume || !bibliography.issue) {
        try {
          const webpage = await lookupCnkiPage(doi, fetcher, AbortSignal.any([signal, AbortSignal.timeout(8000)]));
          if (webpage) bibliography = { ...webpage, ...Object.fromEntries(Object.entries(bibliography || {}).filter(([, value]) => value !== undefined)) };
        } catch { /* A failed webpage must not discard usable registry fields. */ }
      }
      if (!bibliography || !Object.entries(bibliography).some(([key, value]) => !['doi', 'url'].includes(key) && value !== undefined)) {
        throw providerError || new BibliographyError('未找到可补全的书目信息，请手动填写。', 404);
      }
      if (signal.aborted) throw signal.reason;
      if (cache.size >= 128) cache.delete(cache.keys().next().value!);
      cache.set(doi, { bibliography, expires: Date.now() + cacheLifetimeMs });
      return json({ bibliography });
    } catch (error) {
      if (request.signal.aborted) return json({ error: '书目信息补全已取消。' }, 408);
      if (deadline.aborted || (error instanceof Error && error.name === 'TimeoutError')) return json({ error: '书目信息补全超时，请稍后重试或手动填写。' }, 504);
      return json({ error: error instanceof BibliographyError ? error.message : '暂时无法连接书目信息服务，请检查网络后重试。' }, error instanceof BibliographyError ? error.status : 502);
    } finally { active--; }
  }
  return { POST };
}
