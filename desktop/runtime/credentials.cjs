'use strict';
/* oxlint-disable typescript/no-require-imports -- Shared with the CommonJS desktop entry. */
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { AI_PROVIDERS, isAiProvider, isProviderModel, validateApiKey } = require('./ai-settings.cjs');
const { normalizeTrialGatewayUrl, normalizeInvitationCode, isTrialToken, redeemInvitation } = require('./trial-access.cjs');
function validateSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['apiKey', 'model', 'provider'].includes(key))) throw new Error('Invalid AI settings.');
  if (input.provider !== undefined && !isAiProvider(input.provider)) throw new Error('Choose a valid AI service.');
  const model = typeof input.model === 'string' ? input.model.trim() : input.model;
  if (typeof model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(model)) throw new Error('Enter a valid model name.');
  if (input.provider !== undefined && !isProviderModel(input.provider, model)) {
    const name = AI_PROVIDERS.find(provider => provider.id === input.provider).name;
    throw new Error(`Enter a valid ${name} model name.`);
  }
  return {
    model,
    ...(input.provider !== undefined ? { provider: input.provider } : {}),
    ...(input.apiKey !== undefined ? { apiKey: validateApiKey(input.apiKey) } : {}),
  };
}
function emptyRecord() {
  return { version: 2, provider: 'deepseek', usageMode: 'personal', providers: Object.fromEntries(AI_PROVIDERS.map(provider => [provider.id, { model: provider.model }])) };
}
function effectiveProvider(record) {
  if (record.provider !== 'glm') return record.provider;
  return ['deepseek', 'kimi', 'openai'].find(provider => record.providers[provider].encryptedKey) || 'deepseek';
}
function createCredentialStore(directory, safeStorage, { gatewayUrl = '', allowLocalTest = false, fetcher = fetch, timeoutMs = 10000 } = {}) {
  if (gatewayUrl) gatewayUrl = normalizeTrialGatewayUrl(gatewayUrl, { allowLocalTest });
  const filename = path.join(directory, 'ai-settings.json');
  let queue = Promise.resolve();
  async function read() {
    let content;
    try { content = await fs.readFile(filename, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return emptyRecord(); throw error; }
    const record = JSON.parse(content);
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Saved AI settings could not be read.');
    if (record.version === 1) {
      if (typeof record.model !== 'string' || (record.encryptedKey !== undefined && typeof record.encryptedKey !== 'string')) throw new Error('Saved AI settings could not be read.');
      validateSettings({ provider: 'deepseek', model: record.model });
      const migrated = emptyRecord();
      migrated.providers.deepseek = { model: record.model, ...(record.encryptedKey !== undefined ? { encryptedKey: record.encryptedKey } : {}) };
      return migrated;
    }
    if (record.version !== 2 || !isAiProvider(record.provider) || !record.providers || typeof record.providers !== 'object' || Array.isArray(record.providers) || Object.keys(record.providers).some(provider => !isAiProvider(provider))) throw new Error('Saved AI settings could not be read.');
    for (const { id } of AI_PROVIDERS) {
      const settings = record.providers[id];
      if (!settings || typeof settings !== 'object' || Array.isArray(settings) || typeof settings.model !== 'string' || (settings.encryptedKey !== undefined && typeof settings.encryptedKey !== 'string')) throw new Error('Saved AI settings could not be read.');
      validateSettings({ provider: id, model: settings.model });
    }
    if (record.usageMode === undefined) record.usageMode = 'personal';
    if (!['personal', 'trial'].includes(record.usageMode)) throw new Error('Saved AI settings could not be read.');
    if (record.trial !== undefined && (!record.trial || typeof record.trial !== 'object' || Array.isArray(record.trial)
      || Object.keys(record.trial).some(key => !['encryptedToken', 'pendingRedemption'].includes(key))
      || (record.trial.encryptedToken !== undefined && typeof record.trial.encryptedToken !== 'string')
      || (record.trial.pendingRedemption !== undefined && typeof record.trial.pendingRedemption !== 'string'))) throw new Error('Saved AI settings could not be read.');
    return record;
  }
  function publicSettings(record) {
    const providers = Object.fromEntries(AI_PROVIDERS.map(({ id }) => [id, { configured: !!record.providers[id].encryptedKey, model: record.providers[id].model }]));
    const provider = effectiveProvider(record);
    return { ...providers[provider], provider, providers, usageMode: record.usageMode,
      trial: { activated: !!record.trial?.encryptedToken, gatewayConfigured: !!gatewayUrl }, encryptionAvailable: safeStorage.isEncryptionAvailable() };
  }
  async function write(record) {
    await fs.mkdir(directory, { recursive: true });
    const temporary = `${filename}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(record), { mode: 0o600 });
    await fs.rename(temporary, filename);
  }
  function encrypt(value) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('System encryption is unavailable. The trial credential was not saved.');
    return safeStorage.encryptString(value).toString('base64');
  }
  function decrypt(value) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('System encryption is unavailable. Unlock your account and try again.');
    return safeStorage.decryptString(Buffer.from(value, 'base64'));
  }
  async function get() { await queue; return publicSettings(await read()); }
  async function config() {
    await queue;
    const record = await read();
    if ((AI_PROVIDERS.some(({ id }) => record.providers[id].encryptedKey) || record.trial?.encryptedToken) && !safeStorage.isEncryptionAvailable()) throw new Error('System encryption is unavailable. Unlock your account and try again.');
    const providers = Object.fromEntries(AI_PROVIDERS.map(({ id }) => {
      const { model, encryptedKey } = record.providers[id];
      return [id, { model, key: encryptedKey ? safeStorage.decryptString(Buffer.from(encryptedKey, 'base64')) : '' }];
    }));
    const token = record.trial?.encryptedToken ? decrypt(record.trial.encryptedToken) : '';
    if (token && !isTrialToken(token)) throw new Error('Saved trial credentials could not be read.');
    const provider = effectiveProvider(record);
    return { ...providers[provider], provider, providers, usageMode: record.usageMode, trial: { token, gatewayUrl } };
  }
  function save(value) {
    const input = validateSettings(value);
    const operation = queue.catch(() => {}).then(async () => {
      const record = await read();
      const provider = input.provider || record.provider;
      validateSettings({ ...input, provider });
      record.provider = provider;
      const settings = record.providers[provider];
      settings.model = input.model;
      if (input.apiKey !== undefined) {
        if (!input.apiKey) delete settings.encryptedKey;
        else {
          if (!safeStorage.isEncryptionAvailable()) throw new Error('System encryption is unavailable. The API key was not saved.');
          settings.encryptedKey = safeStorage.encryptString(input.apiKey).toString('base64');
        }
      }
      await write(record);
      return publicSettings(record);
    });
    queue = operation.then(() => {}, () => {});
    return operation;
  }
  function activateTrial(value) {
    const code = normalizeInvitationCode(value);
    const operation = queue.catch(() => {}).then(async () => {
      if (!gatewayUrl) throw new Error('The trial service is not configured in this build.');
      const record = await read();
      let pending;
      if (record.trial?.pendingRedemption) {
        try { pending = JSON.parse(decrypt(record.trial.pendingRedemption)); } catch { throw new Error('Saved trial credentials could not be read.'); }
        if (!pending || typeof pending !== 'object' || Array.isArray(pending) || Object.keys(pending).some(key => !['code', 'claimToken'].includes(key))
          || normalizeInvitationCode(pending.code) !== pending.code || !isTrialToken(pending.claimToken)) throw new Error('Saved trial credentials could not be read.');
      }
      if (!pending || pending.code !== code) {
        pending = { code, claimToken: randomBytes(32).toString('base64url') };
        record.trial = { ...record.trial, pendingRedemption: encrypt(JSON.stringify(pending)) };
        // Persist before redeeming. A lost response or interrupted process must
        // retry with the same claim token after the server has claimed the code.
        await write(record);
      }
      await redeemInvitation(gatewayUrl, code, pending.claimToken, { fetcher, allowLocalTest, timeoutMs });
      record.trial = { encryptedToken: encrypt(pending.claimToken) };
      record.usageMode = 'trial';
      await write(record);
      return publicSettings(record);
    });
    queue = operation.then(() => {}, () => {});
    return operation;
  }
  function setUsageMode(mode) {
    if (!['personal', 'trial'].includes(mode)) throw new Error('Choose a valid AI usage mode.');
    const operation = queue.catch(() => {}).then(async () => {
      const record = await read();
      if (mode === 'trial' && (!gatewayUrl || !record.trial?.encryptedToken)) throw new Error('Activate an invitation before using trial AI.');
      record.usageMode = mode;
      await write(record);
      return publicSettings(record);
    });
    queue = operation.then(() => {}, () => {});
    return operation;
  }
  function clearTrial() {
    const operation = queue.catch(() => {}).then(async () => {
      const record = await read();
      delete record.trial;
      record.usageMode = 'personal';
      await write(record);
      return publicSettings(record);
    });
    queue = operation.then(() => {}, () => {});
    return operation;
  }
  return { get, save, config, activateTrial, setUsageMode, clearTrial };
}
module.exports = { createCredentialStore, validateSettings };
