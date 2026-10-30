import type { AiProviderConfig, AiSettings } from '../ai-providers.ts';

export type ThesisProvider = 'deepseek' | 'kimi';
export const thesisModels = [
  { id: 'kimi:kimi-k3.1-pro', provider: 'kimi', model: 'kimi-k3.1-pro', name: 'Kimi K3.1 Pro' },
] as const;
export const defaultThesisModel = thesisModels[0];
export function findThesisModel(value: unknown) {
  return thesisModels.find(item => item.id === value);
}
export const thesisProviderName = (provider: ThesisProvider) => provider === 'kimi' ? 'Kimi' : 'DeepSeek';
export type ThesisProviderSettings = Pick<AiSettings, 'usageMode' | 'trial' | 'provider' | 'missingKeyMessage'> & {
  key?: string;
  model?: string;
  providers?: Partial<Record<ThesisProvider, AiProviderConfig>>;
};
export function thesisProviderKey(settings: ThesisProviderSettings, provider: ThesisProvider) {
  return settings.providers?.[provider]?.key || (provider === 'deepseek' ? settings.key : undefined);
}

export type ThesisConsent = { consentAt?: number; consentProviders?: ThesisProvider[] };
export function hasThesisConsent(state: ThesisConsent | undefined, provider: ThesisProvider): boolean {
  if (!state?.consentAt) return false;
  // Older projects consented specifically to DeepSeek, never to another provider.
  return state.consentProviders ? state.consentProviders.includes(provider) : provider === 'deepseek';
}
export function updateThesisConsent<T extends ThesisConsent>(state: T, provider: ThesisProvider, allowed: boolean): T {
  const previous = state.consentProviders || (state.consentAt ? ['deepseek' as const] : []);
  const consentProviders = allowed ? [...new Set([...previous, provider])] : previous.filter(item => item !== provider);
  return { ...state, consentAt: consentProviders.length ? state.consentAt || Date.now() : undefined, consentProviders };
}
