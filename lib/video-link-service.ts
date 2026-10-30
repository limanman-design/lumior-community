import { bilibiliShortUrl, parseVideoUrl } from '../app/video-url.ts';

const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers });

async function smallJson(request: Request): Promise<unknown> {
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > 4096)) throw new RangeError('Body is too large');
  if (!request.body) throw new Error('Missing body');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 4096) { await reader.cancel(); throw new RangeError('Body is too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** Expand only Bilibili's short-link redirects. Never fetch a final destination or its HTML. */
export function createVideoLinkService(fetcher: typeof fetch = fetch) {
  return async function videoLink(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      request.headers.get('origin') && request.headers.get('origin') !== url.origin ||
      request.headers.get('sec-fetch-site') === 'cross-site') return json({ error: '当前视频短链接接口仅供本机使用。' }, 403);
    if (request.method !== 'POST') return json({ error: '请使用 POST。' }, 405);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) return json({ error: '请求格式无效。' }, 415);
    let input: unknown;
    try { input = await smallJson(request); }
    catch (error) { return json({ error: '视频地址请求无效。' }, error instanceof RangeError ? 413 : 400); }
    const address = input && typeof input === 'object' && !Array.isArray(input) ? (input as { url?: unknown }).url : undefined;
    let current = typeof address === 'string' ? bilibiliShortUrl(address) : null;
    if (!current) return json({ error: '请提供哔哩哔哩 b23.tv 视频短链接。' }, 400);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(5000)]);
    const seen = new Set<string>();
    try {
      for (let hop = 0; hop < 3; hop++) {
        if (seen.has(current)) throw new Error('Redirect loop');
        seen.add(current);
        const response = await fetcher(current, {
          method: 'GET', redirect: 'manual', credentials: 'omit',
          headers: { Accept: 'text/html' }, signal,
        });
        // Cancel unused response bodies; only Location is relevant to this resolver.
        if (response.body) await response.body.cancel();
        if (![301, 302, 303, 307, 308].includes(response.status)) throw new Error('No redirect');
        const location = response.headers.get('location');
        if (!location) throw new Error('Missing redirect');
        const next = new URL(location, current).href;
        const parsed = parseVideoUrl(next);
        if (parsed?.provider === 'bilibili') return json({ url: parsed.url });
        current = bilibiliShortUrl(next);
        if (!current) throw new Error('Unsupported redirect');
      }
    } catch {
      if (request.signal.aborted) return json({ error: '视频短链接请求已取消。' }, 499);
    }
    return json({ error: '短链接暂时无法解析，请在浏览器打开后复制完整视频地址。' }, 422);
  };
}
