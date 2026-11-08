import type { ImportedCard } from './file-import';
import { translate } from './i18n-core.ts';

const hosts = new Set(['xiaohongshu.com', 'www.xiaohongshu.com', 'm.xiaohongshu.com', 'xhslink.com', 'www.xhslink.com']);

/** Offline share import. Never fetch a pasted address or interpret copied HTML. */
export function importXiaohongshuPaste(input: string): ImportedCard | null {
  const text = input.trim();
  if (!text || text.length > 50000) return null;
  const candidates = [...text.matchAll(/https?:\/\/[^\s<>"“”「」，。！？；、）【】]+/gi)];
  // A multi-link paste must not silently become a single-source card.
  if (candidates.length !== 1) return null;
  const raw = candidates[0][0].replace(/[，。！？；、）)\]】]+$/, '');
  if (raw.length > 4096) return null;
  for (let i = 0; i < raw.length; i++) if (raw[i] === '\\' || raw.charCodeAt(i) < 32 || raw.charCodeAt(i) === 127) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (!hosts.has(url.hostname.toLowerCase()) || url.username || url.password || url.port) return null;
  const short = url.hostname === 'xhslink.com' || url.hostname === 'www.xhslink.com';
  if (!(short ? /^\/(?:[A-Za-z0-9]+\/)?[A-Za-z0-9]+\/?$/ : /^\/(?:explore|discovery\/item)\/[a-fA-F0-9]{24}\/?$/).test(url.pathname)) return null;
  // Keep access query parameters intact; links open only on an explicit click.
  url.protocol = 'https:';
  const titleText = text.replace(raw, '').trim().split('\n').map(line => line.trim()).find(Boolean);
  const title = titleText ? titleText.slice(0, 100) : translate('Xiaohongshu note', '小红书笔记');
  return {
    kind: 'note', title, body: text, sourceName: translate('Xiaohongshu', '小红书'),
    blocks: [
      ...text.split(/\r?\n/).map(line => ({ type: 'paragraph' as const, content: [{ type: 'text' as const, text: line, styles: {} }] })),
      { type: 'paragraph', content: [{ type: 'link', href: url.href, content: [{ type: 'text', text: translate('Open original on Xiaohongshu', '在小红书打开原文'), styles: {} }] }] },
    ],
  };
}
