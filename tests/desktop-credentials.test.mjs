import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createCredentialStore, validateSettings } = require('../desktop/runtime/credentials.cjs');
const { AI_PROVIDERS, emptyAiConfig, clearBackendAiSettings, applyBackendAiSettings } = require('../desktop/runtime/ai-settings.cjs');
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from(`encrypted:${value.split('').reverse().join('')}`),
  decryptString: value => value.toString().slice('encrypted:'.length).split('').reverse().join(''),
};

async function withStore(run, encryption = safeStorage) {
  const directory = await mkdtemp(path.join(tmpdir(), 'lumior-multi-ai-test-'));
  try { await run(createCredentialStore(directory, encryption), path.join(directory, 'ai-settings.json')); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

void test('legacy encrypted DeepSeek credentials migrate on write without losing the model or ciphertext', async () => {
  await withStore(async (store, filename) => {
    const legacy = { version: 1, model: 'deepseek-reasoner', encryptedKey: safeStorage.encryptString('synthetic-legacy-key').toString('base64') };
    await writeFile(filename, JSON.stringify(legacy));
    const state = await store.get();
    assert.equal(state.provider, 'deepseek');
    assert.deepEqual(state.providers.deepseek, { configured: true, model: 'deepseek-reasoner' });
    assert.equal(JSON.parse(await readFile(filename, 'utf8')).version, 1);
    assert.equal((await store.config()).key, 'synthetic-legacy-key');
    await store.save({ provider: 'glm', model: 'glm-4.7', apiKey: 'synthetic-glm-key' });
    const record = JSON.parse(await readFile(filename, 'utf8'));
    assert.equal(record.version, 2);
    assert.equal(record.provider, 'glm');
    assert.deepEqual(record.providers.deepseek, { model: legacy.model, encryptedKey: legacy.encryptedKey });
    const config = await store.config();
    assert.equal(config.provider, 'deepseek');
    assert.equal(config.key, 'synthetic-legacy-key');
    assert.equal(config.providers.glm.key, 'synthetic-glm-key');
    assert.equal(config.providers.deepseek.key, 'synthetic-legacy-key');
    assert.deepEqual(config.providers.kimi, { key: '', model: 'kimi-k2.6' });
    assert.deepEqual(config.providers.openai, { key: '', model: 'gpt-4.1-mini' });
  });
});

void test('concurrent provider saves and removal preserve every other provider and select the latest provider', async () => {
  await withStore(async (store, filename) => {
    const saves = AI_PROVIDERS.map(({ id, model }) => store.save({ provider: id, model, apiKey: `synthetic-${id}-key` }));
    await Promise.all(saves);
    assert.equal((await store.get()).provider, 'openai');
    const readWhileWriting = store.save({ provider: 'glm', model: 'glm-4.6', apiKey: '' });
    const changeSelectedModel = store.save({ model: 'glm-4.7' });
    const state = await store.get();
    await Promise.all([readWhileWriting, changeSelectedModel]);
    assert.equal(state.provider, 'deepseek');
    assert.equal(state.configured, true);
    assert.equal(state.model, 'deepseek-flash');
    const stored = JSON.parse(await readFile(filename, 'utf8'));
    assert.equal(stored.provider, 'glm');
    assert.equal(stored.providers.glm.model, 'glm-4.7');
    const config = await store.config();
    assert.equal(config.providers.glm.key, '');
    for (const id of ['deepseek', 'kimi', 'openai']) {
      assert.equal(config.providers[id].key, `synthetic-${id}-key`);
      assert.equal(state.providers[id].configured, true);
    }
    await store.save({ provider: 'kimi', model: 'moonshot-v1-32k' });
    await store.save({ apiKey: '', model: 'kimi-k2.6' });
    const final = await store.config();
    assert.equal(final.providers.kimi.key, '');
    assert.equal(final.providers.deepseek.key, 'synthetic-deepseek-key');
    assert.equal(final.providers.openai.key, 'synthetic-openai-key');
    const publicState = await store.get();
    assert.equal(JSON.stringify(publicState).includes('synthetic-'), false);
    assert.equal(JSON.stringify(publicState).includes('encryptedKey'), false);
    const disk = await readFile(filename, 'utf8');
    assert.equal(disk.includes('synthetic-'), false);
    assert.equal(JSON.parse(disk).providers.kimi.encryptedKey, undefined);
  });
});

void test('hidden GLM defaults fall back consistently without changing stored credentials', async () => {
  for (const [configured, expected] of [
    [['deepseek', 'kimi', 'openai'], 'deepseek'],
    [['kimi', 'openai'], 'kimi'],
    [['openai'], 'openai'],
    [[], 'deepseek'],
  ]) {
    await withStore(async (store, filename) => {
      for (const id of configured) {
        const { model } = AI_PROVIDERS.find(provider => provider.id === id);
        await store.save({ provider: id, model, apiKey: `synthetic-${id}-key` });
      }
      await store.save({ provider: 'glm', model: 'glm-4.7', apiKey: 'synthetic-preserved-glm-key' });
      const before = await readFile(filename, 'utf8');
      const state = await store.get();
      const config = await store.config();
      assert.equal(state.provider, expected);
      assert.equal(config.provider, expected);
      assert.equal(state.model, config.model);
      assert.equal(state.configured, !!config.key);
      assert.equal(config.providers.glm.key, 'synthetic-preserved-glm-key');
      assert.deepEqual(state.providers.glm, { configured: true, model: 'glm-4.7' });
      assert.equal(await readFile(filename, 'utf8'), before);

      await store.setUsageMode('personal');
      assert.equal(await readFile(filename, 'utf8'), before);
      const encryptedGlm = JSON.parse(before).providers.glm;
      await store.save({ model: 'glm-4.6' });
      const preserved = JSON.parse(await readFile(filename, 'utf8'));
      assert.equal(preserved.provider, 'glm');
      assert.equal(preserved.providers.glm.encryptedKey, encryptedGlm.encryptedKey);
      assert.equal(preserved.providers.glm.model, 'glm-4.6');
      assert.equal((await store.get()).provider, expected);
      assert.equal((await store.config()).provider, expected);

      const { model } = AI_PROVIDERS.find(provider => provider.id === expected);
      await store.save({ provider: expected, model });
      const explicitlySelected = JSON.parse(await readFile(filename, 'utf8'));
      assert.equal(explicitlySelected.provider, expected);
      assert.deepEqual(explicitlySelected.providers.glm, preserved.providers.glm);
    });
  }
});

void test('model and key validation rejects injection, wrong provider models and invalid writes without corrupting the queue', async () => {
  await withStore(async store => {
    await store.save({ provider: 'kimi', model: 'kimi-k2.6', apiKey: 'synthetic-kimi-key' });
    for (const provider of ['other', '__proto__', 'OPENAI', null]) assert.throws(() => store.save({ provider, model: 'gpt-4.1-mini' }), /valid AI service/);
    for (const model of ['kimi-k2.6\nevil', 'kimi\u2010k2.6', 'kimi-k2.6;evil', 'kimi-'.padEnd(129, 'x'), 'kimi-k2.6/evil']) assert.throws(() => store.save({ provider: 'kimi', model }), /valid.*model/);
    assert.throws(() => store.save({ provider: 'kimi', model: 'gpt-4.1-mini' }), /valid Kimi model/);
    for (const [provider, model] of [['deepseek', 'deepseek-'], ['glm', 'glm-'], ['kimi', 'kimi-'], ['kimi', 'moonshot-'], ['openai', 'gpt-'], ['openai', 'o3-']]) assert.throws(() => store.save({ provider, model }), /valid.*model/);
    assert.throws(() => store.save({ provider: 'openai', model: 'o3-mini', baseUrl: 'https://foreign.example' }), /Invalid AI settings/);
    assert.throws(() => store.save({ provider: 'kimi', model: 'kimi-k2.6', apiKey: 'bad\nkey' }), /valid API key/);
    await assert.rejects(store.save({ model: 'deepseek-flash' }), /valid Kimi model/);
    await store.save({ model: 'moonshot-v1-8k' });
    assert.equal((await store.config()).key, 'synthetic-kimi-key');
    assert.equal((await store.get()).model, 'moonshot-v1-8k');
    for (const model of ['gpt-4.1-mini', 'o3-mini', 'o4-mini', 'o1']) assert.equal(validateSettings({ provider: 'openai', model }).model, model);
  });
});

void test('unavailable encryption cannot erase another provider or write a plaintext fallback', async () => {
  let available = true;
  await withStore(async (store, filename) => {
    await store.save({ provider: 'deepseek', model: 'deepseek-flash', apiKey: 'synthetic-deepseek-key' });
    const before = await readFile(filename, 'utf8');
    available = false;
    await assert.rejects(store.save({ provider: 'openai', model: 'gpt-4.1-mini', apiKey: 'synthetic-openai-key' }), /encryption is unavailable/);
    assert.equal(await readFile(filename, 'utf8'), before);
    await assert.rejects(store.config(), /encryption is unavailable/);
    const state = await store.save({ provider: 'kimi', model: 'kimi-k2.6', apiKey: '' });
    assert.equal(state.encryptionAvailable, false);
    assert.equal(state.providers.deepseek.configured, true);
    available = true;
    assert.equal((await store.config()).providers.deepseek.key, 'synthetic-deepseek-key');
  }, { ...safeStorage, isEncryptionAvailable: () => available });
});

void test('desktop backend settings clear inherited aliases and write only fixed provider environment names', () => {
  const environment = { PATH: '/bin', LUMIOR_AI_PROVIDER: 'openai', MOONSHOT_API_KEY: 'inherited-alias', MOONSHOT_MODEL: 'inherited-model' };
  for (const { prefix } of AI_PROVIDERS) {
    environment[`${prefix}_API_KEY`] = 'inherited-secret';
    environment[`${prefix}_MODEL`] = 'inherited-model';
  }
  clearBackendAiSettings(environment);
  assert.deepEqual(environment, { PATH: '/bin' });
  const config = emptyAiConfig();
  config.provider = 'kimi';
  config.providers.kimi.key = 'synthetic-kimi-key';
  config.providers.deepseek.key = 'synthetic-deepseek-key';
  applyBackendAiSettings(environment, { ...config, NODE_OPTIONS: '--import evil.mjs', providers: { ...config.providers, NODE_OPTIONS: { key: 'bad' } } });
  assert.equal(environment.LUMIOR_AI_PROVIDER, 'kimi');
  assert.equal(environment.KIMI_API_KEY, 'synthetic-kimi-key');
  assert.equal(environment.DEEPSEEK_API_KEY, 'synthetic-deepseek-key');
  assert.equal(environment.GLM_API_KEY, '');
  assert.equal(environment.OPENAI_MODEL, 'gpt-4.1-mini');
  assert.equal(environment.MOONSHOT_API_KEY, undefined);
  assert.equal(environment.NODE_OPTIONS, undefined);
  const before = { ...environment };
  assert.throws(() => applyBackendAiSettings(environment, { ...config, providers: { ...config.providers, openai: { key: 'bad\nkey', model: 'gpt-4.1-mini' } } }), /valid API key/);
  assert.deepEqual(environment, before);
  applyBackendAiSettings(environment, emptyAiConfig());
  for (const { prefix } of AI_PROVIDERS) assert.equal(environment[`${prefix}_API_KEY`], '');
  assert.equal(environment.LUMIOR_AI_PROVIDER, 'deepseek');
});
