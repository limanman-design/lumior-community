import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

const require = createRequire(import.meta.url);
const { createUpdateController } = require('../desktop/runtime/updates.cjs');
const desktopRequire = createRequire(new URL('../desktop/package.json', import.meta.url));
const updaterRequire = createRequire(desktopRequire.resolve('electron-updater'));
const { NsisUpdater } = updaterRequire('./NsisUpdater');
const { ElectronHttpExecutor } = updaterRequire('./electronHttpExecutor');
const yaml = updaterRequire('js-yaml');
const feed = { provider: 'generic', url: 'https://updates.lumior.work/windows/x64/', channel: 'windows-preview' };
const currentVersion = '0.1.34-win.2';
const nextVersion = '0.1.34-win.3';
const payload = Buffer.from('MZ\nSynthetic updater fixture; this is not an executable.\n'.repeat(100));
const sha512 = bytes => createHash('sha512').update(bytes).digest('base64');

// Only the transport boundary is replaced. The installed SDK still parses YAML,
// selects an EXE, compares versions, streams bytes through its SHA512 validator,
// writes its isolated cache and applies its normal publisher verification policy.
// This does not exercise a TLS connection or launch a Windows installer.
class MemoryHttpsExecutor extends ElectronHttpExecutor {
  constructor(objects) {
    super();
    this.objects = objects;
    this.requests = [];
  }
  createRequest(options, callback) {
    assert.equal(options.protocol, 'https:');
    assert.equal(options.hostname, 'updates.lumior.work');
    const pathname = new URL(options.path, feed.url).pathname;
    assert.ok(pathname.startsWith('/windows/x64/'));
    assert.equal(options.headers?.Authorization, undefined);
    const body = this.objects.get(pathname);
    assert.ok(body, `Unexpected synthetic request: ${pathname}`);
    this.requests.push(pathname);
    const request = new EventEmitter();
    let aborted = false;
    request.abort = () => { aborted = true; };
    request.end = () => queueMicrotask(() => {
      if (aborted) return;
      const response = Readable.from([body.subarray(0, 13), body.subarray(13)]);
      response.statusCode = 200;
      response.statusMessage = 'OK';
      response.headers = { 'content-length': String(body.length), 'content-type': pathname.endsWith('.yml') ? 'text/yaml' : 'application/octet-stream' };
      callback(response);
    });
    return request;
  }
}

async function fixture(t, { version = nextVersion, downloadedBytes = payload, publisherName, files } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'lumior-windows-update-sdk-'));
  const filename = `Lumior-${version}-windows-x64.exe`;
  const manifest = {
    version,
    files: files || [
      { url: `Lumior-${version}-windows-x64.zip`, size: 10, sha512: sha512(Buffer.alloc(10)) },
      { url: filename, size: payload.length, sha512: sha512(payload) },
    ],
    path: filename,
    sha512: sha512(payload),
    releaseDate: '2026-10-29T00:00:00.000Z',
  };
  const appUpdateConfigPath = path.join(directory, 'app-update.yml');
  await writeFile(appUpdateConfigPath, yaml.dump({ ...feed, updaterCacheDirName: 'synthetic-lumior-windows-updater', ...(publisherName ? { publisherName } : {}) }));
  const userDataPath = path.join(directory, 'user-data');
  await mkdir(userDataPath);
  const exitAttempts = [];
  const app = {
    version: currentVersion, name: 'Lumior Preview', isPackaged: true,
    appUpdateConfigPath, userDataPath, baseCachePath: path.join(directory, 'cache'),
    whenReady: async () => {},
    quit: () => { exitAttempts.push('quit'); },
    relaunch: () => { exitAttempts.push('relaunch'); },
    onQuit: () => { exitAttempts.push('onQuit'); },
  };
  const updater = new NsisUpdater(null, app);
  updater.logger = null;
  // SDK-provided test platform support selects Windows metadata on the test host.
  // Full download uses the SDK's normal checksum path, not differential fixtures.
  updater._testOnlyOptions = { platform: 'win32', isUseDifferentialDownload: false };
  updater.httpExecutor = new MemoryHttpsExecutor(new Map([
    ['/windows/x64/windows-preview.yml', Buffer.from(yaml.dump(manifest))],
    [`/windows/x64/${filename}`, downloadedBytes],
  ]));
  const errors = [], downloaded = [];
  updater.on('error', error => errors.push(error));
  updater.on('update-downloaded', event => downloaded.push(event));
  const controller = createUpdateController({ updater, currentVersion, isPackaged: true, buildConfig: feed, onBeforeInstall: async () => true });
  t.after(async () => {
    controller.dispose();
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, filename, updater, controller, errors, downloaded, exitAttempts };
}

void test('real NSIS updater resolves the Windows preview feed and downloads an unsigned EXE with SHA512 validation', async t => {
  const entry = await fixture(t);
  const result = await entry.updater.checkForUpdates();
  assert.equal(result.isUpdateAvailable, true);
  const files = await result.downloadPromise;
  assert.equal(files.length, 1);
  assert.equal(path.basename(files[0]), entry.filename, 'The ZIP must not be selected as the installer');
  assert.deepEqual(await readFile(files[0]), payload);
  assert.equal(entry.downloaded.length, 1);
  assert.equal(entry.controller.getState().status, 'downloaded');
  assert.equal(entry.controller.getState().version, nextVersion);
  assert.equal(entry.updater.allowDowngrade, false);
  assert.equal(entry.updater.autoInstallOnAppQuit, false);
  assert.equal((await entry.updater.configOnDisk.value).publisherName, undefined);
  assert.deepEqual(entry.updater.httpExecutor.requests, ['/windows/x64/windows-preview.yml', `/windows/x64/${entry.filename}`]);
  assert.deepEqual(entry.errors, []);
  assert.deepEqual(entry.exitAttempts, [], 'Downloading must not install or quit the app');
});

void test('real NSIS download rejects altered installer bytes before update-downloaded can fire', async t => {
  const corrupted = Buffer.from(payload);
  corrupted[20] ^= 1;
  const entry = await fixture(t, { downloadedBytes: corrupted });
  const result = await entry.updater.checkForUpdates();
  assert.equal(result.isUpdateAvailable, true);
  await assert.rejects(result.downloadPromise, error => error.code === 'ERR_CHECKSUM_MISMATCH');
  assert.equal(entry.downloaded.length, 0);
  assert.equal(entry.controller.getState().status, 'error');
  assert.equal(entry.updater.installerPath, null);
  assert.equal(await entry.controller.install(), false);
  assert.deepEqual(entry.exitAttempts, []);
});

void test('real NSIS updater cannot download same, older, stable or unrelated prerelease versions from the preview channel', async t => {
  for (const version of [currentVersion, '0.1.34-win.1', '0.1.33-win.99', '0.1.35', '0.1.35-beta.1', '0.1.35-win.0']) {
    await t.test(version, async subtest => {
      const entry = await fixture(subtest, { version });
      const result = await entry.updater.checkForUpdates();
      assert.equal(result.isUpdateAvailable, false);
      assert.equal(result.downloadPromise, undefined);
      assert.equal(entry.controller.getState().status, 'up-to-date');
      assert.deepEqual(entry.updater.httpExecutor.requests, ['/windows/x64/windows-preview.yml']);
      assert.deepEqual(entry.downloaded, []);
      assert.deepEqual(entry.exitAttempts, []);
    });
  }
});

void test('real NSIS updater accepts a later base version in the same preview channel', async t => {
  const entry = await fixture(t, { version: '0.1.35-win.1' });
  const result = await entry.updater.checkForUpdates();
  assert.equal(result.isUpdateAvailable, true);
  await result.downloadPromise;
  assert.equal(entry.controller.getState().version, '0.1.35-win.1');
  assert.equal(entry.controller.getState().status, 'downloaded');
});

void test('configured publisher verification remains active in the real NSIS download path', async t => {
  const entry = await fixture(t, { publisherName: ['Synthetic Publisher'] });
  const verified = [];
  // The OS certificate verifier cannot run on macOS. This negative result checks
  // that publisher policy is still invoked and enforced, not bypassed by Lumior.
  entry.updater.verifyUpdateCodeSignature = async (publishers, filename) => {
    verified.push({ publishers, filename });
    return 'synthetic certificate does not match';
  };
  const result = await entry.updater.checkForUpdates();
  await assert.rejects(result.downloadPromise, error => error.code === 'ERR_UPDATER_INVALID_SIGNATURE');
  assert.equal(verified.length, 1);
  assert.deepEqual(verified[0].publishers, ['Synthetic Publisher']);
  assert.equal(entry.downloaded.length, 0);
  assert.equal(entry.controller.getState().status, 'error');
  assert.equal(entry.updater.installerPath, null);
  assert.deepEqual(entry.exitAttempts, []);
});
