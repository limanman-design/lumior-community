import type {SourceParagraph} from '../lib/pdf-paragraphs';
import type { VideoCue } from './video-transcript';

export type ReadingChunk = { text: string; page?: number; time?: number; end?: number };
export type ReadingDocument = {
  version: 1; key: string; kind: 'pdf' | 'video'; readAt: number;
  pages?: { page: number; text: string; paragraphs?:SourceParagraph[] }[]; total: number; emptyPages: number[]; characters: number; chunks: ReadingChunk[];
};
export type ReadingState = {
  status: 'idle' | 'loading' | 'reading' | 'ready' | 'empty' | 'error' | 'cancelled';
  document?: ReadingDocument; progress?: number; total?: number; message?: string; cacheError?: boolean;
};
type TextItem = { str?: string; hasEOL?: boolean; transform?: number[]; width?: number; height?: number };

export function awaitReadingTask<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void operation.catch(() => {}); return Promise.reject(signal.reason || new DOMException('读取已停止', 'AbortError')); }
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason || new DOMException('读取已停止', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    operation.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}

// Keep the PDF's text order and line breaks. This is text extraction, not OCR
// or equation reconstruction; all chunks retain their physical page number.
export function pdfPageText(items: TextItem[]) {
  let text = '', previous: TextItem | undefined;
  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    const value = item.str.split('\u0000').join('');
    const line = previous?.hasEOL || (previous?.transform && item.transform &&
      Math.abs(previous.transform[5] - item.transform[5]) > Math.max(2, (item.height || 10) * .6));
    const space = text && !/\s$/.test(text) && !/^\s/.test(value) &&
      !(/[\p{Script=Han}]$/u.test(text) && /^[\p{Script=Han}，。！？；：]/u.test(value));
    text += (line ? '\n' : space ? ' ' : '') + value;
    previous = item;
  }
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function pageChunks(text: string, page: number): ReadingChunk[] {
  const chunks: ReadingChunk[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + 1600);
    if (end < text.length) {
      const boundary = Math.max(text.lastIndexOf('\n', end), text.lastIndexOf('. ', end), text.lastIndexOf('。', end));
      if (boundary > start + 900) end = boundary + 1;
    }
    const value = text.slice(start, end).trim();
    if (value) chunks.push({ text: value, page });
    if (end === text.length) break;
    start = end - 160; // Context overlap never crosses a page boundary.
  }
  return chunks;
}

export function captionChunks(cues: VideoCue[]): ReadingChunk[] {
  const chunks: ReadingChunk[] = [];
  let group: VideoCue[] = [];
  const flush = () => {
    if (group.length) chunks.push({ text: group.map(cue => cue.text).join(' '), time: group[0].time, end: group.at(-1)!.end });
    group = [];
  };
  for (const cue of cues) {
    if (group.length && (cue.end - group[0].time > 75 || group.reduce((n, item) => n + item.text.length, 0) + cue.text.length > 1600 || cue.time - group.at(-1)!.end > 20)) flush();
    // Very long individual cues still have a reliable timestamp.
    if (cue.text.length > 1600) { flush(); chunks.push(...pageChunks(cue.text, 1).map(({ text }) => ({ text, time: cue.time, end: cue.end }))); }
    else group.push(cue);
  }
  flush();
  return chunks;
}

function terms(text: string) {
  const normalized = text.normalize('NFKC').toLocaleLowerCase();
  const values: string[] = normalized.match(/[a-z\d][a-z\d_-]{1,}/g) || [];
  for (const han of normalized.match(/[\p{Script=Han}]+/gu) || []) {
    if (han.length === 1) values.push(han);
    for (let i = 0; i < han.length - 1; i++) values.push(han.slice(i, i + 2));
  }
  return [...new Set(values)].slice(0, 150);
}

// Local keyword retrieval, with distributed passages for broad overview queries.
// No embedding service or model call is used to prepare these source passages.
export function relevantChunks(document: ReadingDocument, question: string, limit = 3) {
  if (!document.chunks.length || limit <= 0) return [];
  const query = terms(question);
  if (!query.length) {
    return [...new Set([0, Math.floor(document.chunks.length / 2), document.chunks.length - 1])].filter(index => index >= 0).slice(0, limit).map(index => document.chunks[index]);
  }
  const ranked = document.chunks.map((chunk, index) => {
    const value = chunk.text.normalize('NFKC').toLocaleLowerCase();
    return { chunk, index, score: query.reduce((score, term) => score + (value.includes(term) ? 1 + Math.min(3, term.length / 4) : 0), 0) };
  }).sort((a, b) => b.score - a.score || a.index - b.index);
  const meaningful = ranked.filter(item => item.score > 0);
  if (meaningful.length) return meaningful.slice(0, limit).map(item => item.chunk);
  const indices = [...new Set([0, Math.floor(document.chunks.length / 2), document.chunks.length - 1])].filter(index => index >= 0);
  return indices.slice(0, limit).map(index => document.chunks[index]);
}
