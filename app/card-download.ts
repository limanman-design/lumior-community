import type { Card } from './canvas-model';
import { fileReferencePrefix, serializeWorkspace, type StoredFile } from './workspace-assets.ts';

type DownloadSource = { url: string; name: string; kind: 'image' | 'pdf' | 'video' };

/** Select original media, never the PDF thumbnail or video poster. */
export function cardDownloadSource(card: Card): DownloadSource | undefined {
  if (card.kind === 'pdf' && card.pdf?.url)
    return { url: card.pdf.url, name: card.pdf.name || card.sourceName || card.title, kind: 'pdf' };
  if (card.kind === 'image' && card.image)
    return { url: card.image, name: card.sourceName || card.title, kind: 'image' };
  if (card.kind === 'video' && card.video?.localUrl)
    return { url: card.video.localUrl, name: card.sourceName || card.title, kind: 'video' };
}

const extensions: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
  'image/avif': 'avif', 'image/svg+xml': 'svg', 'video/mp4': 'mp4',
  'video/webm': 'webm', 'video/quicktime': 'mov', 'application/pdf': 'pdf',
};

export function mediaDownloadName(name: string, kind: DownloadSource['kind'], mime: string): string {
  const allowed = kind === 'pdf' ? ['pdf'] : kind === 'image' ? ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'svg'] : ['mp4', 'webm', 'mov'];
  const type = mime.split(';')[0].trim().toLowerCase();
  const safe = Array.from(name, char => char.charCodeAt(0) < 32 || /[\\/:*?"<>|\u007f]/.test(char) ? '_' : char).join('').replace(/[. ]+$/g, '').trim().slice(0, 160) || kind;
  const oldExtension = safe.split('.').at(-1)?.toLowerCase() || '';
  const extension = kind === 'pdf' ? 'pdf' : extensions[type] || (allowed.includes(oldExtension) ? oldExtension : kind === 'image' ? 'png' : 'mp4');
  if (!allowed.includes(extension)) throw new Error('Unexpected media type.');
  const stem = safe.replace(/\.[a-z0-9]{1,12}$/i, '');
  const basename = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem) ? `_${stem}` : stem;
  return `${basename || kind}.${extension}`;
}

export async function prepareCardDownload(card: Card, dependencies: {
  getFile?: (id: string) => Promise<StoredFile | undefined>;
  fetcher?: typeof fetch;
  origin?: string;
} = {}): Promise<{ blob: Blob; name: string }> {
  const source = cardDownloadSource(card);
  if (!source) throw new Error('No original attachment.');
  const reference = serializeWorkspace(source.url);
  let blob: Blob, name = source.name;
  if (reference.startsWith(fileReferencePrefix)) {
    const read = dependencies.getFile || (await import('./local-repository')).readStoredFile;
    const stored = await read(reference.slice(fileReferencePrefix.length));
    if (!stored) throw new Error('Original attachment is missing.');
    blob = stored.blob;
    name = stored.name || name;
  } else {
    const url = new URL(source.url, dependencies.origin || window.location.origin);
    if (!['http:', 'https:', 'blob:', 'data:'].includes(url.protocol) || url.username || url.password)
      throw new Error('Unsupported attachment address.');
    if (url.protocol === 'data:' && !/^data:(?:image\/(?:png|jpeg|webp|gif|avif|svg\+xml)|application\/pdf)[;,]/i.test(source.url))
      throw new Error('Unsupported attachment data.');
    const response = await (dependencies.fetcher || fetch)(url.href, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(30_000) });
    const limit = (source.kind === 'video' ? 250 : 25) * 1024 * 1024;
    if (!response.ok || !response.body || Number(response.headers.get('content-length')) > limit) {
      void response.body?.cancel().catch(() => {});
      throw new Error('Could not read the original attachment.');
    }
    const reader = response.body.getReader(), chunks: Uint8Array<ArrayBuffer>[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > limit) throw new Error('Attachment is too large.');
        chunks.push(new Uint8Array(part.value));
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    blob = new Blob(chunks, { type: response.headers.get('content-type') || '' });
  }
  if (!blob.size || /^(?:text\/html|application\/json)/i.test(blob.type)) throw new Error('Original attachment is unavailable.');
  return { blob, name: mediaDownloadName(name, source.kind, blob.type) };
}

export async function downloadCardAttachment(card: Card) {
  const file = await prepareCardDownload(card);
  const url = URL.createObjectURL(file.blob), link = document.createElement('a');
  link.href = url; link.download = file.name;
  document.body.appendChild(link);
  try { link.click(); }
  finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60_000); }
}
