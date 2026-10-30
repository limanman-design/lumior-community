import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { desktopDistribution } from '../desktop/runtime/distribution.cjs';
import { desktopIdentity } from '../desktop/runtime/app-identity.cjs';
import { resolveDesktopBuildDistribution, verifyDistributionBuild, writeDistributionBuild } from '../desktop/scripts/distribution-build.mjs';
import { createReleaseConfiguration } from '../desktop/scripts/release-config.mjs';
import { createWindowsPreviewConfiguration } from '../desktop/scripts/windows-preview-config.mjs';
import { desktopConfiguration, cleanBackendEnvironment, createSecurity } from '../desktop/runtime/security.cjs';

const metadata = JSON.parse(await readFile(new URL('../desktop/package.json', import.meta.url), 'utf8'));

void test('plain desktop builds and source checkouts default to community', () => {
  assert.equal(resolveDesktopBuildDistribution([]), 'community');
  assert.equal(resolveDesktopBuildDistribution(['--windows']), 'community');
  assert.equal(resolveDesktopBuildDistribution(['--official']), 'official');
  assert.throws(() => resolveDesktopBuildDistribution(['--official', '--community']), /Choose one/);
  assert.equal(desktopDistribution(), 'community');
  assert.throws(() => desktopDistribution('invalid'), /Unknown/);
  assert.equal(metadata.lumiorDistribution, 'community');
  assert.equal(metadata.build.appId, 'app.lumior.community');
  assert.ok(metadata.build.files.includes('runtime/distribution.cjs'));
});

void test('community profiles cannot share official, preview, or development data by default', () => {
  for (const platform of ['darwin', 'win32', 'linux']) {
    const community = desktopIdentity({ platform, development: false, distribution: 'community' });
    const communityDev = desktopIdentity({ platform, development: true, distribution: 'community' });
    assert.equal(community.userDataName, 'Lumior Community');
    assert.notEqual(communityDev.userDataName, community.userDataName);
    for (const development of [false, true]) {
      for (const channel of [undefined, 'windows-preview']) {
        const official = desktopIdentity({ platform, development, channel, distribution: 'official' });
        assert.notEqual(community.userDataName, official.userDataName);
        assert.notEqual(communityDev.userDataName, official.userDataName);
        assert.notEqual(community.appId, official.appId);
      }
    }
  }
});

void test('community services use isolated ports, preserve protected test ports, and cannot choose identity through ambient environment', () => {
  for (const development of [false, true]) {
    const environment = { LUMIOR_DESKTOP_DEV: development ? '1' : '0', LUMIOR_DESKTOP_DISTRIBUTION: 'community' };
    const official = desktopConfiguration(!development, environment, 'official');
    const community = desktopConfiguration(!development, environment, 'community');
    assert.equal(official.port, development ? 43172 : 43171);
    assert.equal(community.port, development ? 43174 : 43173);
    const forwarded = cleanBackendEnvironment(environment, 'synthetic-token', '/web', development, 'official');
    assert.equal(forwarded.LUMIOR_DESKTOP_DISTRIBUTION, 'official');
    assert.deepEqual(desktopConfiguration(!development, forwarded, forwarded.LUMIOR_DESKTOP_DISTRIBUTION), official);
    const isolated = { ...environment, LUMIOR_DESKTOP_TEST_MODE: '1', LUMIOR_DESKTOP_TEST_PORT: development ? '43272' : '43271' };
    assert.equal(desktopConfiguration(!development, isolated, 'community').port, community.port);
    assert.equal(desktopConfiguration(!development, { ...isolated, LUMIOR_DESKTOP_DATA_DIR: '/tmp/synthetic-isolated-profile' }, 'community').port, development ? 43272 : 43271);
    const token = 'a'.repeat(64), secured = createSecurity(community.port);
    assert.equal(secured.authorizeRequest({ host: `127.0.0.1:${official.port}`, 'x-lumior-desktop': token }, token), false);
    assert.equal(secured.authorizeRequest({ host: `127.0.0.1:${community.port}`, 'x-lumior-desktop': token }, token), true);
  }
});

void test('packaging rejects resources from the other distribution and official config in community output', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'lumior-community-build-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(verifyDistributionBuild(directory, 'community'));
  await writeDistributionBuild(directory, 'community');
  await verifyDistributionBuild(directory, 'community');
  await assert.rejects(verifyDistributionBuild(directory, 'official'), /Prepare official/);
  for (const name of ['trial-service.json', 'lumior-update-config.json', 'app-update.yml']) {
    await writeFile(path.join(directory, name), '{}');
    await assert.rejects(verifyDistributionBuild(directory, 'community'), /must not contain official/);
    await rm(path.join(directory, name));
  }
  await writeDistributionBuild(directory, 'official');
  await verifyDistributionBuild(directory, 'official');
  await assert.rejects(verifyDistributionBuild(directory, 'community'), /Prepare community/);
});

void test('official builders explicitly restore their existing identity and update artifact names', () => {
  const { config } = createReleaseConfiguration({ packageJson: metadata, baseUrl: 'https://updates.lumior.work', platform: 'mac', arch: 'arm64', outputDirectory: '/tmp/lumior-release', trustedConfigFile: '/tmp/lumior-config.json' });
  assert.equal(config.productName, 'Lumior');
  assert.equal(config.appId, 'app.lumior.desktop');
  assert.equal(config.extraMetadata.lumiorDistribution, 'official');
  assert.equal(config.artifactName, 'Lumior-${version}-${os}-${arch}.${ext}');
  const preview = createWindowsPreviewConfiguration({ baseVersion: metadata.version });
  assert.equal(preview.extraMetadata.lumiorDistribution, 'official');
  assert.equal(preview.appId, 'app.lumior.desktop.windows-preview');
  assert.equal(preview.productName, 'Lumior Preview');
});

void test('community runtime cannot read an official trial file or enable the official updater', async () => {
  const main = await readFile(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /const gatewayUrl = distribution === 'official' \? await readTrialService\(runtimeDirectory\) : ''/);
  assert.match(main, /if \(distribution === 'official' && app\.isPackaged && !development\)/);
  const pack = await readFile(new URL('../desktop/scripts/community-pack.mjs', import.meta.url), 'utf8');
  assert.match(pack, /verifyDistributionBuild\(path\.join\(desktop, 'generated'\), 'community'\)/);
  assert.match(pack, /publish: 'never'/);
});
