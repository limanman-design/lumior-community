import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const security = require('../desktop/runtime/security.cjs');
const updateRuntime = require('../desktop/runtime/updates.cjs');
const desktopDirectory = fileURLToPath(new URL('../desktop/', import.meta.url));
const [mainSource, preloadSource] = await Promise.all([
  readFile(path.join(desktopDirectory, 'main.cjs'), 'utf8'),
  readFile(path.join(desktopDirectory, 'preload.cjs'), 'utf8'),
]);
const feed = { provider: 'generic', url: 'https://updates.example.test/lumior/stable/' };
const flush = async () => { for (let i = 0; i < 4; i += 1) await new Promise(resolve => setImmediate(resolve)); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function cancellableEvent() {
  return { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
}

// Execute the actual entry and preload with synthetic services and an actual
// update controller. No Electron process, filesystem profile, or network is used.
async function launchMain({ platform = 'darwin', packaged = true, development = false, configured = true, channel, distribution = 'official',
  version = '0.1.2', buildConfig = feed, closeAnswer = { response: 0, checkboxChecked: false } } = {}) {
  const timers = [], windows = [], writes = [], dialogs = [];
  const stored = new Map();
  const makeTimer = (callback, delay, repeating) => {
    const timer = { callback, delay, repeating, active: true, unref() {} };
    timers.push(timer);
    return timer;
  };
  const clock = {
    setTimeout: (callback, delay) => makeTimer(callback, delay, false),
    setInterval: (callback, delay) => makeTimer(callback, delay, true),
    clearTimeout: timer => { timer.active = false; },
    clearInterval: timer => { timer.active = false; },
  };
  const ipcMain = new EventEmitter();
  ipcMain.handlers = new Map();
  ipcMain.handle = (channel, callback) => ipcMain.handlers.set(channel, callback);
  const nativeUpdater = new EventEmitter();
  const sdk = new EventEmitter();
  sdk.on('error', () => {});
  sdk.installCount = 0;
  sdk.installArguments = [];
  sdk.checkCount = 0;
  sdk.setFeedURL = () => {};
  sdk.quitAndInstall = (...args) => { sdk.installCount += 1; sdk.installArguments.push(args); };
  sdk.checkForUpdates = async () => { sdk.checkCount += 1; sdk.emit('update-not-available'); return {}; };
  let controller, backend, saveCalls = 0, saveHandler = async () => {};
  const serviceReads = { trial: 0, updates: 0 };
  const petController = { enabled: false, size: 100, opened: 0, frozen: false, prepare: async () => {},
    subscribe() {}, init: async () => {}, dispose: async () => {},
    getState() { return { supported: true, enabled: this.enabled, size: this.size }; },
    async setSize(size) { this.size = size; return this.getState(); },
    async setAnimation(value) { this.animation = value; return this.getState(); },
    blink() { this.blinked = true; },
    async openEditor() { this.opened++; },
    async setEnabled(enabled) { this.enabled = enabled; return this.getState(); },
    async prepareQuit() { this.frozen = true; await this.prepare(); },
    resume() { this.frozen = false; },
  };

  class FakeApp extends EventEmitter {
    constructor() { super(); this.isPackaged = packaged; this.paths = {}; this.quitAttempts = 0; this.exited = false; this.dock = { setIcon() {} }; }
    setName(value) { this.name = value; }
    setAppUserModelId(value) { this.appId = value; }
    setPath(key, value) { this.paths[key] = value; }
    getPath(key) { return this.paths[key] || `/synthetic/${key}`; }
    getVersion() { return version; }
    getPreferredSystemLanguages() { return ['zh-Hans-CN', 'en-US']; }
    getLocaleCountryCode() { return 'CN'; }
    requestSingleInstanceLock() { return true; }
    whenReady() { return Promise.resolve(); }
    exit(code) { this.exited = true; this.exitCode = code; }
    quit() {
      this.quitAttempts += 1;
      const event = cancellableEvent();
      this.emit('before-quit', event);
      if (event.defaultPrevented) return false;
      for (const current of windows.filter(candidate => !candidate.destroyed)) current.close();
      if (windows.some(current => !current.destroyed)) return false;
      this.exited = true;
      this.emit('quit');
      return true;
    }
  }
  const app = new FakeApp();
  const nativeTheme = { themeSource: 'system' };

  class FakeBackend extends EventEmitter {
    constructor() { super(); this.pid = 42; this.live = true; this.messages = []; this.killCount = 0; }
    postMessage(message) {
      this.messages.push(message);
      if (message.type === 'ai-settings') queueMicrotask(() => this.emit('message', { type: 'settings-applied', requestId: message.requestId }));
    }
    kill() { this.killCount += 1; this.finish(); }
    finish() { if (this.live) { this.live = false; this.emit('exit', 0); } }
  }
  class FakeContents extends EventEmitter {
    constructor(current) { super(); this.current = current; this.id = windows.length + 1; this.url = ''; this.mainFrame = { url: '' }; this.messages = []; }
    getURL() { return this.url; }
    isDestroyed() { return this.current.destroyed; }
    send(channel, ...args) { this.messages.push({ channel, args }); this.renderer.emit(channel, {}, ...args); }
    setWindowOpenHandler(handler) { this.openHandler = handler; }
  }
  class FakeWindow extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.destroyed = false; this.visible = false;
      this.themeSourceAtCreation = nativeTheme.themeSource;
      this.webContents = new FakeContents(this);
      this.body = { inert: false, isConnected: true };
      const renderer = new EventEmitter();
      this.webContents.renderer = renderer;
      renderer.invoke = (channel, ...args) => ipcMain.handlers.get(channel)(this.authorizedEvent(), ...args);
      renderer.send = (channel, data) => ipcMain.emit(channel, this.authorizedEvent(), data);
      const preloadContext = vm.createContext({
        require: () => ({ contextBridge: { exposeInMainWorld: (_name, bridge) => { this.bridge = bridge; } }, ipcRenderer: renderer }),
        process: { platform }, document: { body: this.body },
      });
      vm.runInContext(preloadSource, preloadContext, { filename: 'desktop/preload.cjs' });
      this.bridge.onBeforeClose(async () => { saveCalls += 1; await saveHandler(); });
      windows.push(this);
    }
    authorizedEvent() { return { sender: this.webContents, senderFrame: this.webContents.mainFrame }; }
    isDestroyed() { return this.destroyed; }
    isFocused() { return this.visible; }
    isMinimized() { return false; }
    isMaximized() { return this.maximized ?? false; }
    isFullScreen() { return this.fullscreen ?? false; }
    restore() {}
    focus() {}
    show() { this.visible = true; }
    hide() { this.visible = false; }
    maximize() { this.maximized = true; this.emit('maximize'); }
    unmaximize() { this.maximized = false; this.emit('unmaximize'); }
    setFullScreen(value) { this.fullscreen = value; this.emit(value ? 'enter-full-screen' : 'leave-full-screen'); }
    minimize() { this.minimized = true; }
    setMenuBarVisibility(visible) { this.menuBarVisible = visible; }
    getContentSize() { return [1440, 940]; }
    setTitle() {}
    getNormalBounds() { return { width: 1440, height: 940 }; }
    async loadURL(url) { this.webContents.url = url; this.webContents.mainFrame.url = url; this.emit('ready-to-show'); }
    close() {
      if (this.destroyed) return;
      const event = cancellableEvent();
      this.emit('close', event);
      if (event.defaultPrevented) return;
      this.destroyed = true;
      this.body.isConnected = false;
      this.emit('closed');
      if (windows.every(current => current.destroyed)) app.emit('window-all-closed');
    }
  }
  const fakeSession = new EventEmitter();
  fakeSession.setPermissionRequestHandler = () => {};
  fakeSession.setPermissionCheckHandler = () => {};
  fakeSession.webRequest = { onBeforeSendHeaders() {} };
  const electron = {
    app, BrowserWindow: FakeWindow, ipcMain, autoUpdater: nativeUpdater, nativeTheme,
    clipboard: { read: async () => [] },
    Menu: { buildFromTemplate: value => ({ items: value, getMenuItemById: id => value.find(item => item.id === id) ? { submenu: { popup: options => { dialogs.push({ menu: id, ...options }); options.callback(); } } } : undefined }), setApplicationMenu() {} },
    session: { fromPartition: () => fakeSession }, shell: { openExternal: async () => {} },
    dialog: { showErrorBox: (...args) => dialogs.push(args), showMessageBox: async (...args) => { dialogs.push(args); return typeof closeAnswer === 'function' ? closeAnswer() : closeAnswer; } },
    safeStorage: {}, utilityProcess: { fork: (_filename, _args, options) => { backend = new FakeBackend(); backend.environment = options.env; queueMicrotask(() => backend.emit('message', { type: 'ready' })); return backend; } },
  };
  const environment = { LUMIOR_DESKTOP_DEV: development ? '1' : '0' };
  const mainRequire = name => {
    if (name === 'electron') return electron;
    if (name === './package.json') return { lumiorChannel: channel, lumiorDistribution: distribution };
    if (name === './runtime/distribution.cjs') return require('../desktop/runtime/distribution.cjs');
    if (name === './runtime/app-identity.cjs') return require('../desktop/runtime/app-identity.cjs');
    if (name === './runtime/window-preferences.cjs') return require('../desktop/runtime/window-preferences.cjs');
    if (name === './runtime/window-appearance.cjs') return require('../desktop/runtime/window-appearance.cjs');
    if (name === './runtime/clipboard-images.cjs') return require('../desktop/runtime/clipboard-images.cjs');
    if (name === 'node:os') return { release: () => platform === 'win32' ? '10.0.22621' : '25.0.0' };
    if (name === './runtime/desktop-pet.cjs') return { createDesktopPet: () => petController };
    if (name === 'node:fs/promises') return { access: async () => {}, mkdir: async () => {}, rename: async (from, to) => { stored.set(to, stored.get(from)); stored.delete(from); }, readFile: async file => { if (stored.has(file)) return stored.get(file); throw new Error('No synthetic state'); }, writeFile: async (...args) => { writes.push(args); stored.set(args[0], args[1]); } };
    if (name === './runtime/security.cjs') return { ...security, desktopConfiguration: (isPackaged, _environment, selectedDistribution) => security.desktopConfiguration(isPackaged, environment, selectedDistribution) };
    if (name === './runtime/credentials.cjs') return { createCredentialStore: () => ({ get: async () => ({ configured: false }), config: async () => ({ key: '', model: 'synthetic-model' }), save: async () => ({ configured: false }) }) };
    if (name === './runtime/trial-access.cjs') return { readTrialService: async () => { serviceReads.trial++; return ''; }, isolatedTrialTest: () => false };
    if (name === './runtime/updates.cjs') return { ...updateRuntime, createUpdateController: options => { controller = updateRuntime.createUpdateController({ ...options, timers: clock }); return controller; } };
    if (name === './runtime/update-build.cjs') return { readUpdateBuild: async () => { serviceReads.updates++; return configured ? buildConfig : undefined; } };
    // Wallpaper has its own controller tests; keep these save/update cases isolated.
    if (name === './runtime/star-wallpaper.cjs') return { createStarWallpaper: () => ({
      subscribe: () => () => {}, init: async () => {}, dispose: async () => {},
      getState: () => ({ supported: false, enabled: false, scene: 'galaxy', paused: false }),
    }) };
    if (name === 'node:module') return { createRequire: () => () => ({ load: JSON.parse, JSON_SCHEMA: {} }) };
    if (name === 'electron-updater') return { autoUpdater: sdk };
    return require(name);
  };
  mainRequire.resolve = name => name === 'electron-updater' ? '/synthetic/electron-updater/index.js' : require.resolve(name);
  const context = vm.createContext({
    require: mainRequire, __dirname: desktopDirectory,
    process: { platform, arch: platform === 'win32' ? 'x64' : 'arm64', env: environment, resourcesPath: '/synthetic/resources', stdout: { write() {} }, stderr: { write() {} } },
    console, ...clock,
  });
  vm.runInContext(mainSource, context, { filename: 'desktop/main.cjs' });
  await flush();
  assert.equal(windows.length, 1, 'synthetic main starts one window');
  assert.equal(backend.live, true);
  return {
    app, sdk, nativeUpdater, ipcMain, windows, backend, controller, petController, dialogs, writes, serviceReads,
    get current() { return windows.at(-1); },
    get saveCalls() { return saveCalls; },
    setSaveHandler(handler) { saveHandler = handler; },
    downloaded(version = '0.2.0') { sdk.emit('update-available', { version }); sdk.emit('update-downloaded', { version }); },
    snapshot: () => vm.runInContext('({ quitting, preparingQuit, updateAttempt, updatePrepared, nativeUpdateQuit, hasBackend: !!backend, hasWindow: !!window })', context),
    nativeFinish() {
      nativeUpdater.emit('before-quit-for-update');
      for (const current of windows.filter(candidate => !candidate.destroyed)) current.close();
      app.quit();
    },
    timeout(delay) { for (const timer of timers.filter(candidate => candidate.active && candidate.delay === delay)) { if (!timer.repeating) timer.active = false; timer.callback(); } },
    dispose() { controller.dispose(); for (const timer of timers) timer.active = false; },
  };
}

void test('community main ignores official services and update feeds even when they are present', async () => {
  for (const platform of ['darwin', 'win32']) {
    const main = await launchMain({ platform, distribution: 'community', configured: true });
    try {
      assert.equal(main.app.name, 'Lumior Community');
      assert.equal(main.app.paths.userData, '/synthetic/appData/Lumior Community');
      assert.equal(new URL(main.current.webContents.getURL()).port, '43173');
      assert.equal(main.backend.environment.LUMIOR_DESKTOP_DISTRIBUTION, 'community');
      assert.equal(security.desktopConfiguration(true, main.backend.environment, main.backend.environment.LUMIOR_DESKTOP_DISTRIBUTION).port, 43173);
      assert.deepEqual(main.serviceReads, { trial: 0, updates: 0 });
      assert.equal(main.controller.getState().status, 'disabled');
      await main.controller.check();
      assert.equal(main.sdk.checkCount, 0);
      assert.equal(main.backend.live, true);
    } finally { main.dispose(); }
  }
});

void test('fixed dark application palette sets native appearance before creating resizable windows', async () => {
  for (const platform of ['darwin', 'win32']) {
    const main = await launchMain({ platform });
    try {
      assert.equal(main.current.themeSourceAtCreation, 'dark');
      assert.equal(main.current.options.transparent, undefined);
      assert.notEqual(main.current.options.resizable, false);
      if (platform === 'darwin') assert.equal(main.current.options.vibrancy, 'under-window');
      else assert.equal(main.current.options.backgroundMaterial, 'acrylic');
    } finally { main.dispose(); }
  }
});

void test('production normal quit waits for renderer save and then backend exit', async () => {
  const main = await launchMain({ configured: false });
  const saved = deferred();
  main.setSaveHandler(() => saved.promise);
  main.app.quit();
  await flush();
  assert.equal(main.saveCalls, 1);
  assert.equal(main.current.body.inert, true);
  assert.equal(main.backend.messages.some(message => message.type === 'shutdown'), false);
  assert.equal(main.app.exited, false);
  saved.resolve();
  await flush();
  assert.equal(main.backend.messages.filter(message => message.type === 'shutdown').length, 1);
  assert.equal(main.app.exited, false);
  main.backend.finish();
  await flush();
  assert.equal(main.app.exited, true);
  assert.equal(main.current.destroyed, true);
  main.dispose();
});

void test('failed production quit saves nothing further and restores editing for retry', async () => {
  const main = await launchMain({ configured: false });
  main.setSaveHandler(async () => { throw new Error('synthetic disk failure'); });
  main.app.quit();
  await flush();
  assert.equal(main.current.destroyed, false);
  assert.equal(main.current.body.inert, false);
  assert.equal(main.backend.live, true);
  assert.equal(main.backend.messages.some(message => message.type === 'shutdown'), false);
  assert.equal(main.snapshot().preparingQuit, false);
  assert.equal(main.dialogs.length, 1);
  main.setSaveHandler(async () => {});
  main.app.quit();
  await flush();
  main.backend.finish();
  await flush(); // Native quit also waits for wallpaper preference writes to finish.
  assert.equal(main.app.exited, true);
  main.dispose();
});

void test('repeated quit requests cannot bypass an in-progress backend shutdown', async () => {
  const main = await launchMain({ configured: false });
  main.app.quit();
  await flush();
  assert.equal(main.backend.messages.filter(message => message.type === 'shutdown').length, 1);
  assert.equal(main.backend.live, true);
  main.app.quit();
  await flush();
  assert.equal(main.app.exited, false, 'backend is still shutting down');
  assert.equal(main.current.destroyed, false);
  assert.equal(main.backend.messages.filter(message => message.type === 'shutdown').length, 1);
  main.backend.finish();
  await flush();
  assert.equal(main.app.exited, true);
  main.dispose();
});

void test('macOS red close saves production workspace without installing a downloaded update', async () => {
  const main = await launchMain();
  main.downloaded();
  main.current.close();
  await flush();
  assert.equal(main.saveCalls, 1);
  assert.equal(main.current.destroyed, true);
  assert.equal(main.sdk.installCount, 0);
  assert.equal(main.backend.live, true);
  assert.equal(main.backend.messages.some(message => message.type === 'shutdown'), false);
  assert.equal(main.app.exited, false);
  main.app.emit('activate');
  await flush();
  assert.equal(main.windows.length, 2);
  assert.equal(main.current.destroyed, false);
  assert.equal(main.current.body.inert, false);
  main.dispose();
});

void test('macOS red close save failure retains the current window and permits retry', async () => {
  const main = await launchMain();
  main.setSaveHandler(async () => { throw new Error('synthetic save error'); });
  main.current.close();
  await flush();
  assert.equal(main.current.destroyed, false);
  assert.equal(main.current.body.inert, false);
  assert.equal(main.dialogs.length, 1);
  assert.equal(main.backend.live, true);
  main.setSaveHandler(async () => {});
  main.current.close();
  await flush();
  assert.equal(main.current.destroyed, true);
  main.dispose();
});

void test('normal macOS quit installs only after saving and keeps backend alive during native staging', async () => {
  const main = await launchMain();
  main.downloaded();
  const saved = deferred();
  main.setSaveHandler(() => saved.promise);
  main.app.quit();
  await flush();
  assert.equal(main.controller.getState().status, 'installing');
  assert.equal(main.sdk.installCount, 0);
  assert.equal(main.backend.live, true);
  saved.resolve();
  await flush();
  assert.equal(main.sdk.installCount, 1);
  assert.equal(main.current.destroyed, false);
  assert.equal(main.backend.messages.some(message => message.type === 'shutdown'), false);
  assert.equal(main.snapshot().updatePrepared, true);
  main.current.close();
  main.app.quit();
  await flush();
  assert.equal(main.current.destroyed, false, 'ordinary close cannot interrupt native staging');
  assert.equal(main.backend.live, true);
  main.nativeFinish();
  await flush();
  assert.equal(main.current.destroyed, true, 'native event authorizes saved window close');
  assert.equal(main.backend.messages.filter(message => message.type === 'shutdown').length, 1);
  assert.equal(main.app.exited, false);
  main.backend.finish();
  await flush();
  assert.equal(main.app.exited, true);
  main.dispose();
});

void test('Windows close saves first and the SDK native quit event still waits for backend shutdown', async () => {
  const main = await launchMain({ platform: 'win32' });
  main.downloaded();
  // BaseUpdater emits this Electron event immediately before app.quit().
  main.sdk.quitAndInstall = () => {
    main.sdk.installCount += 1;
    main.nativeUpdater.emit('before-quit-for-update');
    main.app.quit();
  };
  main.current.close();
  await flush();
  assert.equal(main.saveCalls, 1);
  assert.equal(main.current.destroyed, false, 'exit keeps the window alive until backend shutdown completes');
  assert.equal(main.sdk.installCount, 1);
  assert.equal(main.backend.messages.filter(message => message.type === 'shutdown').length, 1);
  assert.equal(main.backend.live, true);
  assert.equal(main.app.exited, false);
  main.backend.finish();
  await flush();
  assert.equal(main.app.exited, true);
  main.dispose();
});

void test('Windows preview uses its own profile and taskbar identity, and closes without updating', async () => {
  const main = await launchMain({ platform: 'win32', channel: 'windows-preview', configured: false });
  assert.equal(main.app.name, 'Lumior Preview');
  assert.equal(main.app.appId, 'app.lumior.desktop.windows-preview');
  assert.equal(main.app.paths.userData, path.join('/synthetic/appData', 'Lumior Windows Preview'));
  main.current.close();
  await flush();
  assert.equal(main.saveCalls, 1);
  assert.equal(main.sdk.checkCount, 0);
  assert.equal(main.sdk.installCount, 0);
  main.backend.finish();
  await flush();
  assert.equal(main.app.exited, true);
  main.dispose();
});

void test('configured Windows preview keeps its existing profile while saving before its update restart', async () => {
  const main = await launchMain({ platform: 'win32', channel: 'windows-preview', version: '0.1.34-win.2',
    buildConfig: { provider: 'generic', url: 'https://updates.example.test/windows/x64/', channel: 'windows-preview' },
  });
  try {
    assert.equal(main.app.name, 'Lumior Preview');
    assert.equal(main.app.appId, 'app.lumior.desktop.windows-preview');
    assert.equal(main.app.paths.userData, path.join('/synthetic/appData', 'Lumior Windows Preview'));
    assert.equal((await main.controller.check()).status, 'up-to-date');
    assert.equal(main.sdk.checkCount, 1);
    const saved = deferred();
    main.setSaveHandler(() => saved.promise);
    main.downloaded('0.1.34-win.3');
    const installation = main.current.bridge.installUpdate();
    await flush();
    assert.equal(main.saveCalls, 1);
    assert.equal(main.sdk.installCount, 0);
    assert.equal(main.current.destroyed, false);
    assert.equal(main.backend.live, true);
    saved.resolve();
    assert.equal((await installation).status, 'installing');
    assert.equal(main.sdk.installCount, 1);
    assert.deepEqual(main.sdk.installArguments, [[true, true]]);
    assert.equal(main.backend.messages.some(message => message.type === 'shutdown'), false);
    main.nativeFinish();
    await flush();
    assert.equal(main.backend.messages.filter(message => message.type === 'shutdown').length, 1);
    assert.equal(main.app.exited, false);
    main.backend.finish();
    await flush();
    assert.equal(main.app.exited, true);
  } finally { main.dispose(); }
});

void test('backend shutdown timeout terminates the service once before allowing final quit', async () => {
  const main = await launchMain({ configured: false });
  main.app.quit();
  await flush();
  assert.equal(main.app.exited, false);
  main.timeout(4500);
  await flush();
  assert.equal(main.backend.killCount, 1);
  assert.equal(main.backend.live, false);
  assert.equal(main.app.exited, true);
  main.dispose();
});

void test('async native installation error preserves backend and restores editing', async () => {
  const main = await launchMain();
  main.downloaded();
  await main.current.bridge.installUpdate();
  assert.equal(main.sdk.installCount, 1);
  assert.equal(main.current.body.inert, true);
  main.sdk.emit('error', new Error('synthetic signature error /private/secret'));
  await flush();
  assert.equal(main.controller.getState().status, 'error');
  assert.equal(main.current.body.inert, false);
  assert.equal(main.current.destroyed, false);
  assert.equal(main.backend.live, true);
  assert.equal(main.backend.messages.some(message => message.type === 'shutdown'), false);
  assert.equal(main.snapshot().preparingQuit, false);
  assert.equal(main.snapshot().updatePrepared, false);
  assert.equal(main.snapshot().nativeUpdateQuit, false);
  assert.equal(JSON.stringify(main.current.webContents.messages).includes('secret'), false);
  assert.equal((await main.current.bridge.checkForUpdates()).status, 'up-to-date');
  main.dispose();
});

void test('a window close interrupted by update staging must save again after installation failure', async () => {
  const main = await launchMain();
  main.downloaded();
  const saved = deferred();
  main.setSaveHandler(() => saved.promise);
  main.current.close();
  await flush();
  main.app.quit();
  await flush();
  assert.equal(main.saveCalls, 1, 'simultaneous close and install share the pending save gate');
  saved.resolve();
  await flush();
  assert.equal(main.current.destroyed, false);
  assert.equal(main.sdk.installCount, 1);
  main.sdk.emit('error', new Error('synthetic native failure'));
  await flush();
  assert.equal(main.current.body.inert, false);
  main.setSaveHandler(async () => {});
  main.current.close();
  await flush();
  assert.equal(main.saveCalls, 2, 'new edits after failed install need a fresh save gate');
  assert.equal(main.current.destroyed, true);
  main.dispose();
});

void test('installation save failure resumes editing without native installation or backend shutdown', async () => {
  const main = await launchMain();
  main.downloaded();
  main.setSaveHandler(async () => { throw new Error('synthetic failed save'); });
  main.app.quit();
  await flush();
  assert.equal(main.controller.getState().status, 'downloaded');
  assert.equal(main.controller.getState().message, updateRuntime.UPDATE_MESSAGES.saveFailed);
  assert.equal(main.current.body.inert, false);
  assert.equal(main.current.destroyed, false);
  assert.equal(main.sdk.installCount, 0);
  assert.equal(main.backend.live, true);
  assert.equal(main.snapshot().preparingQuit, false);
  main.dispose();
});

void test('two consecutive save gates restore the original editable state after update failure', async () => {
  const main = await launchMain();
  const firstSave = deferred();
  main.setSaveHandler(() => main.saveCalls === 1 ? firstSave.promise : Promise.resolve());
  main.app.quit();
  await flush();
  main.downloaded();
  firstSave.resolve();
  await flush();
  assert.equal(main.saveCalls, 2, 'update completing during ordinary quit requires the installation save gate');
  assert.equal(main.sdk.installCount, 1);
  main.sdk.emit('error', new Error('synthetic native failure'));
  await flush();
  assert.equal(main.current.body.inert, false);
  assert.equal(main.backend.live, true);
  main.dispose();
});

void test('close acknowledgement requires exact sender, main frame, origin and random request id', async () => {
  const main = await launchMain({ configured: false });
  const saved = deferred();
  main.setSaveHandler(() => saved.promise);
  main.app.quit();
  await flush();
  const requestId = main.current.webContents.messages.find(message => message.channel === 'lumior:prepare-close').args[0];
  const event = main.current.authorizedEvent();
  for (const [badEvent, badRequest] of [
    [{ ...event, sender: {} }, requestId],
    [{ ...event, senderFrame: { url: main.current.webContents.getURL() } }, requestId],
    [event, 'wrong-request'],
  ]) main.ipcMain.emit('lumior:close-ready', badEvent, { requestId: badRequest, saved: true });
  await flush();
  assert.equal(main.backend.messages.some(message => message.type === 'shutdown'), false);
  const correctUrl = event.senderFrame.url;
  event.senderFrame.url = 'https://external.example.test';
  main.ipcMain.emit('lumior:close-ready', event, { requestId, saved: true });
  event.senderFrame.url = correctUrl;
  await flush();
  assert.equal(main.backend.messages.some(message => message.type === 'shutdown'), false);
  saved.resolve();
  await flush();
  assert.equal(main.backend.messages.some(message => message.type === 'shutdown'), true);
  main.backend.finish();
  main.dispose();
});

void test('renderer save timeout preserves the app and resumes editing', async () => {
  const main = await launchMain({ configured: false });
  const saved = deferred();
  main.setSaveHandler(() => saved.promise);
  main.app.quit();
  await flush();
  main.timeout(10_000);
  await flush();
  assert.equal(main.app.exited, false);
  assert.equal(main.current.destroyed, false);
  assert.equal(main.current.body.inert, false);
  assert.equal(main.backend.live, true);
  assert.equal(main.snapshot().preparingQuit, false);
  saved.resolve();
  await flush();
  assert.equal(main.backend.messages.some(message => message.type === 'shutdown'), false, 'late save acknowledgements cannot revive expired requests');
  main.dispose();
});

void test('update IPC rejects subframes, external origins, extra arguments and renderer URL configuration', async () => {
  const main = await launchMain();
  const handler = main.ipcMain.handlers.get('lumior:update:check');
  const event = main.current.authorizedEvent();
  for (const [requestEvent, args] of [
    [{ ...event, sender: {} }, []], [{ ...event, senderFrame: { url: main.current.webContents.getURL() } }, []],
    [event, [{ url: feed.url }]], [event, [{ channel: 'beta' }]], [event, [undefined, 'extra']],
  ]) await assert.rejects(handler(requestEvent, ...args));
  const correctUrl = event.senderFrame.url;
  event.senderFrame.url = 'https://external.example.test';
  await assert.rejects(handler(event));
  event.senderFrame.url = correctUrl;
  assert.equal(main.sdk.checkCount, 0);
  assert.equal((await main.current.bridge.checkForUpdates()).status, 'up-to-date');
  assert.equal(main.sdk.checkCount, 1);
  main.dispose();
});

void test('native locale IPC exposes only OS preferences to the main app frame', async () => {
  const main = await launchMain();
  try {
    const handler = main.ipcMain.handlers.get('lumior:locale:get');
    const event = main.current.authorizedEvent();
    for (const invalid of [
      { ...event, sender: {} },
      { ...event, senderFrame: { url: event.senderFrame.url } },
      { ...event, senderFrame: { url: 'https://external.example.test' } },
    ]) assert.throws(() => handler(invalid), /only in Lumior/);
    assert.throws(() => handler(event, { region: 'US' }), /options are not accepted/);
    const correctUrl = event.senderFrame.url;
    event.senderFrame.url = 'https://external.example.test';
    assert.throws(() => handler(event), /only in Lumior/);
    event.senderFrame.url = correctUrl;
    const locale = await main.current.bridge.getSystemLocale();
    assert.deepEqual(JSON.parse(JSON.stringify(locale)), { languages: ['zh-Hans-CN', 'en-US'], region: 'CN' });
    assert.equal(main.backend.messages.some(message => message.type === 'locale'), false);
  } finally { main.dispose(); }
});

void test('clipboard image IPC accepts only the active app main frame and no caller paths', async () => {
  const main = await launchMain();
  try {
    const handler = main.ipcMain.handlers.get('lumior:clipboard:images');
    const event = main.current.authorizedEvent();
    for (const invalid of [
      { ...event, sender: {} },
      { ...event, senderFrame: { url: event.senderFrame.url } },
      { ...event, senderFrame: null },
    ]) assert.throws(() => handler(invalid), /only in Lumior/);
    assert.throws(() => handler(event, '/private/sensitive.png'), /options are not accepted/);
    const correctUrl = event.senderFrame.url;
    event.senderFrame.url = 'https://external.example.test';
    assert.throws(() => handler(event), /only in Lumior/);
    event.senderFrame.url = correctUrl;
    assert.deepEqual(await main.current.bridge.getClipboardImages(), []);
    main.current.hide();
    assert.throws(() => handler(event), /active Lumior window/);
  } finally { main.dispose(); }
});

void test('development preview and incomplete release keep the updater off through actual main', async () => {
  for (const options of [{ packaged: false, development: true }, { configured: false }]) {
    const main = await launchMain(options);
    const expected = options.development ? 'development' : 'disabled';
    assert.equal((await main.current.bridge.getUpdateState()).status, expected);
    assert.equal((await main.current.bridge.checkForUpdates()).status, expected);
    assert.equal((await main.current.bridge.installUpdate()).status, expected);
    assert.equal(main.sdk.checkCount + main.sdk.installCount, 0);
    main.dispose();
  }
});


void test('Windows close asks once while pending; remember-minimize keeps workspace editable; explicit quit saves', async () => {
  const answer = deferred();
  const main = await launchMain({ platform: 'win32', configured: false, closeAnswer: () => answer.promise });
  const current = main.current;
  assert.equal(current.options.titleBarStyle, 'hidden');
  assert.equal(current.options.titleBarOverlay, false);
  assert.equal(current.menuBarVisible, false);
  current.fullscreen = true;
  current.emit('enter-full-screen');
  assert.equal(current.webContents.messages.at(-1).channel, 'lumior:window:state');
  assert.equal(current.webContents.messages.at(-1).args[0].fullscreen, true);
  current.fullscreen = false;
  current.emit('leave-full-screen');
  assert.equal(current.webContents.messages.at(-1).args[0].fullscreen, false);
  current.close(); current.close();
  await flush();
  assert.equal(main.dialogs.length, 1);
  assert.equal(main.saveCalls, 0);
  answer.resolve({ response: 1, checkboxChecked: true });
  await flush();
  assert.equal(current.minimized, true);
  assert.equal(current.destroyed, false);
  assert.equal(current.body.inert, false);
  assert.equal(main.backend.live, true);
  assert.equal((await current.bridge.getWindowPreferences()).closeBehavior, 'minimize');
  current.close();
  await flush();
  assert.equal(main.dialogs.length, 1);
  assert.equal(main.saveCalls, 0);
  main.app.quit();
  await flush();
  assert.equal(main.saveCalls, 1);
  main.backend.finish();
  await flush();
  assert.equal(main.app.exited, true);
  main.dispose();
});

void test('Windows cancellation leaves the window untouched and a failed save permits retry', async () => {
  const main = await launchMain({ platform: 'win32', configured: false, closeAnswer: { response: 2, checkboxChecked: true } });
  main.current.close();
  await flush();
  assert.equal(main.saveCalls, 0);
  assert.equal(main.current.destroyed, false);
  assert.equal((await main.current.bridge.getWindowPreferences()).closeBehavior, 'ask');
  await main.current.bridge.setWindowCloseBehavior('quit');
  main.setSaveHandler(async () => { throw new Error('Unsaved'); });
  main.current.close();
  await flush();
  assert.equal(main.current.destroyed, false);
  assert.equal(main.current.body.inert, false);
  assert.equal(main.backend.live, true);
  main.setSaveHandler(async () => {});
  main.current.close();
  await flush();
  main.backend.finish();
  await flush();
  assert.equal(main.app.exited, true);
  main.dispose();
});

void test('window menu and preferences reject untrusted frames and invalid inputs, while native roles remain available', async () => {
  const main = await launchMain({ platform: 'win32', configured: false });
  const event = main.current.authorizedEvent();
  const popup = main.ipcMain.handlers.get('lumior:window:menu');
  for (const bad of [null, { menu: 'shell', x: 0, y: 0 }, { menu: 'file', x: NaN, y: 0 }, { menu: 'file', x: 0, y: 0, command: 'exit' }]) assert.throws(() => popup(event, bad));
  const child = { ...event, senderFrame: { url: event.senderFrame.url } };
  assert.throws(() => popup(child, { menu: 'file', x: 0, y: 0 }), /only in Lumior/);
  assert.throws(() => main.ipcMain.handlers.get('lumior:window:close-behavior')(child, 'quit'), /only in Lumior/);
  await assert.rejects(main.current.bridge.setWindowCloseBehavior('hide'));
  for (const menu of ['file', 'edit', 'view', 'window']) await main.current.bridge.openWindowMenu({ menu, x: 50, y: 34 });
  assert.deepEqual(main.dialogs.map(item => item.menu), ['file', 'edit', 'view', 'window']);
  main.dispose();
  const mac = await launchMain({ configured: false });
  assert.equal(mac.current.options.titleBarOverlay, undefined);
  assert.throws(() => mac.current.bridge.getWindowPreferences(), /Windows/);
  mac.dispose();
});

void test('custom caption actions maximize, restore, leave fullscreen, minimize and use the same close prompt', async () => {
  const main = await launchMain({ platform: 'win32', configured: false, closeAnswer: { response: 2, checkboxChecked: false } });
  const current = main.current;
  const states = [];
  const unsubscribe = current.bridge.onWindowState(state => states.push(state));
  assert.equal((await current.bridge.getWindowState()).maximized, false);
  await current.bridge.performWindowAction('toggle-maximize');
  assert.equal(current.isMaximized(), true);
  assert.equal(states.at(-1).maximized, true);
  await current.bridge.performWindowAction('toggle-maximize');
  assert.equal(current.isMaximized(), false);
  assert.equal(states.at(-1).maximized, false);
  current.setFullScreen(true);
  await current.bridge.performWindowAction('toggle-maximize');
  assert.equal(current.isFullScreen(), false);
  assert.equal(states.at(-1).fullscreen, false);
  await current.bridge.performWindowAction('minimize');
  assert.equal(current.minimized, true);
  assert.equal(main.saveCalls, 0);
  await current.bridge.performWindowAction('close');
  await flush();
  assert.equal(main.dialogs.length, 1);
  assert.equal(current.destroyed, false);
  assert.equal(main.saveCalls, 0);
  const action = main.ipcMain.handlers.get('lumior:window:action');
  const event = current.authorizedEvent();
  assert.throws(() => action(event, 'quit'), /Invalid window action/);
  assert.throws(() => action(event, 'close', {}), /Invalid window action/);
  assert.throws(() => action({ ...event, senderFrame: {} }, 'close'), /only in Lumior/);
  const count = states.length;
  unsubscribe();
  current.maximize();
  assert.equal(states.length, count);
  main.dispose();
});

void test('enabled pet keeps main renderer alive and editable when its window closes on Mac and Windows', async () => {
  for (const platform of ['darwin', 'win32']) {
    const main = await launchMain({ platform, configured: false });
    main.petController.enabled = true;
    main.current.close(); await flush();
    assert.equal(main.current.destroyed, false);
    assert.equal(main.current.visible, false);
    assert.equal(main.current.body.inert, false);
    assert.equal(main.saveCalls, 1);
    assert.equal(main.app.exited, false);
    main.app.quit(); await flush(); main.backend.finish(); await flush();
    assert.equal(main.app.exited, true);
    main.dispose();
  }
});
void test('failed pet draft flush blocks quit and restores editing, including the pet', async () => {
  const main = await launchMain({ configured: false });
  main.petController.prepare = async () => { throw new Error('Draft disk failure'); };
  main.app.quit(); await flush();
  assert.equal(main.app.exited, false); assert.equal(main.backend.live, true);
  assert.equal(main.snapshot().preparingQuit, false); assert.equal(main.petController.frozen, false);
  main.dispose();
});

void test('pet size and quick-note settings IPC reject other frames, invalid ranges and extra arguments', async () => {
  const main = await launchMain();
  try {
    const resize = main.ipcMain.handlers.get('lumior:pet:size'), open = main.ipcMain.handlers.get('lumior:pet:quick-note');
    const event = main.current.authorizedEvent();
    for (const size of [undefined, '150', 74, 301, 100.5, NaN]) assert.throws(() => resize(event, size));
    assert.throws(() => resize(event, 150, 'extra')); assert.throws(() => open(event, 'extra'));
    for (const invalid of [{ ...event, sender: {} }, { ...event, senderFrame: { url: event.senderFrame.url } }]) {
      assert.throws(() => resize(invalid, 150)); assert.throws(() => open(invalid));
    }
    assert.equal((await main.current.bridge.setPetSize(200)).size, 200);
    await main.current.bridge.openPetQuickNote(); assert.equal(main.petController.opened, 1);
    const animate = main.ipcMain.handlers.get('lumior:pet:animation'), blink = main.ipcMain.handlers.get('lumior:pet:blink');
    for (const invalid of [{ ...event, sender: {} }, { ...event, senderFrame: { url: event.senderFrame.url } }, { ...event, senderFrame: { url: 'https://example.com' } }]) {
      assert.throws(() => animate(invalid, {})); assert.throws(() => blink(invalid));
    }
    assert.throws(() => animate(event, {}, 'extra')); assert.throws(() => blink(event, 'extra'));
    await main.current.bridge.setPetAnimation({ breathAmp: 3 }); assert.equal(main.petController.animation.breathAmp, 3);
    await main.current.bridge.blinkPet(); assert.equal(main.petController.blinked, true);
  } finally { main.dispose(); }
});
