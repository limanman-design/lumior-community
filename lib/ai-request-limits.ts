import type { AiProvider } from './ai-providers.ts';

export function isKimiK3(provider: AiProvider, model: string): boolean {
  return provider === 'kimi' && /^kimi-k3(?:[._-]|$)/.test(model);
}

export function modelRequestTimeoutMs(provider: AiProvider, model: string): number {
  return isKimiK3(provider, model) ? 600_000 : 180_000;
}

// One deadline covers both connection and response reading. Unlike
// AbortSignal.timeout, this timer can be released when the call finishes.
export function createModelRequestLimit(provider: AiProvider, model: string, parent: AbortSignal) {
  const deadline = new AbortController();
  const signal = AbortSignal.any([parent, deadline.signal]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => { if (timer !== undefined) { clearTimeout(timer); timer = undefined; } };
  if (!parent.aborted) {
    timer = setTimeout(() => {
      timer = undefined;
      deadline.abort(new DOMException('Model request deadline exceeded', 'TimeoutError'));
    }, modelRequestTimeoutMs(provider, model));
    parent.addEventListener('abort', clear, { once: true });
  }
  return {
    signal,
    dispose() { clear(); parent.removeEventListener('abort', clear); },
    error(error: unknown): unknown {
      if (parent.aborted) return parent.reason || new DOMException('已停止', 'AbortError');
      if (deadline.signal.aborted) return new Error(isKimiK3(provider, model)
        ? 'Kimi K3 本次响应超过 10 分钟，尚未完成；请拆分问题或缩小资料范围后重试。'
        : '模型本次响应超过 3 分钟，尚未完成；请缩小资料范围后重试。');
      return error;
    },
  };
}
