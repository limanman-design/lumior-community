import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { authorizeRequest, cleanBackendEnvironment, DESKTOP_ORIGIN, isAppUrl, externalUrl, desktopConfiguration, createSecurity } = require('../desktop/runtime/security.cjs');
const { createCredentialStore } = require('../desktop/runtime/credentials.cjs');

void test('installed applications ignore development mode and preview has a separate guarded origin', () => {
  const env = { LUMIOR_DESKTOP_DEV: '1', LUMIOR_DESKTOP_TEST_MODE: '1', LUMIOR_DESKTOP_TEST_PORT: '43272' };
  assert.deepEqual(desktopConfiguration(true, env), { development: false, port: 43171 });
  assert.deepEqual(desktopConfiguration(false, env), { development: true, port: 43172 });
  assert.deepEqual(desktopConfiguration(false, { ...env, LUMIOR_DESKTOP_DATA_DIR: '/tmp/preview-test' }), { development: true, port: 43272 });
  const preview = createSecurity(43172), token = 'a'.repeat(64);
  assert.equal(preview.isAppUrl('http://127.0.0.1:43171'), false);
  assert.equal(preview.authorizeRequest({ host: '127.0.0.1:43172', origin: 'http://127.0.0.1:43172', 'x-lumior-desktop': token }, token), true);
  assert.equal(preview.authorizeRequest({ host: '127.0.0.1:43172', origin: DESKTOP_ORIGIN, 'x-lumior-desktop': token }, token), false);
  assert.equal(cleanBackendEnvironment(env, token, '/web').LUMIOR_DESKTOP_DEV, '0');
  assert.equal(cleanBackendEnvironment(env, token, '/web', true).NODE_ENV, 'development');
});

void test('reserved automation port requires both test mode and an isolated profile', () => {
  const script = `process.stdout.write(String(require(${JSON.stringify(require.resolve('../desktop/runtime/security.cjs'))}).DESKTOP_PORT))`;
  const port = overrides => execFileSync(process.execPath, ['-e', script], { env: { ...process.env, LUMIOR_DESKTOP_TEST_MODE: '', LUMIOR_DESKTOP_TEST_PORT: '', LUMIOR_DESKTOP_DATA_DIR: '', ...overrides } }).toString();
  assert.equal(port({ LUMIOR_DESKTOP_TEST_PORT: '43271' }), '43171');
  assert.equal(port({ LUMIOR_DESKTOP_TEST_MODE: '1', LUMIOR_DESKTOP_TEST_PORT: '43271' }), '43171');
  assert.equal(port({ LUMIOR_DESKTOP_TEST_MODE: '1', LUMIOR_DESKTOP_TEST_PORT: '43271', LUMIOR_DESKTOP_DATA_DIR: '/tmp/lumior-isolated-test' }), '43271');
  assert.equal(port({ LUMIOR_DESKTOP_TEST_MODE: '1', LUMIOR_DESKTOP_TEST_PORT: '12345', LUMIOR_DESKTOP_DATA_DIR: '/tmp/lumior-isolated-test' }), '43171');
});

void test('desktop service requires its exact host, origin and per-launch authentication', () => {
  const token = 'a'.repeat(64), headers = { host: '127.0.0.1:43171', origin: DESKTOP_ORIGIN, 'x-lumior-desktop': token };
  assert.equal(authorizeRequest(headers, token), true);
  assert.equal(authorizeRequest({ ...headers, origin: 'https://example.com' }, token), false);
  assert.equal(authorizeRequest({ ...headers, host: 'localhost:43171' }, token), false);
  assert.equal(authorizeRequest({ ...headers, 'x-lumior-desktop': 'b'.repeat(64) }, token), false);
  assert.equal(authorizeRequest({ host: headers.host }, token), false);
});
void test('desktop service does not inherit developer API credentials or Node injection options', () => {
  const env = cleanBackendEnvironment({ PATH: '/bin', DEEPSEEK_API_KEY: 'fixture', ANOTHER_SECRET: 'fixture', NODE_OPTIONS: '--import bad.mjs', ELECTRON_RUN_AS_NODE: '1' }, 'a'.repeat(64), '/runtime/web');
  assert.equal(env.PATH, '/bin');
  assert.equal(env.DEEPSEEK_API_KEY, undefined);
  assert.equal(env.ANOTHER_SECRET, undefined);
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(env.LUMIOR_DESKTOP, '1');
});
void test('external links permit web URLs and reject OS handlers, credentials and app lookalikes', () => {
  assert.equal(externalUrl('https://example.com/paper'), 'https://example.com/paper');
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'ms-settings:privacy', 'https://user:password@example.com']) assert.equal(externalUrl(url), null);
  assert.equal(isAppUrl(`${DESKTOP_ORIGIN}/?board=1`), true);
  assert.equal(isAppUrl(`${DESKTOP_ORIGIN}.example.com/`), false);
});
void test('credential save preserves the old key, encrypts disk content and never returns a key to the renderer', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'lumior-credentials-test-'));
  const safe = { isEncryptionAvailable: () => true, encryptString: text => Buffer.from(text.split('').reverse().join('')), decryptString: bytes => bytes.toString().split('').reverse().join('') };
  try {
    const store = createCredentialStore(directory, safe);
    const initial = await store.get();
    assert.equal(initial.provider, 'deepseek');
    assert.equal(initial.configured, false);
    assert.equal(initial.model, 'deepseek-flash');
    assert.equal(initial.encryptionAvailable, true);
    assert.equal(initial.usageMode, 'personal');
    assert.deepEqual(initial.trial, { activated: false, gatewayConfigured: false });
    assert.deepEqual(Object.keys(initial.providers), ['deepseek', 'glm', 'kimi', 'openai']);
    const state = await store.save({ apiKey: 'synthetic-test-key', model: 'deepseek-flash' });
    assert.equal(state.configured, true);
    assert.deepEqual(state.providers.deepseek, { configured: true, model: 'deepseek-flash' });
    assert.equal(JSON.stringify(state).includes('synthetic-test-key'), false);
    assert.equal((await readFile(path.join(directory, 'ai-settings.json'), 'utf8')).includes('synthetic-test-key'), false);
    await store.save({ model: 'deepseek-reasoner' });
    const config = await store.config();
    assert.equal(config.key, 'synthetic-test-key');
    assert.equal(config.model, 'deepseek-reasoner');
    assert.deepEqual(config.providers.deepseek, { key: 'synthetic-test-key', model: 'deepseek-reasoner' });
    assert.throws(() => store.save({ apiKey: 'bad\nkey', model: 'deepseek-flash' }), /valid API key/);
    await store.save({ apiKey: '', model: 'deepseek-flash' });
    assert.equal((await store.get()).configured, false);
    assert.equal((await store.config()).key, '');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
void test('unavailable OS encryption refuses writing a plaintext fallback', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'lumior-credentials-test-'));
  try {
    const store = createCredentialStore(directory, { isEncryptionAvailable: () => false });
    await assert.rejects(store.save({ apiKey: 'synthetic-test-key', model: 'deepseek-flash' }), /encryption is unavailable/);
    assert.equal((await store.get()).configured, false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
