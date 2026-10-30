import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createReleaseConfiguration, createReleaseElectronDownload, resolveUpdateFeed, validateReleasePreflight, validateReleaseVersion } from '../desktop/scripts/release-config.mjs';
import { verifyUpdateDirectory, writeUpdateVerification } from '../desktop/scripts/verify-update-metadata.mjs';
import { createReleaseTargets, prepareReleaseUploads, selectMacReleaseUploads, verifyMacApplication, verifyMacArchive } from '../desktop/scripts/release.mjs';

const desktopRequire = createRequire(new URL('../desktop/package.json', import.meta.url));
const builderRequire = createRequire(desktopRequire.resolve('electron-builder'));
const libraryRequire = createRequire(builderRequire.resolve('app-builder-lib'));
const { buildBlockMap } = libraryRequire('./targets/blockmap/blockmap');
const { blake2b } = libraryRequire('@noble/hashes/blake2.js');

// Public hostname fixtures are never contacted or saved as application configuration.
const baseUrl = 'https://releases.cloudflare.com/lumior';
const env = { LUMIOR_UPDATE_BASE_URL: baseUrl, CSC_LINK: 'synthetic-certificate', CSC_KEY_PASSWORD: 'synthetic-password',
  LUMIOR_SIGNING_TEAM_ID: 'SYNTHETIC1', APPLE_TEAM_ID: 'SYNTHETIC1', APPLE_ID: 'synthetic-account', APPLE_APP_SPECIFIC_PASSWORD: 'synthetic-password' };

void test('release feeds separate Mac architectures and preserve updater platform metadata names', () => {
  assert.equal(resolveUpdateFeed(baseUrl, 'mac', 'arm64'), `${baseUrl}/mac/arm64/`);
  assert.equal(resolveUpdateFeed(`${baseUrl}/`, 'mac', 'x64'), `${baseUrl}/mac/x64/`);
  assert.equal(resolveUpdateFeed(baseUrl, 'win', 'x64'), `${baseUrl}/win/x64/`);
  for (const invalid of ['', 'http://public.net', 'https://user:password@public.net', 'https://public.net/?token=secret',
    'https://public.net/#feed', 'https://localhost', 'https://127.0.0.1', 'https://updates.example.com', 'https://public.net:8443', 'https://public.net/a%2fb']) {
    assert.throws(() => resolveUpdateFeed(invalid, 'mac', 'arm64'));
  }
  assert.throws(() => resolveUpdateFeed(baseUrl, 'mac', 'universal'));
  assert.throws(() => validateReleaseVersion('0.1.3-beta.1'));
});

void test('installed electron-updater requests the expected manifest inside each isolated feed', async () => {
  const desktopRequire = createRequire(new URL('../desktop/package.json', import.meta.url));
  const { GenericProvider } = desktopRequire('electron-updater/out/providers/GenericProvider');
  for (const [platform, arch, runtimePlatform, metadataName] of [['mac', 'arm64', 'darwin', 'latest-mac.yml'],
    ['mac', 'x64', 'darwin', 'latest-mac.yml'], ['win', 'x64', 'win32', 'latest.yml']]) {
    let requestedUrl;
    const provider = new GenericProvider({ provider: 'generic', url: resolveUpdateFeed(baseUrl, platform, arch), channel: 'latest' },
      { isAddNoCacheQuery: false }, { platform: runtimePlatform, executor: { request: async options => {
        requestedUrl = `${options.protocol}//${options.hostname}${options.path}`;
        return JSON.stringify({ version: '0.1.3' });
      } } });
    await provider.getLatestVersion();
    assert.equal(requestedUrl, `${baseUrl}/${platform}/${arch}/${metadataName}`);
  }
});

void test('release configuration seals the exact feed and only builds one architecture without changing preview config', () => {
  const packageJson = { version: '0.1.3', build: { publish: null, directories: { output: 'preview', buildResources: 'assets' },
    mac: { target: [{ target: 'dmg', arch: ['arm64', 'x64'] }] }, extraResources: [{ from: 'generated', to: 'lumior-runtime' }] } };
  const original = structuredClone(packageJson);
  const { config, trustedConfig } = createReleaseConfiguration({ packageJson, baseUrl, platform: 'mac', arch: 'arm64',
    outputDirectory: '/tmp/synthetic-release', trustedConfigFile: '/tmp/synthetic-config.json' });
  assert.deepEqual(packageJson, original);
  assert.deepEqual(trustedConfig, { schemaVersion: 1, enabled: true, provider: 'generic', url: `${baseUrl}/mac/arm64/`,
    channel: 'latest', platform: 'darwin', arch: 'arm64', version: '0.1.3' });
  assert.equal(config.publish.url, trustedConfig.url);
  assert.equal(config.forceCodeSigning, true);
  assert.equal(config.mac.notarize, true);
  assert.equal(config.mac.hardenedRuntime, true);
  assert.deepEqual(config.mac.target, [{ target: 'dmg', arch: ['arm64'] }, { target: 'zip', arch: ['arm64'] }]);
  assert.equal(config.extraResources.at(-1).to, 'lumior-update-config.json');
  assert.equal(JSON.stringify(config).includes('synthetic-password'), false);
});

void test('release configuration conforms to the installed electron-builder schema', async () => {
  const desktopRequire = createRequire(new URL('../desktop/package.json', import.meta.url));
  const builderRequire = createRequire(desktopRequire.resolve('electron-builder'));
  const libraryRequire = createRequire(builderRequire.resolve('app-builder-lib'));
  const { validateConfiguration } = libraryRequire('./util/config/config');
  const packageJson = JSON.parse(await readFile(new URL('../desktop/package.json', import.meta.url), 'utf8'));
  const { config } = createReleaseConfiguration({ packageJson, baseUrl, platform: 'mac', arch: 'arm64',
    outputDirectory: '/tmp/synthetic-release', trustedConfigFile: '/tmp/synthetic-config.json' });
  const electronPackage = desktopRequire('electron/package.json');
  config.electronVersion = electronPackage.version;
  config.electronDownload = createReleaseElectronDownload({ packageJson, electronPackage, checksums: desktopRequire('electron/checksums.json'), platform: 'mac', arch: 'arm64' });
  await validateConfiguration(config, { isEnabled: false });
});

void test('release downloads use only the pinned official Electron checksum for their target', () => {
  const packageJson = desktopRequire('./package.json');
  const electronPackage = desktopRequire('electron/package.json');
  const checksums = desktopRequire('electron/checksums.json');
  for (const arch of ['arm64', 'x64']) {
    const filename = `electron-v${electronPackage.version}-darwin-${arch}.zip`;
    assert.deepEqual(createReleaseElectronDownload({ packageJson, electronPackage, checksums, platform: 'mac', arch }),
      { force: false, checksums: { [filename]: checksums[filename] } });
  }
  const options = { packageJson, electronPackage, checksums, platform: 'mac', arch: 'arm64' };
  assert.throws(() => createReleaseElectronDownload({ ...options, electronPackage: { ...electronPackage, version: '0.0.0' } }), /exact pinned/);
  assert.throws(() => createReleaseElectronDownload({ ...options, packageJson: { ...packageJson, devDependencies: { electron: `^${electronPackage.version}` } } }), /exact pinned/);
  assert.throws(() => createReleaseElectronDownload({ ...options, checksums: {} }), /missing a valid hash/);
  assert.throws(() => createReleaseElectronDownload({ ...options, checksums: { [`electron-v${electronPackage.version}-darwin-arm64.zip`]: 'invalid-hash' } }), /missing a valid hash/);
});

void test('installed builder framework preserves pinned checksums, cache reads and normal Electron cleanup', async t => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'lumior-electron-checksum-test-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const syntheticZip = path.join(temporary, 'synthetic-electron.zip');
  await writeFile(syntheticZip, 'synthetic artifact; no download or extraction');
  const version = '99.1.1', filename = `electron-v${version}-darwin-arm64.zip`, checksum = 'a'.repeat(64);
  const electronDownload = createReleaseElectronDownload({ packageJson: { devDependencies: { electron: version } },
    electronPackage: { name: 'electron', version }, checksums: { [filename]: checksum }, platform: 'mac', arch: 'arm64' });
  const get = libraryRequire('@electron/get');
  const original = get.downloadArtifact;
  const electronGet = libraryRequire('./util/electronGet');
  const originalExtract = electronGet.extractArchive;
  let received;
  // Exercise the framework transform before the downloader discriminator. Stubbing
  // the network and extraction keeps this check independent of caches or services.
  get.downloadArtifact = async options => { received = options; return syntheticZip; };
  const unpacked = path.join(temporary, 'unpacked');
  const defaultApp = path.join(unpacked, 'Electron.app/Contents/Resources/default_app.asar');
  const electronVersion = path.join(unpacked, 'version');
  electronGet.extractArchive = async (archive, directory) => {
    assert.equal(archive, syntheticZip);
    assert.equal(directory, unpacked);
    await mkdir(path.dirname(defaultApp), { recursive: true });
    await writeFile(defaultApp, 'synthetic default Electron app');
    await writeFile(electronVersion, version);
  };
  try {
    const { createElectronFrameworkSupport } = libraryRequire('./electron/ElectronFramework');
    const builder = desktopRequire('electron-builder');
    const config = { electronVersion: version, electronDownload };
    const framework = await createElectronFrameworkSupport(config, {});
    await framework.prepareApplicationStageDirectory({ appOutDir: unpacked, platformName: 'darwin', arch: 'arm64',
      packager: { config, platform: builder.Platform.MAC, appInfo: { type: 'commonjs' }, info: { getWorkspaceRoot: async () => temporary } } });
    assert.deepEqual(received.checksums, { [filename]: checksum });
    assert.equal(received.mirrorOptions, undefined);
    assert.equal(received.force, false);
    assert.equal(received.cacheMode, get.ElectronDownloadCacheMode.ReadWrite);
    assert.notEqual(received.unsafelyDisableChecksums, true);
    assert.notEqual(received.downloadOptions?.https?.rejectUnauthorized, false);
    assert.equal(received.platform, 'darwin');
    assert.equal(received.arch, 'arm64');
    assert.equal(received.version, version);
    await assert.rejects(readFile(defaultApp), { code: 'ENOENT' });
    await assert.rejects(readFile(electronVersion), { code: 'ENOENT' });
  } finally { get.downloadArtifact = original; electronGet.extractArchive = originalExtract; }
});

void test('installed builder resolves each explicit release to one architecture despite merged preview targets', async () => {
  const builder = desktopRequire('electron-builder');
  const { getConfig } = libraryRequire('./util/config/config');
  const { computeArchToTargetNamesMap, createTargets } = libraryRequire('./targets/targetFactory');
  const packageJson = JSON.parse(await readFile(new URL('../desktop/package.json', import.meta.url), 'utf8'));
  for (const arch of ['arm64', 'x64']) {
    const { config } = createReleaseConfiguration({ packageJson, baseUrl, platform: 'mac', arch,
      outputDirectory: '/tmp/synthetic-release', trustedConfigFile: '/tmp/synthetic-config.json' });
    const effective = await getConfig(fileURLToPath(new URL('../desktop', import.meta.url)), null, structuredClone(config));
    const platformPackager = { platformSpecificBuildOptions: effective.mac, defaultTarget: ['zip', 'dmg'],
      createTargets(names, mapper) { for (const name of names) mapper(name, () => ({ name })); } };
    // Reproduce the former failure using the installed config merger and target resolver.
    const implicit = builder.Platform.MAC.createTarget(undefined, builder.Arch[arch]);
    const expanded = computeArchToTargetNamesMap(implicit.get(builder.Platform.MAC), platformPackager, builder.Platform.MAC);
    assert.equal(expanded.has(builder.Arch.arm64), true);
    assert.equal(expanded.has(builder.Arch.x64), true);
    const explicit = createReleaseTargets({ platform: 'mac', arch, builder });
    assert.deepEqual([...explicit.keys()], [builder.Platform.MAC]);
    const resolved = computeArchToTargetNamesMap(explicit.get(builder.Platform.MAC), platformPackager, builder.Platform.MAC);
    assert.deepEqual([...resolved.keys()], [builder.Arch[arch]]);
    assert.deepEqual(createTargets(new Map(), resolved.get(builder.Arch[arch]), '/tmp/synthetic-release', platformPackager).map(target => target.name), ['dmg', 'zip']);
  }
  assert.throws(() => createReleaseTargets({ platform: 'mac', arch: 'universal', builder }), /Unsupported/);
  assert.throws(() => createReleaseTargets({ platform: 'win', arch: 'arm64', builder }), /Unsupported/);
});

void test('release preflight fails for missing feed, signing, notarization, wrong version/team, and unsupported host', () => {
  const options = { version: '0.1.3', expectedVersion: '0.1.3', platform: 'mac', arch: 'arm64', env, hostPlatform: 'darwin' };
  assert.equal(validateReleasePreflight(options).teamId, 'SYNTHETIC1');
  for (const changed of [{ env: {} }, { env: { ...env, CSC_LINK: '' } }, { env: { ...env, APPLE_ID: '' } },
    { env: { ...env, APPLE_ID: '', APPLE_API_KEY: 'synthetic-key', APPLE_API_KEY_ID: 'synthetic-key-id', APPLE_API_ISSUER: 'synthetic-issuer' } },
    { env: { ...env, CSC_NAME: '-' } }, { env: { ...env, APPLE_TEAM_ID: 'DIFFERENT1' } },
    { expectedVersion: '0.1.2' }, { hostPlatform: 'linux' }, { platform: 'win', arch: 'x64' }]) {
    assert.throws(() => validateReleasePreflight({ ...options, ...changed }));
  }
});

void test('keychain release accepts the builder-compatible certificate name and notarization profile', () => {
  const keychainEnv = { LUMIOR_UPDATE_BASE_URL: baseUrl, CSC_NAME: 'Synthetic Fixture (SYNTHETIC1)',
    LUMIOR_SIGNING_TEAM_ID: 'SYNTHETIC1', APPLE_KEYCHAIN_PROFILE: 'synthetic-profile', CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
  const options = { version: '0.1.3', platform: 'mac', arch: 'arm64', env: keychainEnv, hostPlatform: 'darwin' };
  assert.deepEqual(validateReleasePreflight(options), { url: `${baseUrl}/mac/arm64/`, teamId: 'SYNTHETIC1' });
  assert.equal(validateReleasePreflight({ ...options, env: { ...keychainEnv, CSC_NAME: '合成测试姓名 (SYNTHETIC1)' } }).teamId, 'SYNTHETIC1');
  for (const CSC_NAME of ['Developer ID Application: Synthetic Fixture (SYNTHETIC1)',
    'Apple Development: Synthetic Fixture (SYNTHETIC1)', 'Synthetic Fixture', '-', ' (SYNTHETIC1)',
    'Synthetic\nFixture (SYNTHETIC1)', 'Synthetic Fixture (DIFFERENT1)']) {
    assert.throws(() => validateReleasePreflight({ ...options, env: { ...keychainEnv, CSC_NAME } }), /CSC_NAME/);
  }
  assert.throws(() => validateReleasePreflight({ ...options, env: { ...keychainEnv, APPLE_ID: 'synthetic-account' } }), /APPLE_APP_SPECIFIC_PASSWORD/);
});

void test('imported certificates still require discovery unless an explicit certificate name is supplied', () => {
  const options = { version: '0.1.3', platform: 'mac', arch: 'arm64', env, hostPlatform: 'darwin' };
  assert.throws(() => validateReleasePreflight({ ...options, env: { ...env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } }), /CSC_NAME.*CSC_IDENTITY_AUTO_DISCOVERY/);
  assert.equal(validateReleasePreflight({ ...options, env: { ...env, CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    CSC_NAME: 'Synthetic Fixture (SYNTHETIC1)' } }).teamId, 'SYNTHETIC1');
});

void test('installed builder selects a synthetic Developer ID certificate using the accepted short name', async () => {
  const codeSign = libraryRequire('./codeSign/macCodeSign');
  const originalCache = codeSign.findIdentityRawResult;
  const name = 'Synthetic Fixture (SYNTHETIC1)';
  const hash = 'a'.repeat(40);
  // Supply builder's identity cache directly: this test never queries a real keychain.
  codeSign.findIdentityRawResult = Promise.resolve([
    `${'b'.repeat(40)} "Developer ID Installer: ${name}"`,
    `${hash} "Developer ID Application: ${name}"`,
  ]);
  try {
    const identity = await codeSign.findIdentity('Developer ID Application', name);
    assert.equal(identity.name, `Developer ID Application: ${name}`);
    assert.equal(identity.hash, hash);
    assert.throws(() => codeSign.findIdentity('Developer ID Application', `Developer ID Application: ${name}`), /remove prefix/);
  } finally {
    codeSign.findIdentityRawResult = originalCache;
  }
});

async function fixture(t, { metadataVersion = '0.1.3' } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'lumior-release-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const files = [];
  for (const extension of ['zip', 'dmg']) {
    const name = `Lumior-0.1.3-mac-arm64.${extension}`;
    const bytes = Buffer.from(`synthetic ${extension} content`);
    await writeFile(path.join(directory, name), bytes);
    await buildBlockMap(path.join(directory, name), 'gzip', path.join(directory, `${name}.blockmap`));
    files.push({ url: name, size: bytes.length, sha512: createHash('sha512').update(bytes).digest('base64') });
  }
  const metadata = { version: metadataVersion, files, path: files[0].url, sha512: files[0].sha512 };
  // JSON is valid YAML, matching the parser used by electron-updater.
  await writeFile(path.join(directory, 'latest-mac.yml'), JSON.stringify(metadata));
  return { directory, metadata, options: { directory, version: '0.1.3', platform: 'mac', arch: 'arm64' } };
}

void test('release upload selection requires exact filenames and rejects mixed architectures or manifest formats', () => {
  const expected = ['latest-mac.yml', 'Lumior-0.1.3-mac-arm64.dmg', 'Lumior-0.1.3-mac-arm64.dmg.blockmap',
    'Lumior-0.1.3-mac-arm64.zip', 'Lumior-0.1.3-mac-arm64.zip.blockmap'];
  assert.deepEqual(selectMacReleaseUploads([...expected, 'mac-arm64', 'builder-debug.yml', 'builder-effective-config.yaml'], { version: '0.1.3', arch: 'arm64' }), expected);
  for (const extra of ['Lumior-0.1.3-mac-x64.zip', 'Lumior-0.1.4-mac-arm64.dmg', 'latest-mac-x64.yml', 'latest-mac.json', 'latest.yml']) {
    assert.throws(() => selectMacReleaseUploads([...expected, extra], { version: '0.1.3', arch: 'arm64' }), /different version, platform, or architecture/);
  }
  assert.throws(() => selectMacReleaseUploads(expected.slice(1), { version: '0.1.3', arch: 'arm64' }), /must contain/);
});

void test('release staging verifies actual metadata before producing the files for the upload directory', async t => {
  const valid = await fixture(t);
  await writeFile(path.join(valid.directory, 'builder-effective-config.yaml'), 'synthetic-builder-config');
  const stagingDirectory = path.join(valid.directory, 'staged-updates');
  const uploads = await prepareReleaseUploads({ ...valid.options, buildDirectory: valid.directory, stagingDirectory });
  assert.equal(uploads.length, 7);
  assert.equal(uploads.includes('builder-effective-config.yaml'), false);
  const report = JSON.parse(await readFile(path.join(stagingDirectory, 'release-verification.json'), 'utf8'));
  assert.equal(report.arch, 'arm64');
  assert.equal(report.version, '0.1.3');
  assert.deepEqual((await verifyUpdateDirectory({ ...valid.options, directory: stagingDirectory })).checksums, report.checksums);
  const mixed = await fixture(t);
  mixed.metadata.files[0].url = 'Lumior-0.1.3-mac-x64.zip';
  await writeFile(path.join(mixed.directory, 'latest-mac.yml'), JSON.stringify(mixed.metadata));
  await assert.rejects(() => prepareReleaseUploads({ ...mixed.options, buildDirectory: mixed.directory, stagingDirectory: path.join(mixed.directory, 'staged-updates') }), /own architecture/);
});

void test('synthetic update directory verifies both artifacts, SHA-512, blockmaps, and writes reproducible checksums', async t => {
  const { directory, options } = await fixture(t);
  const report = await writeUpdateVerification(options);
  assert.equal(report.files.length, 2);
  assert.equal(report.externallyPublished, false);
  assert.equal(report.checksums.length, 5);
  assert.equal((await readFile(path.join(directory, 'SHA256SUMS.txt'), 'utf8')).split('\n').filter(Boolean).length, 5);
  assert.deepEqual((await verifyUpdateDirectory(options)).checksums, report.checksums);
});

void test('update verification rejects mismatched versions and altered installer bytes', async t => {
  const mismatch = await fixture(t, { metadataVersion: '0.1.2' });
  await assert.rejects(() => verifyUpdateDirectory(mismatch.options), /version/);
  const changed = await fixture(t);
  await writeFile(path.join(changed.directory, changed.metadata.files[0].url), 'tampered bytes');
  await assert.rejects(() => verifyUpdateDirectory(changed.options), /size mismatch|SHA-512 mismatch/);
});

void test('update verification rejects cross-architecture, external, missing-blockmap, and linked artifacts', async t => {
  for (const url of ['Lumior-0.1.3-mac-x64.zip', '../outside.zip', 'https://outside.net/update.zip']) {
    const entry = await fixture(t);
    entry.metadata.files[0].url = url;
    await writeFile(path.join(entry.directory, 'latest-mac.yml'), JSON.stringify(entry.metadata));
    await assert.rejects(() => verifyUpdateDirectory(entry.options), /own architecture/);
  }
  const missing = await fixture(t);
  await rm(path.join(missing.directory, `${missing.metadata.files[0].url}.blockmap`));
  await assert.rejects(() => verifyUpdateDirectory(missing.options), /ENOENT/);
  const linked = await fixture(t);
  const filename = path.join(linked.directory, linked.metadata.files[0].url);
  await rm(filename);
  await symlink(path.join(linked.directory, linked.metadata.files[1].url), filename);
  await assert.rejects(() => verifyUpdateDirectory(linked.options), /regular files/);
});

void test('update verification rejects incomplete blockmap coverage and unexpected upload files', async t => {
  const incomplete = await fixture(t);
  await writeFile(path.join(incomplete.directory, `${incomplete.metadata.files[0].url}.blockmap`), gzipSync(JSON.stringify({ version: '2',
    files: [{ offset: 0, sizes: [1], checksums: ['synthetic'] }] })));
  await assert.rejects(() => verifyUpdateDirectory(incomplete.options), /Blockmap size mismatch/);
  const unexpected = await fixture(t);
  await writeFile(path.join(unexpected.directory, '.env'), 'synthetic-private-file');
  await assert.rejects(() => verifyUpdateDirectory(unexpected.options), /unexpected file/);
});

void test('update verification rejects malformed and valid-length but incorrect blockmap checksums', async t => {
  for (const checksum of ['synthetic-block-checksum', Buffer.alloc(18).toString('base64')]) {
    const entry = await fixture(t);
    const bytes = await readFile(path.join(entry.directory, entry.metadata.files[0].url));
    await writeFile(path.join(entry.directory, `${entry.metadata.files[0].url}.blockmap`), gzipSync(JSON.stringify({ version: '2',
      files: [{ offset: 0, sizes: [bytes.length], checksums: [checksum] }] })));
    await assert.rejects(() => verifyUpdateDirectory(entry.options), /Invalid blockmap checksum|Blockmap checksum mismatch/);
  }
});

void test('blockmap verification streams blocks across file-read boundaries and validates each block', async t => {
  const entry = await fixture(t);
  const name = entry.metadata.files[0].url;
  const bytes = Buffer.alloc(150000);
  for (let index = 0; index < bytes.length; index++) bytes[index] = index % 251;
  const sizes = [19001, 32768, 23007, 31009, 32768, 11447];
  assert.equal(sizes.reduce((sum, size) => sum + size, 0), bytes.length);
  let offset = 0;
  const checksums = sizes.map(size => {
    const checksum = Buffer.from(blake2b(bytes.subarray(offset, offset + size), { dkLen: 18 })).toString('base64');
    offset += size;
    return checksum;
  });
  await writeFile(path.join(entry.directory, name), bytes);
  const blockmap = { version: '2', files: [{ offset: 0, sizes, checksums }] };
  await writeFile(path.join(entry.directory, `${name}.blockmap`), gzipSync(JSON.stringify(blockmap)));
  entry.metadata.files[0].size = bytes.length;
  entry.metadata.files[0].sha512 = createHash('sha512').update(bytes).digest('base64');
  entry.metadata.sha512 = entry.metadata.files[0].sha512;
  await writeFile(path.join(entry.directory, 'latest-mac.yml'), JSON.stringify(entry.metadata));
  await verifyUpdateDirectory(entry.options);
  blockmap.files[0].checksums[4] = blockmap.files[0].checksums[0];
  await writeFile(path.join(entry.directory, `${name}.blockmap`), gzipSync(JSON.stringify(blockmap)));
  await assert.rejects(() => verifyUpdateDirectory(entry.options), /Blockmap checksum mismatch/);
});

function syntheticMacRunner(calls, { archiveHash = 'a'.repeat(40) } = {}) {
  return (command, args, options) => {
    calls.push({ command, args });
    // Exercise configuration and signature matching without claiming these fixtures are signed apps.
    if (command === 'codesign') {
      if (args[0] !== '--display') return '';
      const cdHash = args.at(-1).includes('zip-application-') ? archiveHash : 'a'.repeat(40);
      return `Authority=Developer ID Application: Synthetic Fixture (SYNTHETIC1)\nTeamIdentifier=SYNTHETIC1\nCDHash=${cdHash}\n`;
    }
    if (command === 'xcrun' || command === 'spctl') return '';
    assert.ok(['/usr/bin/ditto', '/usr/bin/unzip'].includes(command));
    const result = spawnSync(command, args, { encoding: 'utf8', ...options });
    if (result.status !== 0 || result.error) throw new Error('Synthetic archive operation failed.');
    return result.stdout;
  };
}

async function macArchiveFixture(t) {
  const temporary = await mkdtemp(path.join(tmpdir(), 'lumior-release-zip-test-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const application = path.join(temporary, 'Lumior.app');
  const resources = path.join(application, 'Contents/Resources');
  const framework = path.join(application, 'Contents/Frameworks/Fixture.framework/Versions');
  const trustedConfig = { schemaVersion: 1, enabled: true, provider: 'generic', url: `${baseUrl}/mac/arm64/`,
    channel: 'latest', platform: 'darwin', arch: 'arm64', version: '0.1.3' };
  await mkdir(resources, { recursive: true });
  await mkdir(path.join(resources, 'lumior-runtime'), { recursive: true });
  await writeFile(path.join(resources, 'lumior-runtime/trial-service.json'), JSON.stringify({ gatewayUrl: 'https://api.lumior.work' }));
  await mkdir(path.join(framework, 'A'), { recursive: true });
  await writeFile(path.join(framework, 'A/Fixture'), 'synthetic framework bytes');
  await symlink('A', path.join(framework, 'Current'));
  await writeFile(path.join(resources, 'lumior-update-config.json'), JSON.stringify(trustedConfig));
  await writeFile(path.join(resources, 'app-update.yml'), JSON.stringify({ provider: 'generic', url: trustedConfig.url, channel: 'latest' }));
  const archive = path.join(temporary, 'Lumior-0.1.3-mac-arm64.zip');
  const calls = [];
  const runCommand = syntheticMacRunner(calls);
  const sourceSignature = await verifyMacApplication({ application, trustedConfig, teamId: 'SYNTHETIC1', runCommand });
  function packageArchive() {
    runCommand('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', application, archive]);
  }
  packageArchive();
  return { temporary, application, archive, trustedConfig, teamId: 'SYNTHETIC1', sourceSignature, runCommand, calls, packageArchive };
}

void test('Mac ZIP verification checks the extracted application and preserves framework symlinks', { skip: process.platform !== 'darwin' }, async t => {
  const entry = await macArchiveFixture(t);
  assert.deepEqual(await verifyMacArchive(entry), entry.sourceSignature);
  const extracted = entry.calls.find(call => call.command === 'codesign' && call.args[0] === '--verify'
    && call.args.at(-1).includes('zip-application-')).args.at(-1);
  assert.equal(await readlink(path.join(extracted, 'Contents/Frameworks/Fixture.framework/Versions/Current')), 'A');
  for (const command of ['codesign', 'xcrun', 'spctl']) {
    assert.ok(entry.calls.some(call => call.command === command && call.args.at(-1) === extracted));
  }
});

void test('Mac ZIP verification rejects a changed signature or packaged update configuration', { skip: process.platform !== 'darwin' }, async t => {
  const entry = await macArchiveFixture(t);
  await assert.rejects(() => verifyMacArchive({ ...entry, runCommand: syntheticMacRunner([], { archiveHash: 'b'.repeat(40) }) }), /signature does not match/);
  await writeFile(path.join(entry.application, 'Contents/Resources/lumior-update-config.json'), JSON.stringify({ ...entry.trustedConfig, version: '0.1.4' }));
  entry.packageArchive();
  await assert.rejects(() => verifyMacArchive(entry), /configuration does not match/);
});

void test('Mac release product verification rejects a missing trial origin in the signed source and archive', { skip: process.platform !== 'darwin' }, async t => {
  const entry = await macArchiveFixture(t);
  await rm(path.join(entry.application, 'Contents/Resources/lumior-runtime/trial-service.json'));
  await assert.rejects(() => verifyMacApplication(entry), /Release trial service is missing/);
  entry.packageArchive();
  await assert.rejects(() => verifyMacArchive(entry), /Release trial service is missing/);
});

void test('Mac release product verification still rejects the wrong certificate type or Apple team', { skip: process.platform !== 'darwin' }, async t => {
  const entry = await macArchiveFixture(t);
  for (const signature of [
    `Authority=Apple Development: Synthetic Fixture (SYNTHETIC1)\nTeamIdentifier=SYNTHETIC1\nCDHash=${'a'.repeat(40)}\n`,
    `Authority=Developer ID Application: Synthetic Fixture (DIFFERENT1)\nTeamIdentifier=DIFFERENT1\nCDHash=${'a'.repeat(40)}\n`,
  ]) {
    const runCommand = (command, args, options) => command === 'codesign' && args[0] === '--display'
      ? signature : entry.runCommand(command, args, options);
    await assert.rejects(() => verifyMacApplication({ ...entry, runCommand }), /expected Apple Developer ID Application signature/);
  }
});
