import { readAiBoardGeneration, type AiBoardGeneration } from './ai-board-generation.ts';
import { readAiBoardActions, type AiBoardActions } from './ai-board-tools.ts';

export type AiStreamEvent =
  | { type: 'start'; model: string }
  | { type: 'delta'; text: string }
  | { type: 'progress'; message: string }
  | { type: 'task_mode'; mode: 'operation' | 'conversation' }
  | { type: 'card_activity'; cardIds: string[] }
  | { type: 'evidence'; indices: number[]; citationFormat?: import('./ai-citations.ts').AiCitationFormat }
  | ({ type: 'coverage' } & import('./ai-research.ts').Coverage)
  | { type: 'board_generation'; generation: AiBoardGeneration }
  | { type: 'board_actions'; actions: AiBoardActions; operationOnly?: boolean }
  | { type: 'done'; reason: string }
  | { type: 'error'; message: string };

export function encodeAiEvent(event: AiStreamEvent) {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

// Network chunks can split SSE frames, UTF-8 characters and CRLF boundaries.
export async function* sseData(stream: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<string> {
  const reader = stream.getReader(), decoder = new TextDecoder();
  let buffer = '', lines: string[] = [];
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
    while (true) {
      const { value, done } = await reader.read();
      if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (!line) { if (lines.length) yield lines.join('\n'); lines = []; }
        else if (line.startsWith('data:')) lines.push(line.slice(5).replace(/^ /, ''));
      }
      if (buffer.length > 1_000_000) throw new Error('模型响应格式异常，请重试。');
      if (done) {
        if (buffer.startsWith('data:')) lines.push(buffer.slice(5).replace(/^ /, '').replace(/\r$/, ''));
        if (lines.length) yield lines.join('\n');
        break;
      }
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function readAiStream(response: Response, onEvent: (event: AiStreamEvent) => void, signal?: AbortSignal) {
  if (!response.ok) {
    const result = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(result?.error || '请求失败，请稍后重试。');
  }
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('模型响应格式不正确，请重试。');
  for await (const data of sseData(response.body, signal)) {
    let event: AiStreamEvent;
    try {
      const parsed: unknown = JSON.parse(data);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      event = parsed as AiStreamEvent;
    } catch { throw new Error('模型响应格式不正确，请重试。'); }
    if (event.type === 'error') throw new Error(event.message || '连接中断，请重试。');
    if ((event.type === 'start' && typeof event.model === 'string') || (event.type === 'delta' && typeof event.text === 'string')) onEvent(event);
    else if (event.type === 'progress' && typeof event.message === 'string') onEvent(event);
    else if (event.type === 'task_mode' && ['operation', 'conversation'].includes(event.mode)) onEvent(event);
    else if (event.type === 'card_activity' && Array.isArray(event.cardIds) && event.cardIds.length <= 3000 && event.cardIds.every(id => typeof id === 'string' && id.length > 0 && id.length <= 200) && new Set(event.cardIds).size === event.cardIds.length) onEvent(event);
    else if (event.type === 'evidence' && Array.isArray(event.indices) && event.indices.every(index => Number.isInteger(index) && index >= 0) && (event.citationFormat === undefined || event.citationFormat === 'lumior-v1')) onEvent(event);
    else if (event.type === 'coverage' && typeof event.task === 'string' && ['availableCards', 'targetCards', 'readCards', 'readPassages', 'totalPassages'].every(key => Number.isInteger(event[key as keyof typeof event]) && Number(event[key as keyof typeof event]) >= 0) && typeof event.complete === 'boolean') onEvent(event);
    else if (event.type === 'board_generation') onEvent({ type: 'board_generation', generation: readAiBoardGeneration(event.generation) });
    else if (event.type === 'board_actions') onEvent({ type: 'board_actions', actions: readAiBoardActions(event.actions), ...(event.operationOnly === true ? { operationOnly: true } : {}) });
    else if (event.type === 'done' && typeof event.reason === 'string') { onEvent(event); return; }
    else throw new Error('模型响应格式不正确，请重试。');
  }
  throw new Error('连接中断，已保留收到的内容。');
}
