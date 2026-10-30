import { normalizeDoi, type BibliographyFields } from './bibliography.ts';

const allowedHosts = new Set(['doi.org', 'www.chndoi.org', 'chndoi.org', 'link.cnki.net', 'link.oversea.cnki.net', 'kns.cnki.net', 'kns.cnki.net.cn']);
export function cnkiPageUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && allowedHosts.has(url.hostname) ? url : undefined;
  } catch { return undefined; }
}
function text(value: string): string {
  return value.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<[^>]*>/g, '').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, name: string) => {
      const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
      if (!name.startsWith('#')) return named[name.toLowerCase()];
      const point = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : '';
    }).replace(/<[^>]*>/g, '').replace(/[\s\p{Cc}]+/gu, ' ').trim();
}

/** Accept only explicit bibliographic labels or citation metadata, with a matching DOI. */
export function parseCnkiBibliography(html: string, doi: string): BibliographyFields | undefined {
  html = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  const meta = new Map<string, string[]>(), labels = new Map<string, string>();
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = new Map<string, string>();
    for (const match of tag[0].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs.set(match[1].toLowerCase(), text(match[2] ?? match[3]));
    const key = (attrs.get('name') || attrs.get('property') || '').toLowerCase(), value = attrs.get('content');
    if (key && value) meta.set(key, [...(meta.get(key) || []), value]);
  }
  for (const match of html.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label\s*>([\s\S]*?)(?=<\/td\s*>|<label\b)/gi)) {
    labels.set(text(match[1]).replace(/[：:]\s*$/, ''), text(match[2]));
  }
  const pageDoi = meta.get('citation_doi')?.[0] || labels.get('DOI码') || labels.get('DOI');
  if (normalizeDoi(pageDoi) !== doi) return undefined;
  const fields: BibliographyFields = { doi, url: `https://doi.org/${doi.split('/').map(encodeURIComponent).join('/')}` };
  const take = (key: 'title' | 'journal' | 'volume' | 'issue' | 'pages', value: string | undefined, limit: number) => {
    if (value && value.length <= limit) fields[key] = value;
  };
  take('title', meta.get('citation_title')?.[0] || labels.get('题名'), 2000);
  take('journal', meta.get('citation_journal_title')?.[0] || labels.get('来源'), 500);
  take('volume', meta.get('citation_volume')?.[0] || labels.get('卷'), 300);
  take('issue', meta.get('citation_issue')?.[0] || labels.get('期'), 300);
  const first = meta.get('citation_firstpage')?.[0], last = meta.get('citation_lastpage')?.[0];
  take('pages', first ? (last && last !== first ? `${first}-${last}` : first) : labels.get('页码'), 300);
  const authors = (meta.get('citation_author') || [labels.get('作者') || '']).flatMap(value => value.split(/[;；]/)).map(value => value.trim()).filter(Boolean);
  if (authors.length && authors.length <= 500 && authors.every(value => value.length <= 300)) fields.authors = authors;
  const date = meta.get('citation_publication_date')?.[0] || labels.get('出版年');
  const year = date?.match(/^(\d{4})(?:$|[-/年])/); // Never registration time or DOI suffix.
  if (year && +year[1] > 0 && +year[1] < 3000) fields.year = +year[1];
  if (meta.get('citation_journal_title')?.[0]) fields.type = 'journal-article';
  return Object.keys(fields).some(key => !['doi', 'url'].includes(key)) ? fields : undefined;
}

export async function lookupCnkiPage(doi: string, fetcher: typeof fetch, signal: AbortSignal): Promise<BibliographyFields | undefined> {
  if (!/\/[^\s]*cnki[.]/i.test(doi) && !doi.startsWith('10.15897/')) return undefined;
  let url = new URL(`https://doi.org/${doi.split('/').map(encodeURIComponent).join('/')}`);
  for (let hop = 0; hop < 5; hop++) {
    signal.throwIfAborted();
    const response = await fetcher(url.href, { redirect: 'manual', signal, headers: { Accept: 'text/html', 'User-Agent': 'Lumior/0.1 (local bibliographic metadata lookup)' } });
    if (response.redirected) { await response.body?.cancel(); return undefined; }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      const next = location && cnkiPageUrl(new URL(location, url).href);
      if (!next) return undefined;
      url = next; continue;
    }
    if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes('text/html') || Number(response.headers.get('content-length')) > 1024 * 1024) {
      await response.body?.cancel(); return undefined;
    }
    if (!response.body) return undefined;
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 1024 * 1024) { await reader.cancel(); return undefined; }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const charset = response.headers.get('content-type')?.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1];
    const html = new TextDecoder(charset && /^(gb2312|gbk|gb18030)$/i.test(charset) ? 'gb18030' : 'utf-8').decode(bytes);
    signal.throwIfAborted();
    return parseCnkiBibliography(html, doi);
  }
  return undefined;
}
