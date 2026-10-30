import type { CardVideo } from './canvas-model';
import type { ImportedCard } from './file-import';
import { translate } from './i18n-core.ts';

export type VideoUrl = {
  provider: 'youtube' | 'bilibili';
  id: string;
  url: string;
  page?: number;
  startTime?: number;
};

const youtubeHosts = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);
const youtubeEmbedHosts = new Set(['youtube-nocookie.com', 'www.youtube-nocookie.com']);
const youtubeShortHosts = new Set(['youtu.be', 'www.youtu.be']);
const bilibiliHosts = new Set(['bilibili.com', 'www.bilibili.com', 'm.bilibili.com']);
const youtubeIdPattern = /^[A-Za-z0-9_-]{11}$/;
const bilibiliIdPattern = /^(?:BV[1-9A-HJ-NP-Za-km-z]{10}|av[1-9]\d*)$/;

function hasControlCharacters(text: string): boolean {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function webUrl(text: string): URL | null {
  const value = text.trim();
  if (!value || value.length > 2048 || /\s|\\/.test(value) || hasControlCharacters(value)) return null;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    return url;
  } catch { return null; }
}

function seconds(text: string | null): number | undefined {
  if (!text) return undefined;
  if (/^\d+$/.test(text)) {
    const value = Number(text);
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  }
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(text);
  if (!match || !match.slice(1).some(Boolean)) return undefined;
  const value = Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
  return Number.isSafeInteger(value) ? value : undefined;
}

/** Recognize one complete URL only; never fetch arbitrary pasted addresses. */
export function parseVideoUrl(text: string): VideoUrl | null {
  const url = webUrl(text);
  if (!url) return null;
  const host = url.hostname.toLowerCase();
  let id: string | undefined;
  if (youtubeShortHosts.has(host)) id = /^\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname)?.[1];
  else if (youtubeHosts.has(host) && url.pathname === '/watch') id = url.searchParams.get('v') || undefined;
  else if (youtubeHosts.has(host)) id = /^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname)?.[1];
  else if (youtubeEmbedHosts.has(host)) id = /^\/embed\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname)?.[1];
  if (id) {
    if (!youtubeIdPattern.test(id)) return null;
    const startTime = seconds(url.searchParams.get('t') || url.searchParams.get('start') || new URLSearchParams(url.hash.slice(1)).get('t'));
    const canonical = new URL('https://www.youtube.com/watch');
    canonical.searchParams.set('v', id);
    if (startTime) canonical.searchParams.set('t', `${startTime}s`);
    return { provider: 'youtube', id, url: canonical.href, ...(startTime ? { startTime } : {}) };
  }
  if (!bilibiliHosts.has(host)) return null;
  id = /^\/video\/(BV[1-9A-HJ-NP-Za-km-z]{10}|av[1-9]\d*)\/?$/.exec(url.pathname)?.[1];
  if (!id || !bilibiliIdPattern.test(id) || (id.startsWith('av') && !Number.isSafeInteger(Number(id.slice(2))))) return null;
  const rawPage = url.searchParams.get('p');
  const page = rawPage === null ? 1 : Number(rawPage);
  if (rawPage !== null && !/^[1-9]\d*$/.test(rawPage) || !Number.isSafeInteger(page) || page < 1) return null;
  const startTime = seconds(url.searchParams.get('t'));
  const canonical = new URL(`https://www.bilibili.com/video/${id}/`);
  if (page > 1) canonical.searchParams.set('p', String(page));
  if (startTime) canonical.searchParams.set('t', String(startTime));
  return { provider: 'bilibili', id, url: canonical.href, page, ...(startTime ? { startTime } : {}) };
}

/** Short links need a separate, restricted redirect resolver; keep this parser offline. */
export function isBilibiliShortUrl(text: string): boolean {
  return bilibiliShortUrl(text) !== null;
}

export function bilibiliShortUrl(text: string): string | null {
  const url = webUrl(text);
  if (!url || !['b23.tv', 'www.b23.tv'].includes(url.hostname.toLowerCase()) || !/^\/[A-Za-z0-9]{1,64}\/?$/.test(url.pathname)) return null;
  return `https://b23.tv${url.pathname.replace(/\/$/, '')}`;
}

export async function resolveVideoUrl(text: string, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<ImportedCard | null> {
  const direct = importVideoUrl(text);
  if (direct) return direct;
  const url = bilibiliShortUrl(text);
  if (!url) return null;
  const failed = () => new Error(translate('This Bilibili short link could not be resolved. Open it in your browser and copy the full bilibili.com/video address.', '无法识别这个哔哩哔哩短链接。请在浏览器打开后，复制完整的 bilibili.com/video 视频地址。'));
  try {
    const response = await fetcher('/api/video-link', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }),
      credentials: 'omit', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(7000)]) : AbortSignal.timeout(7000),
    });
    if (!response.ok) throw failed();
    const result = await response.json() as { url?: unknown };
    if (typeof result?.url !== 'string' || parseVideoUrl(result.url)?.provider !== 'bilibili') throw failed();
    return importVideoUrl(result.url);
  } catch {
    if (signal?.aborted) throw signal.reason;
    throw failed();
  }
}

export function importVideoUrl(text: string): ImportedCard | null {
  const parsed = parseVideoUrl(text);
  if (!parsed) return null;
  const youtube = parsed.provider === 'youtube';
  const sourceName = youtube ? 'YouTube' : translate('Bilibili', '哔哩哔哩');
  return {
    title: `${sourceName} · ${parsed.id}${parsed.page && parsed.page > 1 ? ` · P${parsed.page}` : ''}`,
    body: '', kind: 'video', sourceName, height: 360,
    video: {
      url: parsed.url, provider: parsed.provider, duration: 0,
      poster: youtube ? `https://i.ytimg.com/vi/${parsed.id}/hqdefault.jpg` : '',
      ...(youtube ? { youtubeId: parsed.id } : { bilibiliId: parsed.id, bilibiliPage: parsed.page }),
      ...(parsed.startTime ? { startTime: parsed.startTime } : {}),
    },
  };
}

export function bilibiliEmbedUrl(video: CardVideo, autoplay = false, startTime = video.startTime || 0): string | null {
  if (!validVideoProviderMetadata(video)) return null;
  const parsed = parseVideoUrl(video.url);
  if (parsed?.provider !== 'bilibili' || parsed.id !== video.bilibiliId) return null;
  const url = new URL('https://player.bilibili.com/player.html');
  url.searchParams.set(parsed.id.startsWith('BV') ? 'bvid' : 'aid', parsed.id.startsWith('BV') ? parsed.id : parsed.id.slice(2));
  url.searchParams.set('p', String(parsed.page || 1));
  url.searchParams.set('autoplay', autoplay ? '1' : '0');
  url.searchParams.set('poster', '1');
  url.searchParams.set('danmaku', '0');
  if (Number.isSafeInteger(startTime) && startTime > 0) url.searchParams.set('t', String(startTime));
  return url.href;
}

/** Validate only the new provider metadata; existing local and legacy YouTube records remain readable. */
export function validVideoProviderMetadata(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const video = value as CardVideo;
  if (video.provider !== undefined && video.provider !== 'youtube' && video.provider !== 'bilibili') return false;
  if (video.startTime !== undefined && (!Number.isSafeInteger(video.startTime) || video.startTime < 0)) return false;
  if (video.bilibiliPage !== undefined && (!Number.isSafeInteger(video.bilibiliPage) || video.bilibiliPage < 1)) return false;
  if (video.bilibiliId !== undefined || video.provider === 'bilibili') {
    if (typeof video.bilibiliId !== 'string' || !bilibiliIdPattern.test(video.bilibiliId) || video.localUrl || video.youtubeId || video.provider === 'youtube') return false;
    const parsed = typeof video.url === 'string' ? parseVideoUrl(video.url) : null;
    return parsed?.provider === 'bilibili' && parsed.id === video.bilibiliId && (video.bilibiliPage === undefined || parsed.page === video.bilibiliPage);
  }
  if (video.bilibiliPage !== undefined) return false;
  if (video.provider === 'youtube') {
    if (typeof video.youtubeId !== 'string' || !youtubeIdPattern.test(video.youtubeId)) return false;
    if (!video.localUrl) {
      const parsed = typeof video.url === 'string' ? parseVideoUrl(video.url) : null;
      return parsed?.provider === 'youtube' && parsed.id === video.youtubeId;
    }
  }
  return true;
}
