'use strict';
/* oxlint-disable typescript/no-require-imports -- Electron main-process modules use CommonJS. */
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

const WALLPAPER_PARTITION = 'lumior-wallpaper';
const WALLPAPER_CHANNELS = Object.freeze({ get: 'lumior:wallpaper:get', state: 'lumior:wallpaper:state', ready: 'lumior:wallpaper:ready' });
const SCENES = new Set(['galaxy', 'shore']);
const ERRORS = Object.freeze({ startup: 'The wallpaper could not start. Try turning it on again.', renderer: 'The wallpaper could not render. Try turning it on again.', timeout: 'The wallpaper did not finish starting. Try turning it on again.', preferences: 'The wallpaper preference could not be saved.' });

function createStarWallpaper({ app, BrowserWindow, screen, powerMonitor, config = {}, platform = process.platform, readyTimeoutMs = 15_000, timers = globalThis } = {}) {
  // Production resources have a closed allowlist. The Vite preview can resolve
  // arbitrary /@fs imports and deliberately does not host a desktop wallpaper.
  const supported = platform === 'darwin' && config.development !== true;
  const origin = new URL(config.origin || 'http://127.0.0.1:43171').origin;
  const parsedOrigin = new URL(config.origin || origin);
  if (parsedOrigin.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(parsedOrigin.hostname)
    || parsedOrigin.username || parsedOrigin.password || parsedOrigin.pathname !== '/' || parsedOrigin.search || parsedOrigin.hash
    || typeof config.token !== 'string' || config.token.length < 32 || /[\r\n]/.test(config.token)) throw new Error('A local wallpaper origin and desktop token are required.');
  let scene = 'galaxy', enabled = false, disposed = false, initialized = false;
  let locked = false, suspended = false, battery = false, error;
  let currentWindow, currentSession, downloadHandler, pending, initPromise, preferencesFile;
  let writes = Promise.resolve();
  const subscribers = new Set(), listeners = [];
  const paused = () => locked || suspended || battery;
  const getState = () => Object.freeze({ supported, enabled, scene, paused: paused(), ...(error ? { error } : {}) });
  const renderState = () => Object.freeze({ scene, paused: paused() });

  function publish() {
    if (disposed) return;
    const state = getState();
    for (const listener of subscribers) { try { listener(state); } catch { /* UI listeners do not own the wallpaper. */ } }
  }
  function sendState() {
    const contents = currentWindow?.webContents;
    if (!contents || contents.isDestroyed()) return;
    try { contents.send(WALLPAPER_CHANNELS.state, renderState()); } catch { /* A reload obtains the same state through getState. */ }
  }
  function updatePower() { sendState(); publish(); }
  function readBattery() {
    try { battery = powerMonitor.isOnBatteryPower() === true; } catch { /* Keep the last power state until its next event. */ }
  }
  function listen(target, name, handler) {
    target.on(name, handler);
    listeners.push([target, name, handler]);
  }
  function sceneUrl(value) {
    try { const url = new URL(value); return url.origin === origin && !url.username && !url.password && ['/wallpaper', '/wallpaper/'].includes(url.pathname); }
    catch { return false; }
  }
  function allowedResource(value, resourceType) {
    try {
      const url = new URL(value);
      if (url.origin !== origin || url.username || url.password) return false;
      if (resourceType === 'subFrame') return false;
      if (['/wallpaper', '/wallpaper/'].includes(url.pathname)) return resourceType === 'mainFrame';
      if (resourceType === 'mainFrame') return false;
      return (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/_next/static/'))
        && /\.(?:m?js|css|woff2?|ttf|otf|png|jpe?g|gif|svg|webp|avif|ico)$/.test(url.pathname);
    } catch { return false; }
  }
  function authorizedRequest(details) {
    const contents = currentWindow?.webContents;
    return contents && !contents.isDestroyed() && details.webContentsId === contents.id
      && (details.method === undefined || details.method === 'GET' || details.method === 'HEAD')
      && allowedResource(details.url, details.resourceType)
      && (!details.frame || details.resourceType === 'mainFrame' || details.frame === contents.mainFrame && sceneUrl(details.frame.url));
  }
  function authorizedEvent(event) {
    const contents = currentWindow?.webContents;
    return Boolean(!disposed && contents && !contents.isDestroyed() && event?.sender === contents
      && event.senderFrame === contents.mainFrame && sceneUrl(event.senderFrame?.url));
  }
  function acceptStateRequest(event) {
    if (!authorizedEvent(event)) throw new Error('This action is available only in the wallpaper.');
    return renderState();
  }
  function savePreferences(value = { enabled, scene }) {
    if (!preferencesFile) return Promise.resolve();
    const snapshot = { version: 1, enabled: value.enabled === true, scene: SCENES.has(value.scene) ? value.scene : 'galaxy' };
    writes = writes.catch(() => {}).then(async () => {
      const temporary = `${preferencesFile}.${randomBytes(8).toString('hex')}.tmp`;
      try {
        await fs.mkdir(path.dirname(preferencesFile), { recursive: true });
        await fs.writeFile(temporary, JSON.stringify(snapshot), { mode: 0o600, flag: 'wx' });
        await fs.rename(temporary, preferencesFile);
      } catch {
        await fs.rm(temporary, { force: true }).catch(() => {});
        if (!disposed) { error = ERRORS.preferences; publish(); }
      }
    });
    return writes;
  }
  function destroyWindow() {
    const old = currentWindow;
    currentWindow = undefined;
    if (currentSession) {
      currentSession.webRequest.onBeforeRequest(null);
      currentSession.webRequest.onBeforeSendHeaders(null);
      currentSession.setPermissionRequestHandler(null);
      currentSession.setPermissionCheckHandler(null);
      currentSession.removeListener('will-download', downloadHandler);
      currentSession = undefined;
      downloadHandler = undefined;
    }
    if (old && !old.isDestroyed()) old.destroy();
  }
  function finishPending() {
    const old = pending;
    pending = undefined;
    if (!old) return;
    timers.clearTimeout(old.timer);
    return old.resolve;
  }
  function fail(message) {
    if (disposed) return;
    const resolve = finishPending();
    enabled = false;
    error = message;
    destroyWindow();
    publish();
    void savePreferences().then(() => resolve?.(getState()));
  }
  function configureSession(contents) {
    const own = contents.session;
    currentSession = own;
    own.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    own.setPermissionCheckHandler(() => false);
    own.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => callback({ cancel: !authorizedRequest(details) }));
    own.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, callback) => {
      if (!authorizedRequest(details)) { callback({ cancel: true }); return; }
      const headers = { ...details.requestHeaders };
      for (const name of Object.keys(headers)) if (name.toLowerCase() === 'x-lumior-desktop') delete headers[name];
      headers['X-Lumior-Desktop'] = config.token;
      callback({ requestHeaders: headers });
    });
    downloadHandler = event => event.preventDefault();
    own.on('will-download', downloadHandler);
  }
  function updateBounds() {
    if (!currentWindow || currentWindow.isDestroyed()) return;
    try { currentWindow.setBounds(screen.getPrimaryDisplay().bounds, false); } catch { fail(ERRORS.startup); }
  }
  function activate() {
    if (disposed || !supported) return Promise.resolve(getState());
    if (pending) return pending.promise;
    if (enabled && currentWindow && !currentWindow.isDestroyed()) return Promise.resolve(getState());
    error = undefined;
    const promise = new Promise(resolve => { pending = { resolve }; });
    pending.promise = promise;
    pending.timer = timers.setTimeout(() => fail(ERRORS.timeout), Math.max(1, readyTimeoutMs));
    try {
      const window = new BrowserWindow({
        ...screen.getPrimaryDisplay().bounds, type: 'desktop', title: 'Lumior wallpaper', frame: false, show: false,
        backgroundColor: '#05070d', focusable: false, skipTaskbar: true, resizable: false, movable: false,
        minimizable: false, maximizable: false, fullscreenable: false, closable: false, paintWhenInitiallyHidden: true,
        // macOS otherwise constrains even frameless windows below its menu bar.
        enableLargerThanScreen: true,
        webPreferences: { preload: path.join(__dirname, '..', 'wallpaper-preload.cjs'), partition: WALLPAPER_PARTITION,
          contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, devTools: false,
          // Finder can occlude a desktop-level window. System power events and
          // the renderer's explicit 30 fps limit control its animation instead.
          backgroundThrottling: false, spellcheck: false, navigateOnDragDrop: false },
      });
      currentWindow = window;
      window.setBounds(screen.getPrimaryDisplay().bounds, false);
      window.setIgnoreMouseEvents(true);
      const contents = window.webContents;
      configureSession(contents);
      contents.setWindowOpenHandler(() => ({ action: 'deny' }));
      const stopNavigation = (event, url) => { if (!sceneUrl(url || event.url)) event.preventDefault(); };
      contents.on('will-navigate', stopNavigation);
      contents.on('will-redirect', stopNavigation);
      contents.on('will-attach-webview', event => event.preventDefault());
      contents.on('dom-ready', sendState);
      contents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => { if (currentWindow === window && mainFrame !== false && code !== -3) fail(ERRORS.startup); });
      contents.on('render-process-gone', () => { if (currentWindow === window) fail(ERRORS.renderer); });
      window.on('closed', () => { if (currentWindow === window) fail(ERRORS.renderer); });
      void Promise.resolve(window.loadURL(`${origin}/wallpaper`)).catch(() => { if (currentWindow === window) fail(ERRORS.startup); });
      publish();
    } catch { fail(ERRORS.startup); }
    return promise;
  }
  function acceptReady(event, ok) {
    if (!authorizedEvent(event) || typeof ok !== 'boolean') return false;
    if (!ok) { fail(ERRORS.renderer); return true; }
    if (!pending) return true;
    try {
      if (typeof currentWindow.showInactive === 'function') currentWindow.showInactive(); else currentWindow.show();
      currentWindow.setBounds(screen.getPrimaryDisplay().bounds, false);
    } catch { fail(ERRORS.startup); return true; }
    const resolve = finishPending();
    enabled = true;
    error = undefined;
    sendState();
    publish();
    void savePreferences().then(() => resolve?.(getState()));
    return true;
  }
  async function init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      if (disposed || !supported) return getState();
      preferencesFile = path.join(app.getPath('userData'), 'wallpaper.json');
      let restore = false;
      try {
        const saved = JSON.parse(await fs.readFile(preferencesFile, 'utf8'));
        if (saved?.version === 1 && SCENES.has(saved.scene) && typeof saved.enabled === 'boolean') { scene = saved.scene; restore = saved.enabled; }
      } catch { /* A missing or invalid preference starts disabled. */ }
      if (disposed) return getState();
      readBattery();
      for (const [name, change] of [
        ['lock-screen', () => { locked = true; }], ['unlock-screen', () => { locked = false; readBattery(); }],
        ['suspend', () => { suspended = true; }], ['resume', () => { suspended = false; readBattery(); }],
        ['on-battery', () => { battery = true; }], ['on-ac', () => { battery = false; }],
      ]) listen(powerMonitor, name, () => { change(); updatePower(); });
      for (const name of ['display-metrics-changed', 'display-added', 'display-removed']) listen(screen, name, updateBounds);
      initialized = true;
      publish();
      if (restore) void activate();
      return getState();
    })();
    return initPromise;
  }
  async function setEnabled(value) {
    if (typeof value !== 'boolean') throw new Error('A wallpaper switch value is required.');
    if (!initialized) await init();
    if (disposed || !supported) return getState();
    if (value) return activate();
    const resolve = finishPending();
    enabled = false;
    error = undefined;
    destroyWindow();
    publish();
    await savePreferences();
    resolve?.(getState());
    return getState();
  }
  async function setScene(value) {
    if (!SCENES.has(value)) throw new Error('Choose a supported wallpaper scene.');
    if (!initialized) await init();
    if (disposed || !supported) return getState();
    scene = value;
    error = undefined;
    sendState();
    publish();
    await savePreferences();
    return getState();
  }
  async function dispose() {
    if (disposed) return writes;
    disposed = true;
    const resolve = finishPending();
    enabled = false;
    destroyWindow();
    for (const [target, name, handler] of listeners.splice(0)) target.removeListener(name, handler);
    subscribers.clear();
    resolve?.(getState());
    await writes;
  }
  function subscribe(listener) {
    if (typeof listener !== 'function') throw new Error('A wallpaper state listener is required.');
    if (!disposed) subscribers.add(listener);
    return () => subscribers.delete(listener);
  }
  return Object.freeze({ init, getState, setEnabled, setScene, acceptReady, acceptStateRequest, dispose, subscribe });
}

module.exports = { createStarWallpaper, WALLPAPER_PARTITION, WALLPAPER_CHANNELS };
