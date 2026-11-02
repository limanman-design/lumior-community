export type DocumentMediaKind = 'image' | 'video' | 'audio' | 'file';

/** Only replace an empty plain paragraph; lists, headings and nested content
 * retain their structure. Recheck after the asynchronous file write as well. */
export function emptyMediaParagraph(block: { type: string; content?: unknown; children?: readonly unknown[] }): boolean {
  return block.type === 'paragraph' && !block.children?.length && Array.isArray(block.content)
    && block.content.every(item => item && item.type === 'text' && typeof item.text === 'string' && item.text.length === 0);
}

/** Finder and clipboard files can arrive without a MIME type. */
export function documentMediaKind(file: Pick<File, 'name' | 'type'>): DocumentMediaKind {
  const type = file.type.toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (type && type !== 'application/octet-stream') return 'file';
  const extension = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() : undefined;
  if (extension && ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'bmp'].includes(extension)) return 'image';
  if (extension && ['mp4', 'webm', 'mov', 'm4v', 'ogv'].includes(extension)) return 'video';
  if (extension && ['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac', 'opus'].includes(extension)) return 'audio';
  return 'file';
}
