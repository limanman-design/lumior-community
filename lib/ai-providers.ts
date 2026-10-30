export type AiProvider = 'deepseek' | 'glm' | 'kimi' | 'openai';

export const aiProviders = [
  { id: 'deepseek', name: 'DeepSeek', defaultModel: 'deepseek-flash', baseUrl: 'https://api.deepseek.com' },
  { id: 'glm', name: 'GLM', defaultModel: 'glm-4.7', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  { id: 'kimi', name: 'Kimi', defaultModel: 'kimi-k2.6', baseUrl: 'https://api.moonshot.cn/v1' },
  { id: 'openai', name: 'OpenAI', defaultModel: 'gpt-4.1-mini', baseUrl: 'https://api.openai.com/v1' },
] as const;

export function isAiProvider(value: unknown): value is AiProvider {
  return typeof value === 'string' && aiProviders.some(provider => provider.id === value);
}

export function isProviderModel(provider: AiProvider, model: unknown): model is string {
  if (typeof model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(model)) return false;
  if (provider === 'deepseek') return /^deepseek-[a-zA-Z0-9._-]+$/.test(model);
  if (provider === 'glm') return /^glm-[a-zA-Z0-9._-]+$/.test(model);
  if (provider === 'kimi') return /^(kimi-|moonshot-)[a-zA-Z0-9._-]+$/.test(model);
  return /^(gpt-[a-zA-Z0-9._-]+|o[1-9](?:[.-][a-zA-Z0-9._-]+)?)$/.test(model);
}

/** Keep older DeepSeek chat selections compatible with existing backups. */
export function qualifiedModelId(provider: AiProvider, model: string): string {
  return provider === 'deepseek' ? model : `${provider}:${model}`;
}

export function parseModelSelection(value: string, defaultProvider: AiProvider): { provider: AiProvider; model: string } | null {
  const split = value.indexOf(':');
  if (split !== -1) {
    const provider = value.slice(0, split), model = value.slice(split + 1);
    return isAiProvider(provider) && isProviderModel(provider, model) ? { provider, model } : null;
  }
  const provider = value.startsWith('deepseek-') ? 'deepseek' : defaultProvider;
  return isProviderModel(provider, value) ? { provider, model: value } : null;
}

export function supportsReasoningEffort(provider: AiProvider, model: string): boolean {
  return provider === 'deepseek' || (provider === 'glm' && /^glm-5\.(?:[2-9]|\d{2,})(?:[.-]|$)/.test(model)) || (provider === 'kimi' && /^kimi-k3(?:[._-]|$)/.test(model));
}

export function maxModelOutputTokens(provider: AiProvider, model: string): number {
  if (provider === 'openai') {
    if (model === 'gpt-4o-2024-05-13') return 4096;
    if (/^gpt-4o(?:-|$)/.test(model) || model.endsWith('-chat-latest')) return 16384;
  }
  if (provider === 'glm' && !/^glm-(?:[5-9]|4\.[5-9])/.test(model)) return 4096;
  if (provider === 'kimi' && !/^kimi-k[23]/.test(model)) return 4096;
  return 32768;
}

export function isResearchModel(provider: AiProvider, model: string): boolean {
  if (!isProviderModel(provider, model)) return false;
  if (provider === 'kimi' && /^moonshot-v1-(?:8k|32k)(?:-|$)/.test(model)) return false;
  if (provider !== 'openai') return !/(?:audio|vision|embedding|tts|ocr|^glm-\d+(?:\.\d+)?v(?:-|$))/.test(model);
  return /^(?:gpt-4\.1|gpt-4o(?:-|$)|gpt-[56](?:[.-]|$)|o[134](?:[.-]|$))/.test(model)
    && !/(?:audio|realtime|transcribe|tts|image|search|instruct|codex|^o1-(?:mini|preview)(?:-|$))/.test(model);
}

export type AiProviderConfig = { key?: string; model: string };
export type AiSettings = AiProviderConfig & {
  usageMode?: 'personal' | 'trial';
  trial?: { token?: string; gatewayUrl?: string; allowLocalTest?: boolean };
  provider?: AiProvider;
  providers?: Partial<Record<AiProvider, AiProviderConfig>>;
  missingKeyMessage?: string;
};

export function aiSettingsFromEnv(values: Record<string, string | undefined>): AiSettings {
  const names = { deepseek: 'DEEPSEEK', glm: 'GLM', kimi: 'KIMI', openai: 'OPENAI' } as const;
  const providers = Object.fromEntries(aiProviders.map(item => [item.id, {
    key: (values[`${names[item.id]}_API_KEY`] || (item.id === 'kimi' ? values.MOONSHOT_API_KEY : undefined))?.trim(),
    model: values[`${names[item.id]}_MODEL`]?.trim() || item.defaultModel,
  }])) as Record<AiProvider, AiProviderConfig>;
  const provider = isAiProvider(values.LUMIOR_AI_PROVIDER) ? values.LUMIOR_AI_PROVIDER : 'deepseek';
  const allowLocalTest = values.LUMIOR_DESKTOP_TEST_MODE === '1' && ['43271', '43272'].includes(values.LUMIOR_DESKTOP_TEST_PORT || '') && !!values.LUMIOR_DESKTOP_DATA_DIR?.trim();
  return { provider, providers, ...providers[provider], usageMode: values.LUMIOR_AI_USAGE_MODE === 'trial' ? 'trial' : 'personal',
    trial: { token: values.LUMIOR_TRIAL_TOKEN, gatewayUrl: values.LUMIOR_TRIAL_GATEWAY_URL, allowLocalTest }, missingKeyMessage: values.LUMIOR_DESKTOP === '1'
    ? '请在设置的 AI 服务中为所选服务配置 API Key。' : undefined };
}

export function providerConfig(settings: AiSettings, provider: AiProvider): AiProviderConfig {
  if (settings.providers?.[provider]) return settings.providers[provider];
  if ((settings.provider || 'deepseek') === provider) return { key: settings.key, model: settings.model };
  return { model: aiProviders.find(item => item.id === provider)!.defaultModel };
}
