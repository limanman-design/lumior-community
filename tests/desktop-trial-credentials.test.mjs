import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createCredentialStore } = require('../desktop/runtime/credentials.cjs');
const { AI_PROVIDERS, applyBackendAiSettings, clearBackendAiSettings, emptyAiConfig } = require('../desktop/runtime/ai-settings.cjs');
const { normalizeTrialGatewayUrl, isolatedTrialTest, readTrialService, redeemInvitation } = require('../desktop/runtime/trial-access.cjs');
const code = 'LUMIOR-0123456789ABCDEF0123456789ABCDEF';
const gatewayUrl = 'https://api.lumior.work';
const token = 'a'.repeat(43);
const receipt = () => Response.json({ userId: 'user_fixture', activated: true, expiresAt: new Date(Date.now() + 86400000).toISOString() });
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from(`fixture-encrypted:${value.split('').reverse().join('')}`),
  decryptString: value => value.toString().slice('fixture-encrypted:'.length).split('').reverse().join(''),
};
async function withDirectory(run) {
  const directory = await mkdtemp(path.join(tmpdir(), 'lumior-trial-credentials-test-'));
  try { await run(directory, path.join(directory, 'ai-settings.json')); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

void test('old provider records stay in personal mode and an unconfigured build cannot redeem or select trial', async () => {
  await withDirectory(async (directory, filename) => {
    let requests = 0;
    const store = createCredentialStore(directory, safeStorage, { fetcher: () => { requests++; throw new Error('Unexpected request.'); } });
    await store.save({ provider: 'kimi', model: 'kimi-k2.6', apiKey: 'synthetic-kimi-key' });
    const previous = JSON.parse(await readFile(filename, 'utf8'));
    delete previous.usageMode;
    await writeFile(filename, JSON.stringify(previous));
    assert.equal((await store.get()).usageMode, 'personal');
    assert.deepEqual((await store.get()).trial, { activated: false, gatewayConfigured: false });
    assert.equal((await store.config()).providers.kimi.key, 'synthetic-kimi-key');
    await assert.rejects(store.activateTrial(code), /not configured/);
    await assert.rejects(store.setUsageMode('trial'), /Activate an invitation/);
    assert.equal(requests, 0);
    assert.equal(await readFile(filename, 'utf8'), JSON.stringify(previous));
    await store.setUsageMode('personal');
    assert.equal(JSON.parse(await readFile(filename, 'utf8')).usageMode, 'personal');
  });
});

void test('activation persists an encrypted pending claim before the request and retries the same claim after a lost response and restart', async () => {
  await withDirectory(async (directory, filename) => {
    let firstClaim;
    const first = createCredentialStore(directory, safeStorage, { gatewayUrl, fetcher: async (url, init) => {
      assert.equal(url, `${gatewayUrl}/v1/invitations/redeem`);
      assert.equal(init.redirect, 'error');
      assert.deepEqual(init.headers, { 'Content-Type': 'application/json' });
      firstClaim = JSON.parse(init.body);
      assert.equal(firstClaim.code, code);
      assert.match(firstClaim.claimToken, /^[A-Za-z0-9_-]{43}$/);
      const pending = JSON.parse(await readFile(filename, 'utf8')).trial.pendingRedemption;
      assert.deepEqual(JSON.parse(safeStorage.decryptString(Buffer.from(pending, 'base64'))), firstClaim);
      throw new Error(`Simulated server secret ${firstClaim.claimToken}`);
    } });
    await assert.rejects(first.activateTrial(`  ${code.toLowerCase()}  `), error => {
      assert.match(error.message, /could not be reached/);
      assert.equal(error.message.includes(firstClaim.claimToken), false);
      return true;
    });
    const failedPublic = await first.get();
    assert.equal(failedPublic.usageMode, 'personal');
    assert.equal(failedPublic.trial.activated, false);
    for (const secret of [code, firstClaim.claimToken, 'pendingRedemption']) assert.equal(JSON.stringify(failedPublic).includes(secret), false);
    const retried = createCredentialStore(directory, safeStorage, { gatewayUrl, fetcher: async (_url, init) => {
      assert.deepEqual(JSON.parse(init.body), firstClaim);
      return receipt();
    } });
    const active = await retried.activateTrial(code);
    assert.equal(active.usageMode, 'trial');
    assert.deepEqual(active.trial, { activated: true, gatewayConfigured: true });
    const disk = await readFile(filename, 'utf8');
    assert.equal(JSON.parse(disk).trial.pendingRedemption, undefined);
    assert.equal(disk.includes(code), false);
    assert.equal(disk.includes(firstClaim.claimToken), false);
    assert.equal((await stat(filename)).mode & 0o777, 0o600);
    assert.deepEqual((await retried.config()).trial, { gatewayUrl, token: firstClaim.claimToken });
    assert.equal(JSON.stringify(active).includes(firstClaim.claimToken), false);
  });
});

void test('personal mode and clearing trial preserve all four provider credentials and configured models', async () => {
  await withDirectory(async directory => {
    const store = createCredentialStore(directory, safeStorage, { gatewayUrl, fetcher: async () => receipt() });
    for (const provider of AI_PROVIDERS) await store.save({ provider: provider.id, model: provider.model, apiKey: `synthetic-${provider.id}-key` });
    await store.activateTrial(code);
    const activated = await store.config();
    await store.setUsageMode('personal');
    assert.equal((await store.get()).trial.activated, true);
    assert.equal((await store.config()).trial.token, activated.trial.token);
    await store.setUsageMode('trial');
    await store.clearTrial();
    const state = await store.get(), config = await store.config();
    assert.equal(state.usageMode, 'personal');
    assert.equal(state.provider, 'openai');
    assert.deepEqual(state.trial, { activated: false, gatewayConfigured: true });
    assert.deepEqual(config.providers, activated.providers);
    assert.deepEqual(config.trial, { gatewayUrl, token: '' });
    await assert.rejects(store.setUsageMode('trial'), /Activate an invitation/);
    assert.throws(() => store.setUsageMode('unknown'), /valid AI usage mode/);
  });
});

void test('clearing a failed pending redemption removes its secret while preserving personal keys', async () => {
  await withDirectory(async (directory, filename) => {
    const store = createCredentialStore(directory, safeStorage, { gatewayUrl, fetcher: async () => Response.json({ secret: 'upstream-response-must-not-escape' }, { status: 409 }) });
    await store.save({ model: 'deepseek-flash', apiKey: 'synthetic-deepseek-key' });
    await assert.rejects(store.activateTrial(code), error => !error.message.includes('upstream-response-must-not-escape') && /activation failed/.test(error.message));
    assert.equal(typeof JSON.parse(await readFile(filename, 'utf8')).trial.pendingRedemption, 'string');
    await store.clearTrial();
    assert.equal(JSON.parse(await readFile(filename, 'utf8')).trial, undefined);
    assert.equal((await store.config()).key, 'synthetic-deepseek-key');
  });
});

void test('invalid codes and unavailable system encryption never send a claim or create plaintext files', async () => {
  await withDirectory(async (directory, filename) => {
    let requests = 0;
    const store = createCredentialStore(directory, { isEncryptionAvailable: () => false }, { gatewayUrl, fetcher: () => { requests++; return receipt(); } });
    for (const value of ['', 'SHORT', `${code}\nmalformed`, { code }, 'x'.repeat(129)]) assert.throws(() => store.activateTrial(value), /valid invitation code/);
    await assert.rejects(store.activateTrial(code), /encryption is unavailable/);
    assert.equal(requests, 0);
    await assert.rejects(readFile(filename), { code: 'ENOENT' });
  });
});

void test('gateway configuration only permits the fixed HTTPS origin and isolated local testing', async () => {
  assert.equal(normalizeTrialGatewayUrl(`${gatewayUrl}/`), gatewayUrl);
  for (const value of ['https://foreign.example', 'http://api.lumior.work', 'https://api.lumior.work.evil.example', 'https://key@api.lumior.work', `${gatewayUrl}/proxy`, `${gatewayUrl}/?key=secret`, `${gatewayUrl}/#fragment`, 'http://127.0.0.1:8787', 'file:///tmp/server']) assert.throws(() => normalizeTrialGatewayUrl(value), /Invalid trial service/);
  assert.equal(normalizeTrialGatewayUrl('http://127.0.0.1:43371', { allowLocalTest: true }), 'http://127.0.0.1:43371');
  assert.throws(() => normalizeTrialGatewayUrl('http://localhost:43371', { allowLocalTest: true }), /Invalid trial service/);
  assert.throws(() => normalizeTrialGatewayUrl('http://127.0.0.1:43372', { allowLocalTest: true }), /Invalid trial service/);
  const environment = { LUMIOR_DESKTOP_TEST_MODE: '1', LUMIOR_DESKTOP_TEST_PORT: '43272', LUMIOR_DESKTOP_DATA_DIR: '/tmp/isolated-trial-test' };
  assert.equal(isolatedTrialTest(environment), true);
  assert.equal(isolatedTrialTest({ ...environment, LUMIOR_DESKTOP_DATA_DIR: '' }), false);
  assert.equal(isolatedTrialTest({ ...environment, LUMIOR_DESKTOP_TEST_PORT: '' }), false);
  await withDirectory(async directory => {
    assert.equal(await readTrialService(directory), '');
    const filename = path.join(directory, 'trial-service.json');
    await writeFile(filename, JSON.stringify({ gatewayUrl: 'http://127.0.0.1:8787' }));
    await assert.rejects(readTrialService(directory, { environment: {} }), /Invalid trial service/);
    assert.equal(await readTrialService(directory, { environment }), 'http://127.0.0.1:8787');
    await writeFile(filename, JSON.stringify({ gatewayUrl, apiKey: 'should-never-be-bundled' }));
    await assert.rejects(readTrialService(directory), /Invalid trial service/);
  });
});

void test('activation validates the receipt, ignores replacement tokens and bounds timeout and response size', async () => {
  for (const output of [{ activated: true }, { userId: 'user', expiresAt: 'invalid' }, { userId: 'user', expiresAt: '2000-01-01T00:00:00.000Z' }]) {
    await assert.rejects(redeemInvitation(gatewayUrl, code, token, { fetcher: async () => Response.json(output) }), /could not be confirmed/);
  }
  await assert.rejects(redeemInvitation(gatewayUrl, code, token, { fetcher: async () => new Response('x'.repeat(4097)) }), /could not be confirmed/);
  await assert.rejects(redeemInvitation(gatewayUrl, code, token, { timeoutMs: 5, fetcher: (_url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('timed out')))) }), /could not be reached/);
  await withDirectory(async directory => {
    let claimToken;
    const store = createCredentialStore(directory, safeStorage, { gatewayUrl, fetcher: async (_url, init) => {
      claimToken = JSON.parse(init.body).claimToken;
      return Response.json({ userId: 'user', expiresAt: new Date(Date.now() + 60000).toISOString(), token: 'attacker-replacement-token' });
    } });
    await store.activateTrial(code);
    assert.equal((await store.config()).trial.token, claimToken);
  });
});

void test('backend configuration removes inherited trial values and validates new fields before any environment mutation', () => {
  const environment = { PATH: '/bin', LUMIOR_AI_USAGE_MODE: 'trial', LUMIOR_TRIAL_GATEWAY_URL: 'https://foreign.example', LUMIOR_TRIAL_TOKEN: 'inherited-token' };
  clearBackendAiSettings(environment);
  assert.deepEqual(environment, { PATH: '/bin' });
  const config = { ...emptyAiConfig(), usageMode: 'trial', trial: { gatewayUrl, token } };
  applyBackendAiSettings(environment, config);
  assert.equal(environment.LUMIOR_AI_USAGE_MODE, 'trial');
  assert.equal(environment.LUMIOR_TRIAL_GATEWAY_URL, gatewayUrl);
  assert.equal(environment.LUMIOR_TRIAL_TOKEN, token);
  const before = { ...environment };
  for (const trial of [{ gatewayUrl: 'https://foreign.example', token }, { gatewayUrl, token: 'short' }, { gatewayUrl, token, extra: 'bad' }]) {
    assert.throws(() => applyBackendAiSettings(environment, { ...config, trial }));
    assert.deepEqual(environment, before);
  }
  assert.throws(() => applyBackendAiSettings(environment, { ...config, usageMode: 'other' }), /valid AI usage mode/);
  assert.deepEqual(environment, before);
  applyBackendAiSettings(environment, emptyAiConfig());
  assert.equal(environment.LUMIOR_AI_USAGE_MODE, 'personal');
  assert.equal(environment.LUMIOR_TRIAL_GATEWAY_URL, undefined);
  assert.equal(environment.LUMIOR_TRIAL_TOKEN, undefined);
  const local = { LUMIOR_DESKTOP_TEST_MODE: '1', LUMIOR_DESKTOP_TEST_PORT: '43272', LUMIOR_DESKTOP_DATA_DIR: '/tmp/isolated-trial-test' };
  applyBackendAiSettings(local, { ...config, trial: { token, gatewayUrl: 'http://127.0.0.1:8787' } });
  assert.equal(local.LUMIOR_TRIAL_GATEWAY_URL, 'http://127.0.0.1:8787');
});
