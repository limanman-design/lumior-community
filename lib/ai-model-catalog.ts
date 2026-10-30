import { aiProviders, isResearchModel, qualifiedModelId, type AiProvider } from './ai-providers.ts';

export type AiCatalogError = 'authentication' | 'permission' | 'rate_limited' | 'timeout' | 'network' | 'invalid_response' | 'empty' | 'upstream';
export type AiCatalogStatus = {
  source: 'live' | 'cached' | 'stale' | 'fallback';
  error?: AiCatalogError;
  lastSuccessfulAt?: number;
};
export type AiCatalogModel = { id: string; name: string; provider: AiProvider; model: string; listed: boolean };
type CatalogResult = { models: AiCatalogModel[]; catalog: AiCatalogStatus };
type Pending = { controller: AbortController; promise: Promise<CatalogResult>; consumers: number; settled: boolean };
type CacheEntry = {
  key: string; fallback: string; expires: number; result?: CatalogResult;
  successful?: { models: AiCatalogModel[]; at: number }; pending?: Pending;
};

class CatalogFailure extends Error {
  readonly code: AiCatalogError;
  constructor(code: AiCatalogError) { super(code); this.code = code; }
}

// Each caller can cancel independently. Stop the shared metadata request when
// nobody is waiting, without turning an interrupted read into a cached failure.
function waitForCatalog(pending: Pending, signal?: AbortSignal): Promise<CatalogResult> {
  pending.consumers++;
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (callback: () => void) => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener('abort', abort);
      pending.consumers--;
      if (!pending.settled && pending.consumers === 0) pending.controller.abort();
      callback();
    };
    const abort = () => finish(() => reject(new DOMException('Model list request cancelled.', 'AbortError')));
    pending.promise.then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });
}

export function createAiModelCatalog(fetcher: typeof fetch = fetch, { now = Date.now, timeoutMs = 10_000 } = {}) {
  const caches = new Map<AiProvider, CacheEntry>();
  async function read(provider: AiProvider, entry: CacheEntry, controller: AbortController): Promise<CatalogResult> {
    const modelEntry = (id: string, listed: boolean, name = id): AiCatalogModel => ({ id: qualifiedModelId(provider, id), name, provider, model: id, listed });
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]);
    try {
      const definition = aiProviders.find(item => item.id === provider)!;
      const response = await fetcher(`${definition.baseUrl}/models`, { headers: { Authorization: `Bearer ${entry.key}` }, signal });
      signal.throwIfAborted();
      if (!response.ok) {
        // Never include upstream response bodies, exception text, or credentials.
        void response.body?.cancel().catch(() => {});
        throw new CatalogFailure(response.status === 401 ? 'authentication' : response.status === 403 ? 'permission' : response.status === 429 ? 'rate_limited' : 'upstream');
      }
      let data: unknown;
      try { data = await response.json(); } catch (error) {
        if (signal.aborted) throw error;
        throw new CatalogFailure('invalid_response');
      }
      signal.throwIfAborted();
      if (!data || typeof data !== 'object' || !('data' in data) || !Array.isArray(data.data)) throw new CatalogFailure('invalid_response');
      const seen = new Set<string>();
      const models: AiCatalogModel[] = [];
      for (const value of data.data) {
        if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !isResearchModel(provider, value.id) || seen.has(value.id)) continue;
        if (provider === 'openai' && typeof value.shutdown_date === 'string'
          && /^\d{4}-\d{2}-\d{2}$/.test(value.shutdown_date) && Date.parse(value.shutdown_date) <= now()) continue;
        seen.add(value.id);
        const name = typeof value.display_name === 'string' ? value.display_name : typeof value.name === 'string' ? value.name : value.id;
        models.push(modelEntry(value.id, true, name.slice(0, 160)));
        if (models.length >= 300) break;
      }
      if (!models.length) throw new CatalogFailure('empty');
      if (isResearchModel(provider, entry.fallback) && !seen.has(entry.fallback)) models.unshift(modelEntry(entry.fallback, false));
      const at = now();
      const result: CatalogResult = { models, catalog: { source: 'live', lastSuccessfulAt: at } };
      entry.successful = { models, at };
      entry.result = result;
      entry.expires = at + 300_000;
      return result;
    } catch (error) {
      if (controller.signal.aborted) throw new DOMException('Model list request cancelled.', 'AbortError');
      const failure = error instanceof CatalogFailure ? error.code : signal.aborted ? 'timeout' : 'network';
      const previous = entry.successful;
      const result: CatalogResult = {
        models: previous?.models || (isResearchModel(provider, entry.fallback) ? [modelEntry(entry.fallback, false)] : []),
        catalog: { source: previous ? 'stale' : 'fallback', error: failure, ...(previous ? { lastSuccessfulAt: previous.at } : {}) },
      };
      entry.result = result;
      entry.expires = now() + 30_000;
      return result;
    }
  }
  return {
    clear(provider: AiProvider) {
      caches.get(provider)?.pending?.controller.abort();
      caches.delete(provider);
    },
    async get(provider: AiProvider, key: string, fallback: string, { refresh = false, signal }: { refresh?: boolean; signal?: AbortSignal } = {}): Promise<CatalogResult> {
      if (signal?.aborted) throw new DOMException('Model list request cancelled.', 'AbortError');
      let entry = caches.get(provider);
      if (!entry || entry.key !== key || entry.fallback !== fallback) {
        entry?.pending?.controller.abort();
        entry = { key, fallback, expires: 0 };
        caches.set(provider, entry);
      }
      if (!refresh && entry.result && entry.expires > now()) {
        const result = entry.result;
        return result.catalog.source === 'live' ? { ...result, catalog: { ...result.catalog, source: 'cached' } } : result;
      }
      if (!entry.pending || entry.pending.controller.signal.aborted) {
        const controller = new AbortController();
        const pending: Pending = { controller, promise: read(provider, entry, controller), consumers: 0, settled: false };
        entry.pending = pending;
        const owner = entry;
        const settled = () => {
          pending.settled = true;
          if (owner.pending === pending) owner.pending = undefined;
        };
        void pending.promise.then(settled, settled);
      }
      return waitForCatalog(entry.pending, signal);
    },
  };
}
