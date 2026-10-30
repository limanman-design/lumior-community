import type { ModelCall } from '../ai-provider.ts';
import { personalAiCall } from '../ai-runtime.ts';
import type { ThesisProvider } from './providers.ts';

// The original skills run directly; there is no separate scope classifier.
export function thesisReasoningEffort() {
  return 'high' as const;
}

/** Retained for isolated personal-key evaluations; product requests use the
 * shared task lifecycle with this same policy in either billing mode. */
export function thesisModelCall(key: string, model: string, signal: AbortSignal, fetcher: typeof fetch = fetch, provider: ThesisProvider = 'deepseek'): ModelCall {
  return personalAiCall(provider, key, model, signal, fetcher, thesisReasoningEffort);
}
