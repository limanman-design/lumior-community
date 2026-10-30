import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { readUpdateBuild } = require('../desktop/runtime/update-build.cjs');
const updaterRequire = createRequire(require.resolve('../desktop/node_modules/electron-updater'));
const yaml = updaterRequire('js-yaml');
const url = 'https://updates.example.test/lumior/mac/arm64/';
const original = { schemaVersion: 1, enabled: true, provider: 'generic', url, channel: 'latest', platform: 'darwin', arch: 'arm64', version: '0.1.3' };

async function fixture(run) {
  const directory = await mkdtemp(path.join(tmpdir(), 'lumior-update-build-'));
  const write = async (value = original, provider = `provider: generic\nurl: ${url}\nupdaterCacheDirName: lumior-desktop-updater\n`) => {
    await writeFile(path.join(directory, 'lumior-update-config.json'), typeof value === 'string' ? value : JSON.stringify(value));
    await writeFile(path.join(directory, 'app-update.yml'), provider);
  };
  const read = (overrides = {}) => readUpdateBuild({ isPackaged: true, development: false, resourcesPath: directory, platform: 'darwin', arch: 'arm64', version: '0.1.3', parseYaml: source => yaml.load(source, { schema: yaml.JSON_SCHEMA }), ...overrides });
  try { await write(); await run({ write, read }); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

void test('only a coherent packaged build can enable its fixed update feed', async () => {
  await fixture(async ({ read }) => {
    const config = await read();
    assert.deepEqual(config, { provider: 'generic', url });
    assert.equal(Object.isFrozen(config), true);
    assert.equal(await read({ isPackaged: false }), undefined);
    assert.equal(await read({ development: true }), undefined);
    assert.equal(await read({ arch: 'x64' }), undefined);
    assert.equal(await read({ platform: 'win32' }), undefined);
    assert.equal(await read({ version: '0.1.4' }), undefined);
  });
});
void test('a missing or malformed sealed configuration leaves updates disabled', async () => {
  await fixture(async ({ write, read }) => {
    for (const source of ['{', 'null', '[]', JSON.stringify({ ...original, schemaVersion: 2 }), JSON.stringify({ ...original, enabled: false }), JSON.stringify({ ...original, channel: 'beta' }), JSON.stringify({ ...original, requestHeaders: { Authorization: 'synthetic' } })]) {
      await write(source);
      assert.equal(await read(), undefined);
    }
    await write(' '.repeat(8193));
    assert.equal(await read(), undefined);
    assert.equal(await read({ resourcesPath: '/nonexistent-lumior-fixture' }), undefined);
  });
});
void test('provider metadata must agree with the sealed feed and parse safely', async () => {
  await fixture(async ({ write, read }) => {
    for (const provider of ['provider: github\nowner: example\nrepo: example', 'provider: generic\nurl: https://other.example.test/', `provider: generic\nurl: ${url}\nurl: https://other.example.test/`, '!!js/function function(){}', 'null']) {
      await write(original, provider);
      assert.equal(await read(), undefined);
    }
  });
});
void test('plaintext transport and embedded credentials cannot enable an update build', async () => {
  await fixture(async ({ write, read }) => {
    for (const unsafe of ['http://updates.example.test/', 'https://user:secret@example.test/', 'file:///tmp/update', 'https://updates.example.test/?token=synthetic', 'https://updates.example.test/#channel']) {
      await write({ ...original, url: unsafe }, `provider: generic\nurl: ${unsafe}\n`);
      assert.equal(await read(), undefined);
    }
  });
});

void test('Windows Preview requires its explicit channel, x64 platform and exact installed revision', async () => {
  const previewUrl = 'https://updates.example.test/windows/x64/';
  const preview = { ...original, url: previewUrl, channel: 'windows-preview', platform: 'win32', arch: 'x64', version: '0.1.34-win.2' };
  const provider = `provider: generic\nurl: ${previewUrl}\nchannel: windows-preview\n`;
  await fixture(async ({ write, read }) => {
    await write(preview, provider);
    const installed = { platform: 'win32', arch: 'x64', version: preview.version };
    assert.deepEqual(await read(installed), { provider: 'generic', url: previewUrl, channel: 'windows-preview' });
    assert.equal(await read({ ...installed, isPackaged: false }), undefined);
    assert.equal(await read({ ...installed, development: true }), undefined);
    assert.equal(await read({ ...installed, version: '0.1.34-win.1' }), undefined);
    for (const platform of ['darwin', 'linux']) {
      await write({ ...preview, platform }, provider);
      assert.equal(await read({ ...installed, platform }), undefined);
    }
    await write({ ...preview, arch: 'arm64' }, provider);
    assert.equal(await read({ ...installed, arch: 'arm64' }), undefined);
    for (const version of ['0.1.34', '0.1.34-beta.2', '0.1.34-win.0', '0.1.34-win.02', '0.1.34-win.2+other', '0.1.34-win.9007199254740992']) {
      await write({ ...preview, version }, provider);
      assert.equal(await read({ ...installed, version }), undefined, version);
    }
  });
});

void test('Windows Preview cannot silently fall back to latest or a different provider channel', async () => {
  const preview = { ...original, channel: 'windows-preview', platform: 'win32', arch: 'x64', version: '0.1.34-win.2' };
  await fixture(async ({ write, read }) => {
    const installed = { platform: 'win32', arch: 'x64', version: preview.version };
    for (const channel of ['', 'latest', 'beta', 'win']) {
      await write(preview, `provider: generic\nurl: ${url}\n${channel ? `channel: ${channel}\n` : ''}`);
      assert.equal(await read(installed), undefined);
    }
    await write({ ...preview, channel: 'latest' }, `provider: generic\nurl: ${url}\nchannel: latest\n`);
    assert.equal(await read(installed), undefined);
    await write(original, `provider: generic\nurl: ${url}\nchannel: windows-preview\n`);
    assert.equal(await read(), undefined, 'a stable Mac build cannot consume the preview channel');
    await write(original, `provider: generic\nurl: ${url}\nchannel: latest\n`);
    assert.deepEqual(await read(), { provider: 'generic', url });
  });
});
