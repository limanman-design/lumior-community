import { providerResearchCall, type ModelCall } from './ai-provider.ts';
import { aiProviders, isResearchModel, parseModelSelection, providerConfig, type AiSettings, type AiProvider } from './ai-providers.ts';
import { defaultAiReasoningEffort, type AiReasoningEffort } from './ai-reasoning.ts';
import { createTrialTask, defaultTrialModel, loadTrialAccount, requireTrialAccount, TrialError, type TrialAccount, type TrialTask } from './ai-trial.ts';

export type AiEffortPolicy = AiReasoningEffort | ((tools?: unknown[]) => AiReasoningEffort);
export type AiAccess = {
  settings: AiSettings;
  provider: AiProvider;
  model: string;
  key?: string;
  account?: TrialAccount;
};

/** One source selection for every product feature. Trial never falls back to a
 * personal key, even when both credentials are present. No feature entitlement. */
export async function resolveAiAccess(settings: AiSettings, selection?: string, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<AiAccess> {
  const account = settings.usageMode === 'trial' ? await loadTrialAccount(settings, fetcher, signal) : undefined;
  if (account) requireTrialAccount(account);
  const defaultProvider = account?.defaultProvider || settings.provider || 'deepseek';
  const chosen = !selection || selection === 'auto'
    ? { provider: defaultProvider, model: account ? defaultTrialModel(account)!.model : providerConfig(settings, defaultProvider).model }
    : parseModelSelection(selection, defaultProvider);
  if (!chosen || !isResearchModel(chosen.provider, chosen.model)) throw new TrialError('该模型不支持当前功能，请重新选择。', 400);
  if (account) {
    if (!account.providers.some(item => item.id === chosen.provider && item.model === chosen.model)) throw new TrialError('该模型未提供体验额度，请选择当前可用的体验模型。', 400);
    return { settings, ...chosen, account };
  }
  const key = providerConfig(settings, chosen.provider).key;
  if (!key || key.includes('在这里')) throw new TrialError(settings.missingKeyMessage || `请先在 Lumior 设置 → AI 服务中配置 ${aiProviders.find(item => item.id === chosen.provider)!.name} API Key。`, 503);
  return { settings, ...chosen, key };
}

export function personalAiCall(provider: AiAccess['provider'], key: string, model: string, signal: AbortSignal, fetcher: typeof fetch, policy: AiEffortPolicy = defaultAiReasoningEffort): ModelCall {
  const calls = new Map<AiReasoningEffort, ModelCall>();
  return (messages, tools, choice) => {
    signal.throwIfAborted();
    const effort = typeof policy === 'function' ? policy(tools) : policy;
    if (!calls.has(effort)) calls.set(effort, providerResearchCall(provider, key, model, signal, fetcher, effort));
    return calls.get(effort)!(messages, tools, choice);
  };
}

/** A user action owns one task, including planning, validation and repairs.
 * New AI features default to research; kind is diagnostic, not authorization.
 * Always finish in finally, including cancellation and failures. */
export async function createAiTask(access: AiAccess, signal: AbortSignal, fetcher: typeof fetch = fetch, policy: AiEffortPolicy = defaultAiReasoningEffort, kind: 'research' | 'translation' = 'research'): Promise<TrialTask> {
  signal.throwIfAborted();
  if (access.account) return createTrialTask(access.settings, access.account, kind, access.provider, access.model, signal, fetcher, policy);
  return { call: personalAiCall(access.provider, access.key!, access.model, signal, fetcher, policy), finish: async () => {} };
}
