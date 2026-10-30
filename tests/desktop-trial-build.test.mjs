import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveTrialServiceBuild, verifyReleaseTrialService, writeTrialServiceBuild } from '../desktop/scripts/trial-service-build.mjs';
import { verifyReleaseResources } from '../desktop/scripts/release.mjs';

const gatewayUrl = 'https://api.lumior.work';

async function fixture(t, settings = { gatewayUrl }) {
  const directory = await mkdtemp(path.join(tmpdir(), 'lumior-trial-build-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'trial-service.json');
  await writeFile(filename, JSON.stringify(settings));
  return { directory, filename };
}

void test('normal desktop builds use the reviewed public trial origin without an environment setting', async t => {
  assert.equal(await resolveTrialServiceBuild(fileURLToPath(new URL('../desktop/runtime', import.meta.url)), { environment: {} }), gatewayUrl);
  const runtime = await fixture(t);
  const generated = await fixture(t);
  await rm(generated.filename);
  const environment = { LUMIOR_TRIAL_TOKEN: 'synthetic-token', OPENAI_API_KEY: 'synthetic-key', LUMIOR_INVITATION_CODE: 'synthetic-code' };
  await writeTrialServiceBuild(generated.directory, await resolveTrialServiceBuild(runtime.directory, { environment }));
  const serialized = await readFile(generated.filename, 'utf8');
  assert.deepEqual(JSON.parse(serialized), { gatewayUrl });
  assert.equal(serialized.includes('synthetic'), false);
  assert.equal(await verifyReleaseTrialService(generated.directory), gatewayUrl);
});

void test('an explicit production origin is normalized while empty or unsafe overrides fail', async t => {
  const { directory } = await fixture(t);
  assert.equal(await resolveTrialServiceBuild(directory, { environment: { LUMIOR_TRIAL_GATEWAY_URL: `${gatewayUrl}/` } }), gatewayUrl);
  for (const value of ['', 'https://foreign.example', 'http://127.0.0.1:8787', `${gatewayUrl}/?token=synthetic`, 'https://key@api.lumior.work']) {
    await assert.rejects(resolveTrialServiceBuild(directory, { environment: { LUMIOR_TRIAL_GATEWAY_URL: value } }), /Invalid trial service/);
  }
});

void test('a missing or malformed reviewed default cannot silently produce a build without trial access', async t => {
  const { directory, filename } = await fixture(t);
  await rm(filename);
  await assert.rejects(resolveTrialServiceBuild(directory, { environment: {} }), /Desktop trial service is missing/);
  assert.equal(await resolveTrialServiceBuild(directory, { environment: { LUMIOR_TRIAL_GATEWAY_URL: gatewayUrl } }), gatewayUrl);
  for (const source of ['{', 'null', '[]', JSON.stringify({ gatewayUrl, apiKey: 'synthetic-secret' }), JSON.stringify({ gatewayUrl: 'http://127.0.0.1:8787' })]) {
    await writeFile(filename, source);
    await assert.rejects(resolveTrialServiceBuild(directory, { environment: {} }), /Invalid trial service/);
  }
});

void test('release resource preflight requires the actual production trial configuration even with a valid report', async t => {
  const { directory, filename } = await fixture(t);
  await writeFile(path.join(directory, 'verification.json'), JSON.stringify({ privateConfigurationCopied: false, includesUserBrowserData: false }));
  await verifyReleaseResources(directory);
  await rm(filename);
  await assert.rejects(verifyReleaseResources(directory), /Release trial service is missing/);
  for (const settings of [{}, { gatewayUrl: '' }, { gatewayUrl: 'http://127.0.0.1:8787' }, { gatewayUrl, invitationCode: 'synthetic-code' }]) {
    await writeFile(filename, JSON.stringify(settings));
    await assert.rejects(verifyReleaseResources(directory), /Invalid trial service/);
  }
});

void test('release resources reject missing or linked directories and invalid privacy reports', async t => {
  const { directory } = await fixture(t);
  await assert.rejects(verifyReleaseResources(path.join(directory, 'missing')), /Prepare production resources/);
  const linked = path.join(directory, 'linked-resources');
  await symlink(directory, linked);
  await assert.rejects(verifyReleaseResources(linked), /Prepare production resources/);
  for (const report of [{}, { privateConfigurationCopied: true, includesUserBrowserData: false }, { privateConfigurationCopied: false, includesUserBrowserData: true }]) {
    await writeFile(path.join(directory, 'verification.json'), JSON.stringify(report));
    await assert.rejects(verifyReleaseResources(directory), /resource verification/);
  }
});

void test('release trial configuration rejects symbolic links, oversized files, and local test origins', async t => {
  const { directory, filename } = await fixture(t);
  await writeFile(filename, ' '.repeat(1025));
  await assert.rejects(verifyReleaseTrialService(directory), /regular public configuration file/);
  const outside = await fixture(t);
  await rm(filename);
  await symlink(outside.filename, filename);
  await assert.rejects(verifyReleaseTrialService(directory), /regular public configuration file/);
  await rm(filename);
  await writeFile(filename, JSON.stringify({ gatewayUrl: 'http://127.0.0.1:43371' }));
  await assert.rejects(verifyReleaseTrialService(directory), /Invalid trial service/);
});
