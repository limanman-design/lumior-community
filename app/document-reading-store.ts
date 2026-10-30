'use client';
import {pdfParagraphs} from '../lib/pdf-paragraphs';
import type { Card } from './canvas-model';
import { serializeWorkspace } from './workspace-assets';
import { awaitReadingTask, captionChunks, pageChunks, pdfPageText, type ReadingDocument, type ReadingState } from './document-reading.ts';
import { fetchVideoCues } from './video-caption-loader.ts';

const idle: ReadingState = { status: 'idle' };
const states = new Map<string, ReadingState>(), listeners = new Map<string, Set<() => void>>();
const jobs = new Map<string, { controller: AbortController; promise: Promise<ReadingDocument> }>(), loads = new Map<string, Promise<void>>();
let database: Promise<IDBDatabase> | undefined;
let revision = 0;
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => jobs.forEach(job => job.controller.abort()));
export const readingRevision = () => revision;
export function readingKey(card: Card) {
  if (card.kind === 'pdf' && card.pdf) return `v1:pdf:${serializeWorkspace(card.pdf.url)}:${card.pdf.size}`;
  if (card.kind === 'video' && card.video) return `v1:video:${serializeWorkspace(card.video.localUrl || card.video.youtubeId || card.video.url)}:${serializeWorkspace(card.video.transcriptUrl || '')}:${serializeWorkspace(card.video.subtitleUrl || '')}`;
  return '';
}
function publish(key: string, state: ReadingState) { states.set(key, state); revision++; listeners.get(key)?.forEach(listener => listener()); }
export function readingState(card: Card) { return states.get(readingKey(card)) || idle; }
export function subscribeReading(card: Card, listener: () => void) {
  const key = readingKey(card), group = listeners.get(key) || new Set();
  group.add(listener); listeners.set(key, group);
  return () => { group.delete(listener); if (!group.size) listeners.delete(key); };
}
function openDatabase() {
  if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('lumior-reading-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('documents', { keyPath: 'key' });
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); database = undefined; }; resolve(request.result); };
    request.onerror = request.onblocked = () => { database = undefined; reject(new Error('读取缓存暂时不可用')); };
  });
  return database;
}
export async function warmReading(card: Card) {
  const key = readingKey(card);
  if (!key || states.has(key)) return;
  const existing = loads.get(key); if (existing) return existing;
  const load = (async () => {
    try {
      const db = await openDatabase();
      const document = await new Promise<ReadingDocument | undefined>((resolve, reject) => {
        const request = db.transaction('documents').objectStore('documents').get(key);
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      if (document?.version === 1 && document.key === key && Array.isArray(document.emptyPages) && Number.isFinite(document.total) && Number.isFinite(document.characters) && Array.isArray(document.chunks) && document.chunks.every(chunk => typeof chunk.text === 'string')) publish(key, { status: document.chunks.length ? 'ready' : 'empty', document });
    } catch { /* A disposable cache failure must not prevent local extraction. */ }
    finally { loads.delete(key); }
  })();
  loads.set(key, load); return load;
}
async function cacheDocument(document: ReadingDocument) {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('documents', 'readwrite'), store = transaction.objectStore('documents');
    store.put(document);
    const records = store.getAll();
    records.onsuccess = () => {
      const values = (records.result as ReadingDocument[]).sort((a, b) => b.readAt - a.readAt);
      let characters = 0;
      values.forEach((value, index) => { characters += value.characters; if (index >= 30 || characters > 10_000_000) store.delete(value.key); });
    };
    transaction.oncomplete = () => resolve(); transaction.onerror = transaction.onabort = () => reject(transaction.error);
  });
}
let queue: Promise<unknown> = Promise.resolve();
export async function readDocument(card: Card, force = false): Promise<ReadingDocument> {
  const key = readingKey(card);
  if (!key) throw new Error('这张卡片没有可读取的文件');
  await warmReading(card);
  const state = readingState(card);
  if (!force && state.document) return state.document;
  const existing = jobs.get(key); if (existing) return existing.promise;
  const controller = new AbortController(), signal = controller.signal;
  const check = () => { if (signal.aborted) throw signal.reason || new DOMException('读取已停止', 'AbortError'); };
  publish(key, { status: 'reading', progress: 0, message: '等待本机读取…', document: state.document });
  const operation = queue.catch(() => {}).then(async () => {
    check();
    const timeout = setTimeout(() => controller.abort(new DOMException('资料读取超时，请重试', 'TimeoutError')), 300_000);
    try {
      const document: ReadingDocument = { version: 1, key, kind: card.kind as 'pdf' | 'video', readAt: Date.now(), pages: [], total: 0, emptyPages: [], characters: 0, chunks: [] };
      if (card.kind === 'pdf' && card.pdf) {
        const { acquirePdf } = await import('./pdf-runtime');
        check(); const handle = acquirePdf(card.pdf.url);
        try {
          const pdf = await awaitReadingTask(handle.promise, signal); check(); document.total = pdf.numPages;
          if (pdf.numPages > 500) throw new Error('这个 PDF 超过 500 页，暂不支持整份读取');
          for (let page = 1; page <= pdf.numPages; page++) {
            check();
            const pdfPage = await awaitReadingTask(pdf.getPage(page), signal);
            const content = await awaitReadingTask(pdfPage.getTextContent(), signal); check();
            const text = pdfPageText(content.items.filter(item => 'str' in item));
            document.pages!.push({ page, text,paragraphs:pdfParagraphs(content.items.filter(item=>'str' in item),text,pdfPage.getViewport({scale:1})) });
            document.characters += text.length;
            if (document.characters > 2_000_000) throw new Error('这个 PDF 的文字过多，暂不支持整份读取');
            if (text) document.chunks.push(...pageChunks(text, page)); else document.emptyPages.push(page);
            publish(key, { status: 'reading', progress: page, total: pdf.numPages, document: state.document, message: `正在读取第 ${page} / ${pdf.numPages} 页` });
            // Yield between pages to keep controls responsive, even for cached PDFs.
            await new Promise(resolve => setTimeout(resolve, 0));
          }
        } finally { handle.release(); }
      } else {
        const cues = await fetchVideoCues(card.video!, signal); check();
        document.total = cues.length; document.characters = cues.reduce((sum, cue) => sum + cue.text.length, 0);
        if (document.characters > 2_000_000) throw new Error('字幕文字过多，暂不支持整份读取');
        document.chunks = captionChunks(cues);
      }
      check(); let cacheError = false;
      try { await awaitReadingTask(cacheDocument(document), signal); } catch { check(); cacheError = true; }
      check();
      publish(key, { status: document.chunks.length ? 'ready' : 'empty', document, cacheError });
      // Keep only a few inactive full documents in memory; the rest remain in IDB.
      const inactive = [...states].filter(([id, value]) => id !== key && !listeners.has(id) && !jobs.has(id) && value.document);
      inactive.slice(0, Math.max(0, inactive.length - 5)).forEach(([id]) => states.delete(id));
      return document;
    } finally { clearTimeout(timeout); }
  }).catch(error => {
    const cancelled = signal.aborted && signal.reason?.name !== 'TimeoutError';
    publish(key, { status: cancelled ? 'cancelled' : 'error', document: state.document, message: cancelled ? '读取已停止' : error instanceof Error ? error.message : '资料读取失败，请重试' });
    throw error;
  }).finally(() => jobs.delete(key));
  jobs.set(key, { controller, promise: operation }); queue = operation;
  return operation;
}
export function cancelReading(card: Card) {
  const key = readingKey(card), job = jobs.get(key);
  if (job) { job.controller.abort(); publish(key, { status: 'cancelled', document: readingState(card).document, message: '读取已停止' }); }
}
export async function waitForReading(card: Card, signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
  const operation = readDocument(card);
  return new Promise<ReadingDocument>((resolve, reject) => {
    const abort = () => reject(new DOMException('Stopped', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
