'use strict';
/* oxlint-disable typescript/no-require-imports -- Shared with the CommonJS desktop entry. */
const { normalizeTrialGatewayUrl, isolatedTrialTest, isTrialToken } = require('./trial-access.cjs');

const AI_PROVIDERS = Object.freeze([
  Object.freeze({ id: 'deepseek', name: 'DeepSeek', model: 'deepseek-flash', prefix: 'DEEPSEEK' }),
  Object.freeze({ id: 'glm', name: 'GLM', model: 'glm-4.7', prefix: 'GLM' }),
  Object.freeze({ id: 'kimi', name: 'Kimi', model: 'kimi-k2.6', prefix: 'KIMI' }),
  Object.freeze({ id: 'openai', name: 'OpenAI', model: 'gpt-4.1-mini', prefix: 'OPENAI' }),
]);

function isAiProvider(value) {
  return typeof value === 'string' && AI_PROVIDERS.some(provider => provider.id === value);
}
function isProviderModel(provider, model) {
  if (typeof model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(model)) return false;
  if (provider === 'deepseek') return /^deepseek-.+/.test(model);
  if (provider === 'glm') return /^glm-.+/.test(model);
  if (provider === 'kimi') return /^(kimi-|moonshot-).+/.test(model);
  return provider === 'openai' && /^(gpt-.+|o[1-9](?:[.-].+|$))/.test(model);
}
function validateApiKey(value) {
  if (typeof value !== 'string' || value.length > 4096 || ['\r', '\n', '\0'].some(character => value.includes(character))) throw new Error('Enter a valid API key.');
  return value.trim();
}
function emptyAiConfig() {
  const providers = Object.fromEntries(AI_PROVIDERS.map(provider => [provider.id, { key: '', model: provider.model }]));
  return { provider: 'deepseek', ...providers.deepseek, providers, usageMode: 'personal', trial: { token: '', gatewayUrl: '' } };
}
function clearBackendAiSettings(environment) {
  delete environment.LUMIOR_AI_PROVIDER;
  delete environment.LUMIOR_AI_USAGE_MODE;
  delete environment.LUMIOR_TRIAL_GATEWAY_URL;
  delete environment.LUMIOR_TRIAL_TOKEN;
  for (const { prefix } of AI_PROVIDERS) {
    delete environment[`${prefix}_API_KEY`];
    delete environment[`${prefix}_MODEL`];
  }
  // The web adapter supports this alias outside the desktop. Never inherit it.
  delete environment.MOONSHOT_API_KEY;
  delete environment.MOONSHOT_MODEL;
}
function applyBackendAiSettings(environment, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid AI settings.');
  const provider = value.provider === undefined ? 'deepseek' : value.provider;
  if (!isAiProvider(provider)) throw new Error('Choose a valid AI service.');
  const usageMode = value.usageMode === undefined ? 'personal' : value.usageMode;
  if (!['personal', 'trial'].includes(usageMode)) throw new Error('Choose a valid AI usage mode.');
  const trial = value.trial === undefined ? {} : value.trial;
  if (!trial || typeof trial !== 'object' || Array.isArray(trial) || Object.keys(trial).some(key => !['token', 'gatewayUrl'].includes(key))) throw new Error('Invalid trial credentials.');
  const trialToken = trial.token === undefined ? '' : trial.token;
  if (trialToken !== '' && !isTrialToken(trialToken)) throw new Error('Invalid trial credentials.');
  const trialGateway = trial.gatewayUrl === undefined || trial.gatewayUrl === '' ? '' : normalizeTrialGatewayUrl(trial.gatewayUrl, { allowLocalTest: isolatedTrialTest(environment) });
  const settings = Object.fromEntries(AI_PROVIDERS.map(item => {
    const input = value.providers?.[item.id] || (provider === item.id ? value : {});
    const model = input.model === undefined ? item.model : typeof input.model === 'string' ? input.model.trim() : input.model;
    if (!isProviderModel(item.id, model)) throw new Error(`Enter a valid ${item.name} model name.`);
    const key = input.key === undefined ? '' : validateApiKey(input.key);
    return [item.id, { key, model }];
  }));
  // Validate the complete message before changing the environment, and only
  // write known variable names. Message fields cannot become environment names.
  clearBackendAiSettings(environment);
  environment.LUMIOR_AI_PROVIDER = provider;
  environment.LUMIOR_AI_USAGE_MODE = usageMode;
  if (trialGateway) environment.LUMIOR_TRIAL_GATEWAY_URL = trialGateway;
  if (trialToken) environment.LUMIOR_TRIAL_TOKEN = trialToken;
  for (const { id, prefix } of AI_PROVIDERS) {
    environment[`${prefix}_API_KEY`] = settings[id].key;
    environment[`${prefix}_MODEL`] = settings[id].model;
  }
}

module.exports = { AI_PROVIDERS, isAiProvider, isProviderModel, validateApiKey, emptyAiConfig, clearBackendAiSettings, applyBackendAiSettings };
