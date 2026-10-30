import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createUpdateController, normalizeBuildConfig, isUpdateState, isUpdateRequest, UPDATE_MESSAGES } = require('../desktop/runtime/updates.cjs');
const feed = { provider: 'generic', url: 'https://updates.example.test/lumior/stable/' };
const windowsFeed = { provider: 'generic', url: 'https://updates.example.test/windows/x64/', channel: 'windows-preview' };
const nextVersion = '0.2.0';
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function fakeUpdater() {
  const updater = new EventEmitter();
  // electron-updater keeps its own logger listener; disposal must preserve it.
  updater.on('error', () => {});
  updater.checkCount = 0;
  updater.installCount = 0;
  updater.installArguments = [];
  updater.feedConfigs = [];
  updater.setFeedURL = value => {
    updater.feedConfigs.push(value);
    updater.allowDowngrade = true;
  };
  updater.checkForUpdates = async () => {
    updater.checkCount += 1;
    updater.emit('checking-for-update');
    updater.emit('update-not-available', { version: '0.1.2', path: '/private/user/secret' });
    return { isUpdateAvailable: false };
  };
  updater.quitAndInstall = (...args) => { updater.installCount += 1; updater.installArguments.push(args); };
  return updater;
}
function fakeTimers() {
  const timeouts = [], intervals = [];
  const make = (callback, delay, list) => {
    const handle = { callback, delay, cleared: false, unreferenced: false, unref() { this.unreferenced = true; } };
    list.push(handle);
    return handle;
  };
  return {
    timeouts, intervals,
    setTimeout: (callback, delay) => make(callback, delay, timeouts),
    setInterval: (callback, delay) => make(callback, delay, intervals),
    clearTimeout: handle => { handle.cleared = true; },
    clearInterval: handle => { handle.cleared = true; },
  };
}
function fixture(options = {}) {
  const updater = options.updater || fakeUpdater();
  const timers = options.timers || fakeTimers();
  const controller = createUpdateController({ updater, timers, isPackaged: true, currentVersion: '0.1.2', buildConfig: feed, onBeforeInstall: async () => true, ...options });
  return { updater, timers, controller };
}
function downloaded(updater) {
  updater.emit('update-available', { version: nextVersion, releaseNotes: 'synthetic-secret', path: '/private/secret', files: [{ url: 'private-url' }] });
  updater.emit('download-progress', { percent: 75, transferred: 2, bytesPerSecond: 3, token: 'synthetic-secret' });
  updater.emit('update-downloaded', { version: nextVersion, downloadedFile: '/private/user/update.zip' });
}

void test('preview and unpackaged builds never touch updater or schedule network work', async () => {
  const untouched = new Proxy({}, { get() { throw new Error('Updater must stay untouched'); }, set() { throw new Error('Updater must stay untouched'); } });
  for (const [options, status] of [
    [{ isPackaged: false, development: true }, 'development'],
    [{ isPackaged: true, development: true }, 'development'],
    [{ isPackaged: false, development: false }, 'disabled'],
  ]) {
    const { controller, timers } = fixture({ updater: untouched, ...options });
    controller.start();
    assert.equal(controller.getState().status, status);
    assert.equal((await controller.check()).status, status);
    assert.equal(await controller.install(), false);
    assert.equal(timers.timeouts.length + timers.intervals.length, 0);
    controller.dispose();
  }
});

void test('only bundled plain HTTPS generic feeds enable updates', async () => {
  assert.deepEqual(normalizeBuildConfig(feed), feed);
  for (const buildConfig of [undefined, null, {}, 'https://updates.example.test/',
    { ...feed, provider: 'github' }, { ...feed, url: 'http://updates.example.test/' },
    { ...feed, url: 'file:///private/update.zip' }, { ...feed, url: 'https://name:secret@example.test/' },
    { ...feed, url: 'https://example.test/?token=secret' }, { ...feed, url: 'https://example.test/#secret' },
    { ...feed, url: 'https://example.test/\n' }, { ...feed, requestHeaders: { Authorization: 'secret' } },
  ]) {
    assert.equal(normalizeBuildConfig(buildConfig), null);
    const { controller, updater, timers } = fixture({ buildConfig });
    controller.start();
    assert.equal((await controller.check()).status, 'disabled');
    assert.equal(await controller.install(), false);
    assert.equal(updater.feedConfigs.length + updater.checkCount + updater.installCount, 0);
    assert.equal(timers.timeouts.length, 0);
    controller.dispose();
  }
});

void test('enabled updater downloads automatically but cannot install or enter dev mode implicitly', () => {
  const updater = fakeUpdater();
  updater.autoInstallEvent = 'onQuit';
  const { controller } = fixture({ updater });
  assert.equal(controller.getState().status, 'idle');
  assert.equal(updater.autoDownload, true);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.autoInstallEvent, 'manual');
  assert.equal(updater.forceDevUpdateConfig, false);
  assert.equal(updater.allowPrerelease, false);
  assert.equal(updater.allowDowngrade, false);
  assert.equal(updater.disableWebInstaller, true);
  assert.deepEqual(updater.feedConfigs, [{ ...feed, useMultipleRangeRequest: false }]);
  controller.dispose();
});

void test('runtime feed configuration disables multipart ranges in the installed generic provider', () => {
  const desktopRequire = createRequire(new URL('../desktop/package.json', import.meta.url));
  const { createClient } = desktopRequire('electron-updater/out/providerFactory');
  const { updater, controller } = fixture();
  const runtimeOptions = { platform: 'darwin', executor: { request() { throw new Error('Network access is not expected'); } } };
  try {
    // Exercise the installed SDK's configuration path without checking or downloading.
    assert.equal(createClient(feed, updater, runtimeOptions).isUseMultipleRangeRequest, true);
    assert.equal(createClient(updater.feedConfigs[0], updater, runtimeOptions).isUseMultipleRangeRequest, false);
    assert.deepEqual(feed, { provider: 'generic', url: 'https://updates.example.test/lumior/stable/' });
    assert.equal(controller.getState().status, 'idle');
    assert.equal(updater.checkCount, 0);
  } finally {
    controller.dispose();
  }
});

void test('generic feed prereleases are refused while native OS compatibility rules are preserved', async () => {
  const updater = fakeUpdater();
  const original = async info => info.minimumSystemVersion !== 'unsupported';
  updater.isUpdateSupported = original;
  const { controller } = fixture({ updater });
  assert.equal(await updater.isUpdateSupported({ version: '0.2.0' }), true);
  assert.equal(await updater.isUpdateSupported({ version: '0.2.0-beta.1' }), false);
  assert.equal(await updater.isUpdateSupported({ version: '0.2.0', minimumSystemVersion: 'unsupported' }), false);
  assert.equal(await updater.isUpdateSupported({ version: 'private/token' }), false);
  controller.dispose();
  assert.equal(updater.isUpdateSupported, original);
});

void test('Windows Preview selects its feed and accepts only newer Windows revisions with native compatibility', async () => {
  const updater = fakeUpdater();
  const original = async info => info.minimumSystemVersion !== 'unsupported';
  updater.isUpdateSupported = original;
  const { controller } = fixture({ updater, currentVersion: '0.1.34-win.2', buildConfig: windowsFeed });
  try {
    assert.equal(controller.getState().status, 'idle');
    assert.deepEqual(updater.feedConfigs, [{ ...windowsFeed, useMultipleRangeRequest: false }]);
    assert.equal(updater.allowPrerelease, true);
    assert.equal(updater.allowDowngrade, false);
    for (const version of ['0.1.34-win.3', '0.1.34-win.10', '0.1.35-win.1', '0.2.0-win.1']) {
      assert.equal(await updater.isUpdateSupported({ version }), true, version);
    }
    for (const version of ['0.1.34-win.2', '0.1.34-win.1', '0.1.33-win.99', '0.1.35', '0.1.35-beta.1',
      '0.1.35-alpha.1', '0.1.35-win.0', '0.1.35-win.01', '0.1.35-win.1+other', '0.1.35-win.1.more']) {
      assert.equal(await updater.isUpdateSupported({ version }), false, version);
    }
    assert.equal(await updater.isUpdateSupported({ version: '0.1.35-win.1', minimumSystemVersion: 'unsupported' }), false);
    const desktopRequire = createRequire(new URL('../desktop/package.json', import.meta.url));
    const { createClient } = desktopRequire('electron-updater/out/providerFactory');
    const provider = createClient(updater.feedConfigs[0], updater, { platform: 'win32', executor: { request() { throw new Error('No network expected'); } } });
    assert.equal(provider.channel, 'windows-preview');
    assert.equal(provider.isUseMultipleRangeRequest, false);
  } finally { controller.dispose(); }
  assert.equal(updater.isUpdateSupported, original);
});

void test('invalid preview build versions and arbitrary channels never enable checks', async () => {
  for (const currentVersion of ['0.1.34', '0.1.34-beta.1', '0.1.34-win.0', '0.1.34-win.01']) {
    const { controller, updater } = fixture({ currentVersion, buildConfig: windowsFeed });
    assert.equal((await controller.check()).status, 'disabled');
    assert.equal(updater.checkCount, 0);
    assert.equal(updater.feedConfigs.length, 0);
    controller.dispose();
  }
  for (const channel of ['latest', 'beta', '', null, undefined]) {
    assert.equal(normalizeBuildConfig({ ...feed, channel }), null);
  }
});

void test('Windows preview cannot install a cross-channel or downgraded event', async () => {
  for (const version of ['0.1.35', '0.1.35-beta.1', '0.1.34-win.2', '0.1.33-win.99']) {
    const { controller, updater } = fixture({ currentVersion: '0.1.34-win.2', buildConfig: windowsFeed });
    updater.emit('update-available', { version });
    updater.emit('update-downloaded', { version });
    assert.equal(controller.getState().status, 'error');
    assert.equal(await controller.install(), false);
    assert.equal(updater.installCount, 0);
    controller.dispose();
  }
});

void test('Windows preview download requires successful save and still honors SDK integrity errors', async () => {
  const saved = deferred();
  const { controller, updater } = fixture({ currentVersion: '0.1.34-win.2', buildConfig: windowsFeed, onBeforeInstall: () => saved.promise });
  const version = '0.1.34-win.3';
  updater.emit('update-available', { version });
  updater.emit('update-downloaded', { version });
  const install = controller.install();
  await flush();
  assert.equal(updater.installCount, 0);
  saved.resolve(true);
  assert.equal(await install, true);
  assert.equal(updater.installCount, 1);
  assert.deepEqual(updater.installArguments, [[true, true]], 'Windows installs silently and starts the updated app');
  controller.dispose();

  const invalid = fixture({ currentVersion: '0.1.34-win.2', buildConfig: windowsFeed });
  invalid.updater.emit('update-available', { version });
  invalid.updater.emit('error', new Error('SHA-512 checksum mismatch'));
  invalid.updater.emit('update-downloaded', { version });
  assert.equal(await invalid.controller.install(), false);
  assert.equal(invalid.updater.installCount, 0);
  invalid.controller.dispose();
});

void test('Windows Preview save failures never launch its silent installer', async () => {
  for (const onBeforeInstall of [undefined, () => false, () => Promise.reject(new Error('synthetic save failure'))]) {
    const { controller, updater } = fixture({ currentVersion: '0.1.34-win.2', buildConfig: windowsFeed, onBeforeInstall });
    updater.emit('update-available', { version: '0.1.34-win.3' });
    updater.emit('update-downloaded', { version: '0.1.34-win.3' });
    assert.equal(await controller.install(), false);
    assert.equal(controller.getState().message, UPDATE_MESSAGES.saveFailed);
    assert.equal(updater.installCount, 0);
    assert.deepEqual(updater.installArguments, []);
    controller.dispose();
  }
});

void test('installed NSIS SDK supports unsigned metadata without overriding signed publisher checks', async () => {
  const desktopRequire = createRequire(new URL('../desktop/package.json', import.meta.url));
  const { NsisUpdater } = desktopRequire('electron-updater/out/NsisUpdater');
  const sdk = Object.create(NsisUpdater.prototype);
  let verified;
  sdk._verifyUpdateCodeSignature = async (...args) => { verified = args; return 'synthetic rejected signature'; };
  sdk.configOnDisk = { value: Promise.resolve(windowsFeed) };
  assert.equal(await sdk.verifySignature('/synthetic/update.exe'), null);
  assert.equal(verified, undefined);
  sdk.configOnDisk = { value: Promise.resolve({ ...windowsFeed, publisherName: 'Synthetic Publisher' }) };
  assert.equal(await sdk.verifySignature('/synthetic/update.exe'), 'synthetic rejected signature');
  assert.deepEqual(verified, [['Synthetic Publisher'], '/synthetic/update.exe']);
});

void test('provider configuration failures clean up and allow a manual retry', async () => {
  const updater = fakeUpdater();
  const originalSupport = () => true;
  updater.isUpdateSupported = originalSupport;
  const configure = updater.setFeedURL;
  updater.setFeedURL = () => { throw new Error('private setup error'); };
  const { controller } = fixture({ updater });
  assert.equal(controller.getState().status, 'error');
  assert.equal(updater.listenerCount('error'), 1);
  assert.equal(updater.isUpdateSupported, originalSupport);
  updater.setFeedURL = configure;
  assert.equal((await controller.check()).status, 'up-to-date');
  assert.equal(await updater.isUpdateSupported({ version: nextVersion }), true);
  controller.dispose();
});

void test('background checks start after 30 seconds and repeat every six hours with unref timers', async () => {
  const { controller, updater, timers } = fixture();
  controller.start();
  controller.start();
  assert.equal(timers.timeouts.length, 1);
  assert.equal(timers.intervals.length, 1);
  assert.equal(timers.timeouts[0].delay, 30_000);
  assert.equal(timers.intervals[0].delay, 21_600_000);
  assert.equal(timers.timeouts[0].unreferenced && timers.intervals[0].unreferenced, true);
  assert.equal(updater.checkCount, 0);
  timers.timeouts[0].callback();
  await flush();
  timers.intervals[0].callback();
  await flush();
  assert.equal(updater.checkCount, 2);
  assert.equal(controller.getState().status, 'up-to-date');
  controller.dispose();
  assert.equal(timers.intervals[0].cleared, true);
});

void test('overlapping manual checks share one operation and do not duplicate a background download', async () => {
  const { updater, controller } = fixture();
  const checkResult = deferred(), download = deferred();
  updater.checkForUpdates = () => { updater.checkCount += 1; return checkResult.promise; };
  const first = controller.check(), second = controller.check();
  assert.equal(first, second);
  await flush();
  assert.equal(updater.checkCount, 1);
  updater.emit('update-available', { version: nextVersion });
  checkResult.resolve({ downloadPromise: download.promise });
  assert.equal((await first).status, 'downloading');
  assert.equal((await controller.check()).status, 'downloading');
  assert.equal(updater.checkCount, 1);
  updater.emit('update-downloaded', { version: nextVersion });
  download.resolve(['/private/synthetic/update.zip']);
  await flush();
  assert.equal((await controller.check()).status, 'downloaded');
  assert.equal(updater.checkCount, 1);
  controller.dispose();
});

void test('checking subscribers cannot trigger a second simultaneous request', async () => {
  const { controller, updater } = fixture();
  let observed;
  controller.subscribe(value => { if (value.status === 'checking') observed = controller.check(); });
  const checking = controller.check();
  assert.equal(observed, checking);
  await checking;
  assert.equal(updater.checkCount, 1);
  controller.dispose();
});

void test('event state exposes only finite clamped progress, version and predefined messages', () => {
  const { updater, controller } = fixture();
  const states = [];
  controller.subscribe(value => states.push(value));
  controller.subscribe(() => { throw new Error('Broken UI observer'); });
  updater.emit('update-available', { version: nextVersion, path: '/private/secret', releaseNotes: 'synthetic-secret' });
  updater.emit('download-progress', { percent: -1, token: 'synthetic-secret' });
  assert.equal(controller.getState().progress, 0);
  updater.emit('download-progress', { percent: 101 });
  assert.equal(controller.getState().progress, 100);
  updater.emit('download-progress', { percent: NaN });
  assert.equal(controller.getState().progress, undefined);
  updater.emit('update-downloaded', { version: nextVersion, downloadedFile: '/private/secret' });
  assert.deepEqual(controller.getState(), { status: 'downloaded', currentVersion: '0.1.2', message: UPDATE_MESSAGES.downloaded, version: nextVersion, progress: 100 });
  assert.equal(states.every(isUpdateState), true);
  assert.equal(JSON.stringify(states).includes('secret'), false);
  assert.equal(Object.isFrozen(controller.getState()), true);
  controller.dispose();
});

void test('resolved download paths do not substitute for a verified downloaded event', async () => {
  const { controller, updater } = fixture();
  updater.checkForUpdates = async () => {
    updater.emit('update-available', { version: nextVersion });
    return { downloadPromise: Promise.resolve(['/private/synthetic/update.zip']) };
  };
  await controller.check();
  await flush();
  assert.equal(controller.getState().status, 'downloading');
  assert.equal(await controller.install(), false);
  assert.equal(updater.installCount, 0);
  controller.dispose();
});

void test('unsolicited or mismatched downloaded events cannot install an update', async () => {
  const { controller, updater } = fixture();
  updater.emit('update-downloaded', { version: nextVersion });
  assert.equal(controller.getState().status, 'idle');
  updater.emit('update-available', { version: nextVersion });
  updater.emit('update-downloaded', { version: '0.3.0' });
  assert.equal(controller.getState().status, 'error');
  assert.equal(await controller.install(), false);
  updater.emit('update-available', { version: 'https://private/token' });
  assert.equal(controller.getState().version, nextVersion);
  assert.equal(JSON.stringify(controller.getState()).includes('token'), false);
  controller.dispose();
});

void test('failed checks and downloads use safe errors and can be retried', async () => {
  const { controller, updater } = fixture();
  const error = new Error('https://user:secret@example.test/?token=secret /private/user/data');
  updater.checkForUpdates = () => { updater.checkCount += 1; throw error; };
  assert.equal((await controller.check()).status, 'error');
  assert.equal(controller.getState().message, UPDATE_MESSAGES.error);
  assert.equal(JSON.stringify(controller.getState()).includes('secret'), false);
  updater.checkForUpdates = async () => {
    updater.checkCount += 1;
    updater.emit('update-available', { version: nextVersion });
    return { downloadPromise: Promise.reject(error) };
  };
  await controller.check();
  await flush();
  assert.equal(controller.getState().status, 'error');
  updater.checkForUpdates = async () => {
    updater.checkCount += 1;
    updater.emit('update-not-available');
    return { isUpdateAvailable: false };
  };
  assert.equal((await controller.check()).status, 'up-to-date');
  assert.equal(updater.checkCount, 3);
  controller.dispose();
});

void test('native checksum or signing errors invalidate downloaded readiness', async () => {
  const { controller, updater } = fixture();
  downloaded(updater);
  updater.emit('error', new Error('Signing failed at /private/user/secret.zip'));
  assert.equal(controller.getState().status, 'error');
  assert.equal(await controller.install(), false);
  assert.equal(updater.installCount, 0);
  controller.dispose();
});

void test('installation awaits a single explicit successful save gate', async () => {
  const saved = deferred();
  let gateCount = 0;
  const { controller, updater } = fixture({ onBeforeInstall: () => { gateCount += 1; return saved.promise; } });
  downloaded(updater);
  const first = controller.install(), second = controller.install();
  assert.equal(first, second);
  await flush();
  assert.equal(gateCount, 1);
  assert.equal(updater.installCount, 0);
  assert.equal(controller.getState().status, 'installing');
  saved.resolve(true);
  assert.equal(await first, true);
  assert.equal(updater.installCount, 1);
  assert.deepEqual(updater.installArguments, [[]], 'stable Mac keeps its original native staging call');
  assert.equal(await controller.install(), false);
  controller.dispose();
});

void test('save rejection, missing gate, exception or truthy nonboolean keeps the app open and permits retry', async () => {
  for (const onBeforeInstall of [undefined, () => false, () => 'yes', () => { throw new Error('private path secret'); }]) {
    const { controller, updater } = fixture({ onBeforeInstall });
    downloaded(updater);
    assert.equal(await controller.install(), false);
    assert.equal(controller.getState().status, 'downloaded');
    assert.equal(controller.getState().message, UPDATE_MESSAGES.saveFailed);
    assert.equal(updater.installCount, 0);
    assert.equal(await controller.install(), false);
    controller.dispose();
  }
  let saved = false;
  const { controller, updater } = fixture({ onBeforeInstall: () => saved });
  downloaded(updater);
  assert.equal(await controller.install(), false);
  saved = true;
  assert.equal(await controller.install(), true);
  assert.equal(updater.installCount, 1);
  controller.dispose();
});

void test('synchronous install failure remains downloaded for retry without exposing native errors', async () => {
  const { controller, updater } = fixture();
  downloaded(updater);
  updater.quitAndInstall = () => { throw new Error('/private/user/secret'); };
  assert.equal(await controller.install(), false);
  assert.equal(controller.getState().status, 'downloaded');
  assert.equal(controller.getState().message, UPDATE_MESSAGES.installFailed);
  assert.equal(JSON.stringify(controller.getState()).includes('secret'), false);
  updater.quitAndInstall = () => { updater.installCount += 1; };
  assert.equal(await controller.install(), true);
  controller.dispose();
});

void test('later native install errors report safe failure and reject further installation until checked again', async () => {
  const { controller, updater } = fixture();
  downloaded(updater);
  assert.equal(await controller.install(), true);
  updater.emit('error', new Error('native signature failure /private/secret'));
  assert.equal(controller.getState().status, 'error');
  assert.equal(controller.getState().message, UPDATE_MESSAGES.installFailed);
  assert.equal(await controller.install(), false);
  assert.equal((await controller.check()).status, 'up-to-date');
  controller.dispose();
});

void test('a native failure during the save gate cannot still trigger installation', async () => {
  const saved = deferred();
  const { controller, updater } = fixture({ onBeforeInstall: () => saved.promise });
  downloaded(updater);
  const installing = controller.install();
  await flush();
  updater.emit('error', new Error('checksum failure'));
  saved.resolve(true);
  assert.equal(await installing, false);
  assert.equal(updater.installCount, 0);
  controller.dispose();
});

void test('disposing removes only owned listeners and timers and suppresses late operations', async () => {
  const saved = deferred();
  const { controller, updater, timers } = fixture({ onBeforeInstall: () => saved.promise });
  controller.start();
  const events = [], unsubscribe = controller.subscribe(value => events.push(value));
  downloaded(updater);
  unsubscribe();
  updater.emit('download-progress', { percent: 55 });
  const count = events.length;
  const installing = controller.install();
  await flush();
  const snapshot = controller.getState();
  controller.dispose();
  controller.dispose();
  assert.equal(timers.timeouts[0].cleared && timers.intervals[0].cleared, true);
  assert.equal(updater.listenerCount('error'), 1);
  assert.equal(updater.listenerCount('update-downloaded'), 0);
  updater.emit('error', new Error('late secret'));
  updater.emit('update-downloaded', { version: '0.3.0' });
  saved.resolve(true);
  assert.equal(await installing, false);
  assert.equal(updater.installCount, 0);
  assert.equal(events.length, count);
  assert.deepEqual(controller.getState(), snapshot);
  assert.deepEqual(await controller.check(), snapshot);
});

void test('download rejections after disposal remain handled without renderer changes', async () => {
  const checkResult = deferred(), download = deferred();
  const { controller, updater } = fixture();
  updater.checkForUpdates = () => checkResult.promise;
  const checking = controller.check();
  await flush();
  controller.dispose();
  const snapshot = controller.getState();
  checkResult.resolve({ downloadPromise: download.promise });
  await checking;
  download.reject(new Error('late private error'));
  await flush();
  assert.deepEqual(controller.getState(), snapshot);
});

void test('IPC validators reject arbitrary controls and unexpected state fields', () => {
  for (const valid of [undefined, {}, Object.create(null)]) assert.equal(isUpdateRequest(valid), true);
  for (const invalid of [null, [], 'check', { url: feed.url }, { channel: 'beta' }, { silently: true }]) assert.equal(isUpdateRequest(invalid), false);
  const valid = { status: 'downloading', currentVersion: '0.1.2', version: nextVersion, progress: 50, message: UPDATE_MESSAGES.downloading };
  assert.equal(isUpdateState(valid), true);
  for (const invalid of [
    { ...valid, status: 'custom-error' }, { ...valid, version: '/private/secret' },
    { ...valid, message: 'private secret' }, { ...valid, progress: Infinity },
    { ...valid, progress: 101 }, { ...valid, token: 'secret' }, { ...valid, path: '/private/secret' },
  ]) assert.equal(isUpdateState(invalid), false);
});
