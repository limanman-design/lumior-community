import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { createStarWallpaper, WALLPAPER_CHANNELS } = require('../desktop/runtime/star-wallpaper.cjs');
const origin = 'http://127.0.0.1:43271', token = 'synthetic-wallpaper-token-'.repeat(3);

async function fixture(options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'lumior-wallpaper-test-'));
  const windows = [], sessions = [];
  let partitionSession;
  class Window extends EventEmitter {
    constructor(config) {
      super(); this.options = config; this.destroyed = false; this.shown = 0; this.boundUpdates = [];
      const own = partitionSession || new EventEmitter();
      partitionSession = own;
      own.webRequest = {
        onBeforeRequest: (filter, listener) => { own.beforeRequest = listener || null; own.requestFilter = filter; },
        onBeforeSendHeaders: (_filter, listener) => { own.beforeHeaders = listener || null; },
      };
      own.setPermissionRequestHandler = handler => { own.permissionRequest = handler; };
      own.setPermissionCheckHandler = handler => { own.permissionCheck = handler; };
      sessions.push(own);
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, { id: windows.length + 1, mainFrame: { url: `${origin}/wallpaper` }, session: own,
        isDestroyed: () => this.destroyed,
        send: (channel, state) => { this.lastState = { channel, state }; },
        setWindowOpenHandler: handler => { this.openHandler = handler; },
      });
      windows.push(this);
    }
    setIgnoreMouseEvents(value) { this.ignoreMouse = value; }
    setBounds(value) { this.bounds = { ...value }; this.boundUpdates.push({ ...value }); }
    loadURL(value) { this.url = value; return options.loadFailure ? Promise.reject(new Error('synthetic failure')) : Promise.resolve(); }
    showInactive() { this.shown++; }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.emit('closed'); }
  }
  const screen = new EventEmitter(); screen.bounds = { x: -320, y: 24, width: 1920, height: 1080 };
  screen.getPrimaryDisplay = () => ({ bounds: { ...screen.bounds }, workArea: { x: -320, y: 24, width: 1920, height: 1040 } });
  const powerMonitor = new EventEmitter(); powerMonitor.currentBattery = options.battery || false;
  powerMonitor.isOnBatteryPower = () => powerMonitor.currentBattery;
  powerMonitor.emit = function (name, ...args) {
    if (name === 'on-battery') this.currentBattery = true;
    if (name === 'on-ac') this.currentBattery = false;
    return EventEmitter.prototype.emit.call(this, name, ...args);
  };
  const controller = createStarWallpaper({ app: { getPath: name => { assert.equal(name, 'userData'); return directory; } },
    BrowserWindow: Window, screen, powerMonitor, platform: options.platform || 'darwin', config: { origin, token, development: options.development === true }, readyTimeoutMs: options.timeout || 250 });
  const event = window => ({ sender: window.webContents, senderFrame: window.webContents.mainFrame });
  async function enable() {
    const promise = controller.setEnabled(true);
    for (let i = 0; i < 30 && windows.length === 0; i++) await new Promise(resolve => setTimeout(resolve, 2));
    const current = windows.at(-1);
    assert.ok(current, 'The mock window must be created before ready.');
    assert.equal(controller.acceptReady(event(current), true), true);
    await promise;
    return current;
  }
  const cleanup = async () => { await controller.dispose(); await rm(directory, { recursive: true, force: true }); };
  return { directory, controller, windows, sessions, screen, powerMonitor, event, enable, cleanup };
}

void test('first launch is disabled and unsupported platforms create no window or preference', async () => {
  for (const platform of ['darwin', 'win32']) {
    const f = await fixture({ platform });
    try {
      const state = await f.controller.init();
      assert.deepEqual(state, { supported: platform === 'darwin', enabled: false, scene: 'galaxy', paused: false });
      assert.equal(f.windows.length, 0);
      assert.deepEqual(await readdir(f.directory), []);
      if (platform !== 'darwin') {
        await f.controller.setEnabled(true);
        await f.controller.setScene('shore');
        assert.equal(f.windows.length, 0);
        assert.deepEqual(await readdir(f.directory), []);
        assert.equal(f.powerMonitor.eventNames().length, 0);
      }
    } finally { await f.cleanup(); }
  }
});

void test('a hidden click-through desktop window becomes enabled only after its own main-frame ready', async () => {
  const f = await fixture();
  try {
    await f.controller.init();
    const start = f.controller.setEnabled(true);
    await new Promise(resolve => setTimeout(resolve, 2));
    const window = f.windows[0], config = window.options;
    assert.equal(f.controller.getState().enabled, false);
    assert.equal(window.shown, 0);
    assert.deepEqual({ x: config.x, y: config.y, width: config.width, height: config.height }, f.screen.bounds);
    for (const key of ['focusable', 'show', 'frame', 'resizable', 'movable', 'closable']) assert.equal(config[key], false);
    assert.equal(config.type, 'desktop'); assert.equal(config.skipTaskbar, true); assert.equal(window.ignoreMouse, true);
    assert.equal(config.enableLargerThanScreen, true); assert.deepEqual(window.boundUpdates, [f.screen.bounds]);
    assert.equal(config.webPreferences.partition, 'lumior-wallpaper');
    assert.equal(config.webPreferences.sandbox, true); assert.equal(config.webPreferences.contextIsolation, true);
    assert.equal(config.webPreferences.nodeIntegration, false); assert.equal(config.webPreferences.backgroundThrottling, false);
    assert.ok(config.webPreferences.preload.endsWith('/desktop/wallpaper-preload.cjs'));
    assert.equal(window.url, `${origin}/wallpaper`);
    assert.equal(f.controller.acceptReady({ sender: {}, senderFrame: window.webContents.mainFrame }, true), false);
    assert.equal(f.controller.acceptReady({ sender: window.webContents, senderFrame: { url: `${origin}/wallpaper` } }, true), false);
    window.webContents.mainFrame.url = `${origin}/`;
    assert.equal(f.controller.acceptReady(f.event(window), true), false);
    window.webContents.mainFrame.url = `${origin}/wallpaper`;
    assert.equal(f.controller.acceptReady(f.event(window), 'true'), false);
    assert.equal(f.controller.acceptReady(f.event(window), true), true);
    assert.equal((await start).enabled, true);
    assert.equal(window.shown, 1);
    assert.deepEqual(window.boundUpdates, [f.screen.bounds, f.screen.bounds]);
    assert.deepEqual(f.controller.acceptStateRequest(f.event(window)), { scene: 'galaxy', paused: false });
    assert.throws(() => f.controller.acceptStateRequest({ sender: {} }), /only in the wallpaper/);
    await f.controller.setEnabled(true);
    assert.equal(f.windows.length, 1);
    assert.deepEqual(JSON.parse(await readFile(path.join(f.directory, 'wallpaper.json'), 'utf8')), { version: 1, enabled: true, scene: 'galaxy' });
  } finally { await f.cleanup(); }
});

void test('wallpaper network permits only local GET static resources and never any API, other window or subframe', async () => {
  const f = await fixture();
  try {
    const window = await f.enable(), session = f.sessions[0];
    const request = { webContentsId: window.webContents.id, method: 'GET', resourceType: 'script', url: `${origin}/assets/wallpaper-123.js`, frame: window.webContents.mainFrame };
    const run = (handler, details) => { let result; handler(details, value => { result = value; }); return result; };
    assert.deepEqual(run(session.beforeRequest, request), { cancel: false });
    assert.deepEqual(run(session.beforeRequest, { ...request, resourceType: 'mainFrame', url: `${origin}/wallpaper` }), { cancel: false });
    assert.deepEqual(run(session.beforeRequest, { ...request, url: `${origin}/_next/static/wallpaper.css` }), { cancel: false });
    for (const details of [
      { url: `${origin}/api/ai` }, { url: `${origin}/api/settings` }, { url: 'https://example.com/asset.js' },
      { url: `${origin}/assets/source.json` }, { url: `${origin}/` }, { url: 'file:///tmp/asset.js' },
      { method: 'POST' }, { webContentsId: -1 }, { resourceType: 'subFrame', url: `${origin}/wallpaper` },
      { resourceType: 'mainFrame' }, { frame: { url: `${origin}/wallpaper` } },
    ]) assert.deepEqual(run(session.beforeRequest, { ...request, ...details }), { cancel: true });
    const headers = run(session.beforeHeaders, { ...request, requestHeaders: { 'x-lumior-desktop': 'spoofed', Accept: 'script' } });
    assert.deepEqual(headers.requestHeaders, { Accept: 'script', 'X-Lumior-Desktop': token });
    assert.deepEqual(run(session.beforeHeaders, { ...request, url: `${origin}/api/ai` }), { cancel: true });
    assert.equal(session.permissionCheck(), false);
    let permission; session.permissionRequest(window.webContents, 'clipboard-read', allowed => { permission = allowed; });
    assert.equal(permission, false);
    assert.deepEqual(window.openHandler({ url: 'https://example.com' }), { action: 'deny' });
    for (const name of ['will-navigate', 'will-redirect', 'will-attach-webview']) {
      let prevented = false;
      window.webContents.emit(name, { preventDefault: () => { prevented = true; } }, `${origin}/`);
      assert.equal(prevented, true);
    }
    let downloadPrevented = false;
    session.emit('will-download', { preventDefault: () => { downloadPrevented = true; } });
    assert.equal(downloadPrevented, true);
  } finally { await f.cleanup(); }
});

void test('lock, suspend and battery pauses compose and primary display bounds update without another window', async () => {
  const f = await fixture({ battery: true });
  try {
    const window = await f.enable();
    assert.equal(f.controller.getState().paused, true);
    f.powerMonitor.emit('lock-screen'); f.powerMonitor.emit('on-ac');
    assert.equal(f.controller.getState().paused, true);
    f.powerMonitor.emit('suspend'); f.powerMonitor.emit('unlock-screen');
    assert.equal(f.controller.getState().paused, true);
    f.powerMonitor.emit('resume');
    assert.equal(f.controller.getState().paused, false);
    assert.deepEqual(window.lastState, { channel: WALLPAPER_CHANNELS.state, state: { scene: 'galaxy', paused: false } });
    f.powerMonitor.emit('suspend'); f.powerMonitor.currentBattery = true;
    f.powerMonitor.emit('resume');
    assert.equal(f.controller.getState().paused, true, 'Unplugging while asleep must pause on wake even if its power event was missed.');
    f.powerMonitor.emit('on-ac');
    assert.equal(f.controller.getState().paused, false);
    f.screen.bounds = { x: 0, y: -1080, width: 2560, height: 1440 };
    f.screen.emit('display-metrics-changed');
    assert.deepEqual(window.bounds, f.screen.bounds);
    f.screen.emit('display-removed');
    assert.equal(f.windows.length, 1);
  } finally { await f.cleanup(); }
});

void test('scene-only preferences survive restart and dispose leaves the existing system wallpaper alone', async () => {
  const f = await fixture();
  try {
    await f.controller.init();
    await f.controller.setScene('shore');
    assert.equal(f.windows.length, 0);
    await f.enable();
    assert.equal(f.controller.getState().scene, 'shore');
    await f.controller.dispose();
    assert.equal(f.windows[0].destroyed, true);
    assert.equal(f.powerMonitor.eventNames().length, 0); assert.equal(f.screen.eventNames().length, 0);
    assert.equal(f.sessions[0].beforeRequest, null); assert.equal(f.sessions[0].beforeHeaders, null);
    const saved = JSON.parse(await readFile(path.join(f.directory, 'wallpaper.json'), 'utf8'));
    assert.deepEqual(saved, { version: 1, enabled: true, scene: 'shore' });
    assert.deepEqual(await readdir(f.directory), ['wallpaper.json']);
    const restored = createStarWallpaper({ app: { getPath: () => f.directory }, BrowserWindow: f.windows[0].constructor,
      screen: f.screen, powerMonitor: f.powerMonitor, platform: 'darwin', config: { origin, token }, readyTimeoutMs: 250 });
    try {
      await restored.init();
      assert.equal(restored.getState().enabled, false);
      assert.equal(restored.getState().scene, 'shore');
      assert.equal(f.windows.length, 2);
      assert.equal(restored.acceptReady(f.event(f.windows[1]), true), true);
      await restored.setEnabled(true);
      await restored.setEnabled(false);
      assert.equal(f.windows[1].destroyed, true);
      assert.equal(JSON.parse(await readFile(path.join(f.directory, 'wallpaper.json'), 'utf8')).enabled, false);
    } finally { await restored.dispose(); }
  } finally { await f.cleanup(); }
});

void test('failed ready, missing ready and renderer loss never claim a working wallpaper', async () => {
  for (const reason of ['ready', 'timeout', 'load', 'gone']) {
    const f = await fixture({ timeout: 15, loadFailure: reason === 'load' });
    try {
      await f.controller.init();
      const start = f.controller.setEnabled(true);
      await new Promise(resolve => setTimeout(resolve, 2));
      const window = f.windows[0];
      if (reason === 'ready') f.controller.acceptReady(f.event(window), false);
      if (reason === 'gone') window.webContents.emit('render-process-gone');
      const state = await start;
      assert.equal(state.enabled, false); assert.equal(typeof state.error, 'string');
      assert.equal(window.shown, 0); assert.equal(window.destroyed, true);
      assert.equal(JSON.parse(await readFile(path.join(f.directory, 'wallpaper.json'), 'utf8')).enabled, false);
    } finally { await f.cleanup(); }
  }
});

void test('disabling cancels a pending launch and stale ready cannot resurrect its window', async () => {
  const f = await fixture();
  try {
    await f.controller.init();
    const start = f.controller.setEnabled(true);
    await new Promise(resolve => setTimeout(resolve, 2));
    const window = f.windows[0];
    const off = await f.controller.setEnabled(false);
    assert.equal(off.enabled, false); assert.equal((await start).enabled, false);
    assert.equal(f.controller.acceptReady(f.event(window), true), false);
    assert.equal(window.shown, 0); assert.equal(window.destroyed, true);
    assert.deepEqual(await readdir(f.directory), ['wallpaper.json']);
  } finally { await f.cleanup(); }
});

void test('repeated toggles reuse the isolated session without accumulating its hooks', async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 5; i++) {
      const window = await f.enable(), session = window.webContents.session;
      assert.equal(session.listenerCount('will-download'), 1);
      await f.controller.setEnabled(false);
      assert.equal(session.listenerCount('will-download'), 0);
      assert.equal(session.beforeRequest, null); assert.equal(session.beforeHeaders, null);
    }
    assert.equal(new Set(f.sessions).size, 1);
  } finally { await f.cleanup(); }
});

void test('development preview cannot open the desktop or expose Vite filesystem routes', async () => {
  const f = await fixture({ development: true });
  try {
    assert.equal((await f.controller.init()).supported, false);
    assert.equal((await f.controller.setEnabled(true)).enabled, false);
    assert.equal(f.windows.length, 0);
    assert.deepEqual(await readdir(f.directory), []);
    assert.equal(f.powerMonitor.eventNames().length, 0);
  } finally { await f.cleanup(); }
});

void test('a preference write failure reports the real active window and a safe error', async () => {
  const f = await fixture();
  try {
    await f.controller.init();
    await mkdir(path.join(f.directory, 'wallpaper.json'));
    const window = await f.enable();
    const state = f.controller.getState();
    assert.equal(state.enabled, true);
    assert.equal(window.shown, 1); assert.equal(window.destroyed, false);
    assert.equal(state.error, 'The wallpaper preference could not be saved.');
    assert.equal(JSON.stringify(state).includes(f.directory), false);
    assert.deepEqual(await readdir(f.directory), ['wallpaper.json']);
  } finally { await f.cleanup(); }
});

void test('invalid saved settings start disabled and validation cannot inject a route or scene', async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.directory, 'wallpaper.json'), JSON.stringify({ version: 1, enabled: true, scene: '../api/ai' }));
    await f.controller.init();
    assert.equal(f.windows.length, 0); assert.equal(f.controller.getState().scene, 'galaxy');
    await assert.rejects(f.controller.setEnabled({ enabled: true }), /switch value/);
    await assert.rejects(f.controller.setScene('https://example.com'), /supported wallpaper scene/);
    assert.throws(() => createStarWallpaper({ config: { origin: 'https://example.com', token } }), /local wallpaper origin/);
    assert.throws(() => createStarWallpaper({ config: { origin: `${origin}/api/ai`, token } }), /local wallpaper origin/);
  } finally { await f.cleanup(); }
});

void test('the dedicated preload exposes only scene/pause/ready and removes state listeners', async () => {
  const source = await readFile(new URL('../desktop/wallpaper-preload.cjs', import.meta.url), 'utf8');
  const ipcRenderer = new EventEmitter(), exposed = {}, sent = [];
  ipcRenderer.invoke = async channel => { assert.equal(channel, WALLPAPER_CHANNELS.get); return { scene: 'shore', paused: true, token: 'must-not-leak', enabled: true }; };
  ipcRenderer.send = (...args) => sent.push(args);
  vm.runInNewContext(source, { require: name => { assert.equal(name, 'electron'); return { contextBridge: { exposeInMainWorld: (name, value) => { exposed[name] = value; } }, ipcRenderer }; } });
  assert.deepEqual(Object.keys(exposed), ['lumiorWallpaper']);
  const bridge = exposed.lumiorWallpaper;
  assert.deepEqual(Object.keys(bridge).sort(), ['getState', 'onState', 'ready']);
  assert.deepEqual(JSON.parse(JSON.stringify(await bridge.getState())), { scene: 'shore', paused: true });
  let received;
  const unsubscribe = bridge.onState(state => { received = state; });
  ipcRenderer.emit(WALLPAPER_CHANNELS.state, {}, { scene: 'galaxy', paused: false, secret: 'synthetic' });
  assert.deepEqual(JSON.parse(JSON.stringify(received)), { scene: 'galaxy', paused: false });
  ipcRenderer.emit(WALLPAPER_CHANNELS.state, {}, { scene: 'invalid', paused: false });
  assert.equal(received.scene, 'galaxy');
  unsubscribe(); assert.equal(ipcRenderer.listenerCount(WALLPAPER_CHANNELS.state), 0);
  bridge.ready(true); bridge.ready(false);
  assert.deepEqual(sent, [[WALLPAPER_CHANNELS.ready, true], [WALLPAPER_CHANNELS.ready, false]]);
  assert.throws(() => bridge.ready('yes'), /readiness value/);
  assert.throws(() => bridge.onState('no'), /state handler/);
});
