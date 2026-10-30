import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createWindowsUpdateConfiguration, verifyWindowsUpdateBuild, windowsUpdateFeed } from '../desktop/scripts/windows-update-config.mjs';
import { createWindowsPreviewConfiguration } from '../desktop/scripts/windows-preview-config.mjs';
import { parseYaml } from '../desktop/scripts/verify-update-metadata.mjs';
import { readUpdateBuild } from '../desktop/runtime/update-build.cjs';

const packageJson = JSON.parse(await readFile(new URL('../desktop/package.json', import.meta.url), 'utf8'));

void test('Windows automatic updates retain preview install identity and packaged production resources', () => {
  const manual = createWindowsPreviewConfiguration({ baseVersion: packageJson.version, revision: 2 });
  const { config, trustedConfig } = createWindowsUpdateConfiguration({ packageJson, revision: 2, trustedConfigFile: '/synthetic/update.json' });
  assert.equal(config.appId, manual.appId);
  assert.equal(config.productName, manual.productName);
  assert.deepEqual(config.extraMetadata, manual.extraMetadata);
  assert.deepEqual(config.nsis, manual.nsis);
  assert.deepEqual(config.extraResources.slice(0, -1), packageJson.build.extraResources);
  assert.equal(config.extraResources.at(-1).to, 'lumior-update-config.json');
  assert.equal(config.win.signExecutable, false);
  assert.equal(config.win.verifyUpdateCodeSignature, undefined, 'Do not install a signature-verification bypass');
  assert.equal(config.publish.url, windowsUpdateFeed);
  assert.equal(config.publish.channel, 'windows-preview');
  assert.equal(config.publish.useMultipleRangeRequest, false);
  assert.equal(config.detectUpdateChannel, false);
  assert.equal(config.generateUpdatesFilesForAllChannels, false);
  assert.equal(trustedConfig.platform, 'win32');
  assert.equal(trustedConfig.version, manual.extraMetadata.version);
  assert.throws(() => createWindowsUpdateConfiguration({ packageJson }), /embedded/);
});

void test('Windows build verification and runtime loader agree on the embedded dedicated feed', async t => {
  const resources = await mkdtemp(path.join(tmpdir(), 'lumior-windows-update-config-'));
  t.after(() => rm(resources, { recursive: true, force: true }));
  const { trustedConfig } = createWindowsUpdateConfiguration({ packageJson, revision: 2, trustedConfigFile: '/synthetic/update.json' });
  const provider = { provider: 'generic', url: windowsUpdateFeed, channel: 'windows-preview', useMultipleRangeRequest: false };
  const write = async (embedded = trustedConfig, updateProvider = provider) => {
    await writeFile(path.join(resources, 'lumior-update-config.json'), JSON.stringify(embedded));
    await writeFile(path.join(resources, 'app-update.yml'), JSON.stringify(updateProvider));
  };
  await write();
  assert.equal((await verifyWindowsUpdateBuild({ resources, trustedConfig, parseYaml })).enabled, true);
  assert.deepEqual(await readUpdateBuild({ resourcesPath: resources, version: trustedConfig.version, isPackaged: true,
    development: false, platform: 'win32', arch: 'x64', parseYaml }), { provider: 'generic', url: windowsUpdateFeed, channel: 'windows-preview' });
  for (const updateProvider of [{ ...provider, channel: 'latest' }, { ...provider, url: 'https://other.example.test/' },
    { ...provider, publisherName: 'Unexpected Publisher' }, { ...provider, useMultipleRangeRequest: true }]) {
    await write(trustedConfig, updateProvider);
    await assert.rejects(verifyWindowsUpdateBuild({ resources, trustedConfig, parseYaml }), /provider/);
  }
  await write({ ...trustedConfig, version: '0.1.0-win.1' });
  await assert.rejects(verifyWindowsUpdateBuild({ resources, trustedConfig, parseYaml }), /configuration/);
});
