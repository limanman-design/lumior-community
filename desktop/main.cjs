'use strict';
/* oxlint-disable typescript/no-require-imports -- Electron's sandboxed preload and main entry use CommonJS. */
const { app, BrowserWindow, Menu, ipcMain, session, shell, dialog, safeStorage, utilityProcess, screen, powerMonitor, clipboard, nativeTheme, autoUpdater: nativeUpdater } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomBytes } = require('node:crypto');
const { SESSION_PARTITION, externalUrl, cleanBackendEnvironment, desktopConfiguration, createSecurity } = require('./runtime/security.cjs');
const { createCredentialStore } = require('./runtime/credentials.cjs');
const { readTrialService, isolatedTrialTest } = require('./runtime/trial-access.cjs');
const { createUpdateController, isUpdateRequest } = require('./runtime/updates.cjs');
const { readUpdateBuild } = require('./runtime/update-build.cjs');
const { createStarWallpaper } = require('./runtime/star-wallpaper.cjs');
const { desktopIdentity } = require('./runtime/app-identity.cjs');
const { desktopDistribution } = require('./runtime/distribution.cjs');
const { createWindowPreferences, chooseWindowClose } = require('./runtime/window-preferences.cjs');
const { mainWindowMaterial } = require('./runtime/window-appearance.cjs');
const { readClipboardImages } = require('./runtime/clipboard-images.cjs');
const { createDesktopPet } = require('./runtime/desktop-pet.cjs');
const distribution = desktopDistribution(require('./package.json').lumiorDistribution);
const configuration = desktopConfiguration(app.isPackaged, process.env, distribution);
const { development } = configuration;
const { DESKTOP_ORIGIN, DESKTOP_PORT, isAppUrl } = createSecurity(configuration.port);
const { appName, userDataName, appId } = desktopIdentity({ development, platform: process.platform, channel: require('./package.json').lumiorChannel, distribution });

app.setName(appName);
app.setPath('userData', process.env.LUMIOR_DESKTOP_DATA_DIR || path.join(app.getPath('appData'), userDataName));
if (process.platform === 'win32') app.setAppUserModelId(appId);
const locked = app.requestSingleInstanceLock();
let window, backend, credentials, updates, wallpaper, pet, quitting = false;
let preparingQuit = false;
let updateAttempt = false, updatePrepared = false, nativeUpdateQuit = false;
const token = randomBytes(32).toString('hex');
const runtimeDirectory = development ? path.join(__dirname, 'runtime') : app.isPackaged ? path.join(process.resourcesPath, 'lumior-runtime') : path.join(__dirname, 'generated');
const stateFile = path.join(app.getPath('userData'), 'window.json');
const windowPreferences = createWindowPreferences(app.getPath('userData'), fs);
let applicationMenu;
const pendingSettings = new Map();
const pendingClose = new Map();
const closeRequests = new WeakMap();
ipcMain.on('lumior:close-ready', (event, data) => {
  const pending = pendingClose.get(data?.requestId);
  if (!pending || pending.contents.isDestroyed() || !event.senderFrame || event.sender !== pending.contents || event.senderFrame !== pending.contents.mainFrame || !isAppUrl(event.senderFrame.url)) return;
  pending.finish(data.saved === true);
});

if (!locked) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.on('window-all-closed', () => { if (development || process.platform !== 'darwin') app.quit(); });
  app.on('activate', () => { if (!window && backend && !quitting) createWindow().catch(failStartup); else window?.show(); });
  app.on('before-quit', event => {
    if (quitting) { if (backend) event.preventDefault(); return; }
    if (!backend) return;
    event.preventDefault();
    // macOS stages and checks the signed ZIP asynchronously. Keep the workspace
    // service alive until the native updater has actually begun quitting.
    if (nativeUpdateQuit && updatePrepared) { shutdownBackend(); return; }
    if (preparingQuit) return;
    preparingQuit = true;
    if (updates?.getState().status === 'downloaded') { void updates.install(); return; }
    Promise.resolve(pet?.prepareQuit()).then(() => prepareClose(window)).then(() => {
      if (updates?.getState().status === 'downloaded') void updates.install();
      else shutdownBackend();
    }).catch(() => { resumeEditing(); saveFailed(); });
  });
  nativeUpdater.on('before-quit-for-update', () => {
    if (updatePrepared && updates?.getState().status === 'installing') nativeUpdateQuit = true;
  });
  app.on('quit', () => { updates?.dispose(); wallpaper?.dispose(); void pet?.dispose(); });
  app.whenReady().then(start).catch(failStartup);
}
function saveFailed() {
  dialog.showErrorBox(`${appName} 尚未保存`, '资料尚未完成保存，窗口已保留。请稍后重试；如果持续失败，可在设置中导出完整备份。');
}
function shutdownBackend() {
  if (quitting) return;
  quitting = true;
  const wallpaperClosed = Promise.all([wallpaper?.dispose(), pet?.dispose()]).catch(() => {});
  if (!backend) { void wallpaperClosed.then(() => app.quit()); return; }
  const child = backend;
  let finished = false;
  const finish = () => { if (finished) return; finished = true; clearTimeout(timeout); if (backend === child) backend = undefined; void wallpaperClosed.then(() => app.quit()); };
  const timeout = setTimeout(() => { child.kill(); finish(); }, 4500);
  child.once('exit', finish);
  try { child.postMessage({ type: 'shutdown' }); } catch { child.kill(); finish(); }
}
function resumeEditing() {
  pet?.resume();
  preparingQuit = false;
  updateAttempt = false;
  updatePrepared = false;
  nativeUpdateQuit = false;
  if (window && !window.isDestroyed()) window.webContents.send('lumior:close-cancelled');
}
function prepareClose(current) {
  if (!current || current.isDestroyed() || !isAppUrl(current.webContents.getURL())) return Promise.resolve();
  const contents = current.webContents;
  if (closeRequests.has(contents)) return closeRequests.get(contents);
  const requestId = randomBytes(12).toString('hex');
  const request = new Promise((resolve, reject) => {
    const finish = saved => {
      clearTimeout(timer);
      pendingClose.delete(requestId);
      if (saved) resolve(); else {
        if (!contents.isDestroyed()) contents.send('lumior:close-cancelled');
        reject(new Error('Workspace data has not finished saving.'));
      }
    };
    const timer = setTimeout(() => finish(false), 10000);
    pendingClose.set(requestId, { contents, finish });
    contents.send('lumior:prepare-close', requestId);
  });
  closeRequests.set(contents, request);
  const release = () => { closeRequests.delete(contents); };
  void request.then(release, release);
  return request;
}
async function failStartup(error) {
  if (quitting) return;
  if (process.env.LUMIOR_DESKTOP_TEST_MODE === '1') {
    console.error('Lumior startup failed:', error?.message || 'Local service stopped.');
    backend?.kill();
    app.exit(1);
    return;
  }
  dialog.showErrorBox(`${appName} 无法启动`, `请确认本机端口 ${DESKTOP_PORT} 没有被占用，并检查${development ? '开发依赖是否已安装。详细信息见启动窗口。' : '应用资源是否完整。'}你的已有数据已保留。`);
  if (development) console.error(error?.message || 'Local service stopped.');
  app.quit();
}
async function start() {
  // The app currently has a fixed dark palette. Keep native materials / menus
  // in the same appearance even when macOS uses a light system theme. This is
  // an app-only override and does not change the user's OS appearance.
  nativeTheme.themeSource = 'dark';
  await fs.access(development ? path.join(__dirname, '..', 'node_modules', 'vinext', 'package.json') : path.join(runtimeDirectory, 'web', 'server', 'index.js'));
  if (development && process.platform === 'darwin') app.dock.setIcon(path.join(__dirname, 'assets', 'icon.png'));
  const gatewayUrl = distribution === 'official' ? await readTrialService(runtimeDirectory) : '';
  credentials = createCredentialStore(app.getPath('userData'), safeStorage, { gatewayUrl, allowLocalTest: isolatedTrialTest() });
  const desktopSession = session.fromPartition(SESSION_PARTITION);
  desktopSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    const trusted = isAppUrl(details.requestingUrl || contents.getURL());
    callback(trusted && (permission === 'clipboard-sanitized-write' || (permission === 'fileSystem' && contents === window?.webContents)));
  });
  desktopSession.setPermissionCheckHandler((contents, permission, origin) => isAppUrl(origin || contents?.getURL()) && (permission === 'clipboard-sanitized-write' || (permission === 'fileSystem' && contents === window?.webContents)));
  desktopSession.webRequest.onBeforeSendHeaders({ urls: [`${DESKTOP_ORIGIN}/*`, ...(development ? [`ws://127.0.0.1:${DESKTOP_PORT}/*`] : [])] }, (details, callback) => {
    const main = window?.webContents;
    if (!main || details.webContentsId !== main.id || (details.frame && details.resourceType !== 'mainFrame' && !isAppUrl(details.frame.url))) {
      callback({ cancel: true }); return;
    }
    const headers = { ...details.requestHeaders, 'X-Lumior-Desktop': token };
    callback({ requestHeaders: headers });
  });
  desktopSession.on('will-download', (_event, item) => {
    item.setSaveDialogOptions({ title: 'Save from Lumior', defaultPath: path.join(app.getPath('downloads'), path.basename(item.getFilename())) });
  });
  const authorized = event => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !isAppUrl(event.senderFrame.url)) throw new Error('This action is available only in Lumior.');
  };
  const windowsAction = event => {
    authorized(event);
    if (process.platform !== 'win32') throw new Error('Windows window action required.');
  };
  ipcMain.handle('lumior:clipboard:images', (event, ...options) => {
    authorized(event);
    if (options.length) throw new Error('Clipboard options are not accepted.');
    if (!window.isFocused()) throw new Error('Clipboard paste requires the active Lumior window.');
    return readClipboardImages(clipboard, { platform: process.platform });
  });
  await windowPreferences.load();
  pet = createDesktopPet({ app, BrowserWindow, Menu, ipcMain, session, screen,
    getMainWindow: () => window,
    showMainWindow: async () => {
      if (quitting || preparingQuit) return;
      if (!window || window.isDestroyed()) await createWindow();
      if (window.isMinimized()) window.restore();
      window.show(); window.focus();
    }, isAppUrl, isQuitting: () => quitting || preparingQuit,
  });
  pet.subscribe(state => { if (window && !window.isDestroyed()) window.webContents.send('lumior:pet:state', state); });
  ipcMain.handle('lumior:pet:get', (event, ...extra) => { authorized(event); if (extra.length) throw new Error('Unexpected pet options.'); return pet.getState(); });
  ipcMain.handle('lumior:pet:enable', (event, enabled, ...extra) => {
    authorized(event);
    if (extra.length || typeof enabled !== 'boolean') throw new Error('A pet on/off value is required.');
    return pet.setEnabled(enabled);
  });
  ipcMain.handle('lumior:pet:size', (event, size, ...extra) => {
    authorized(event);
    if (extra.length || !Number.isInteger(size) || size < 75 || size > 300) throw new Error('A pet size from 75 to 300 is required.');
    return pet.setSize(size);
  });
  ipcMain.handle('lumior:pet:quick-note', (event, ...extra) => {
    authorized(event);
    if (extra.length) throw new Error('Unexpected quick note options.');
    return pet.openEditor();
  });
  ipcMain.handle('lumior:pet:animation', (event, value, ...extra) => {
    authorized(event);
    if (extra.length) throw new Error('Unexpected animation options.');
    return pet.setAnimation(value);
  });
  ipcMain.handle('lumior:pet:blink', (event, ...extra) => {
    authorized(event);
    if (extra.length) throw new Error('Unexpected blink options.');
    return pet.blink();
  });
  const windowState = () => ({ maximized: window.isMaximized(), fullscreen: window.isFullScreen() });
  ipcMain.handle('lumior:window:state', (event, ...extra) => {
    windowsAction(event);
    if (extra.length) throw new Error('Window options are not accepted.');
    return windowState();
  });
  ipcMain.handle('lumior:window:action', (event, action, ...extra) => {
    windowsAction(event);
    if (extra.length || !['minimize', 'toggle-maximize', 'close'].includes(action)) throw new Error('Invalid window action.');
    if (action === 'close') window.close();
    else if (action === 'minimize') window.minimize();
    else if (window.isFullScreen()) window.setFullScreen(false);
    else if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  });
  ipcMain.handle('lumior:window:preferences', (event, ...extra) => {
    windowsAction(event);
    if (extra.length) throw new Error('Window options are not accepted.');
    return windowPreferences.get();
  });
  ipcMain.handle('lumior:window:close-behavior', (event, behavior, ...extra) => {
    windowsAction(event);
    if (extra.length) throw new Error('Window options are not accepted.');
    return windowPreferences.set(behavior);
  });
  ipcMain.handle('lumior:window:menu', (event, request, ...extra) => {
    windowsAction(event);
    if (extra.length || !request || Object.keys(request).some(key => !['menu', 'x', 'y'].includes(key)) || !['file', 'edit', 'view', 'window'].includes(request.menu) || !Number.isFinite(request.x) || !Number.isFinite(request.y)) throw new Error('Invalid window menu.');
    const menu = applicationMenu?.getMenuItemById(request.menu)?.submenu;
    if (!menu) throw new Error('Window menu unavailable.');
    const [width, height] = window.getContentSize();
    return new Promise(resolve => menu.popup({ window, x: Math.round(Math.max(0, Math.min(width, request.x))), y: Math.round(Math.max(0, Math.min(height, request.y))), callback: () => resolve() }));
  });
  ipcMain.handle('lumior:locale:get', (event, ...options) => {
    authorized(event);
    if (options.length) throw new Error('Locale options are not accepted.');
    return { languages: app.getPreferredSystemLanguages(), region: app.getLocaleCountryCode() };
  });
  wallpaper = createStarWallpaper({ app, BrowserWindow, screen, powerMonitor, config: { origin: DESKTOP_ORIGIN, token, development } });
  wallpaper.subscribe(state => {
    if (window && !window.isDestroyed() && isAppUrl(window.webContents.getURL())) window.webContents.send('lumior:wallpaper:state', state);
  });
  ipcMain.handle('lumior:wallpaper:get', event => {
    if (window && event.sender === window.webContents) { authorized(event); return wallpaper.getState(); }
    return wallpaper.acceptStateRequest(event);
  });
  ipcMain.handle('lumior:wallpaper:enable', async (event, enabled, ...extra) => {
    authorized(event);
    if (extra.length || typeof enabled !== 'boolean') throw new Error('A wallpaper on/off value is required.');
    return wallpaper.setEnabled(enabled);
  });
  ipcMain.handle('lumior:wallpaper:scene', async (event, scene, ...extra) => {
    authorized(event);
    if (extra.length || !['galaxy', 'shore'].includes(scene)) throw new Error('Choose a supported wallpaper scene.');
    return wallpaper.setScene(scene);
  });
  ipcMain.on('lumior:wallpaper:ready', (event, ok) => { wallpaper.acceptReady(event, ok); });
  ipcMain.handle('lumior:ai:get', async event => { authorized(event); return credentials.get(); });
  ipcMain.handle('lumior:ai:save', async (event, settings) => {
    authorized(event);
    const result = await credentials.save(settings);
    await applyAiSettings(await credentials.config());
    return result;
  });
  const trialAction = action => async (event, request, ...extra) => {
    authorized(event);
    if (extra.length) throw new Error('Trial options are not accepted.');
    const result = await action(request);
    await applyAiSettings(await credentials.config());
    return result;
  };
  ipcMain.handle('lumior:ai:trial:activate', trialAction(code => credentials.activateTrial(code)));
  ipcMain.handle('lumior:ai:usage-mode', trialAction(mode => credentials.setUsageMode(mode)));
  ipcMain.handle('lumior:ai:trial:clear', trialAction(request => {
    if (request !== undefined) throw new Error('Trial options are not accepted.');
    return credentials.clearTrial();
  }));
  // Resolve YAML through the production updater dependency; development builds
  // never load an update provider or make update requests.
  let updateSdk, buildConfig;
  if (distribution === 'official' && app.isPackaged && !development) {
    try {
      const updaterRequire = require('node:module').createRequire(require.resolve('electron-updater'));
      const yaml = updaterRequire('js-yaml');
      buildConfig = await readUpdateBuild({
        isPackaged: app.isPackaged, development, resourcesPath: process.resourcesPath,
        platform: process.platform, arch: process.arch, version: app.getVersion(),
        parseYaml: source => yaml.load(source, { schema: yaml.JSON_SCHEMA }),
      });
      if (buildConfig) updateSdk = require('electron-updater').autoUpdater;
    } catch { /* A preview or incomplete release keeps updates disabled. */ }
  }
  updates = createUpdateController({
    updater: updateSdk, currentVersion: app.getVersion(), isPackaged: app.isPackaged,
    development, buildConfig,
    onBeforeInstall: async () => {
      preparingQuit = true;
      await pet.prepareQuit();
      await prepareClose(window);
      if (updates.getState().status !== 'installing') { resumeEditing(); return false; }
      updatePrepared = true;
      return true;
    },
  });
  updates.subscribe(state => {
    if (state.status === 'installing') { updateAttempt = true; preparingQuit = true; }
    else if (updateAttempt && !quitting) resumeEditing();
    if (window && !window.isDestroyed() && isAppUrl(window.webContents.getURL())) window.webContents.send('lumior:update-state', state);
  });
  const updateAction = action => async (event, request, ...extra) => {
    authorized(event);
    if (!isUpdateRequest(request) || extra.length) throw new Error('Update options are not accepted.');
    await action();
    return updates.getState();
  };
  ipcMain.handle('lumior:update:get', updateAction(() => {}));
  ipcMain.handle('lumior:update:check', updateAction(() => updates.check()));
  ipcMain.handle('lumior:update:install', updateAction(() => updates.install()));
  backend = utilityProcess.fork(path.join(runtimeDirectory, development ? 'dev-backend.mjs' : 'backend.mjs'), [], {
    cwd: development ? path.resolve(__dirname, '..') : runtimeDirectory,
    env: cleanBackendEnvironment(process.env, token, path.join(runtimeDirectory, 'web'), development, distribution),
    stdio: 'pipe',
    serviceName: development ? 'Lumior live preview' : 'Lumior local service',
  });
  backend.stdout?.on('data', chunk => { if (development) process.stdout.write(chunk); });
  backend.stderr?.on('data', chunk => { if (development || process.env.LUMIOR_DESKTOP_TEST_MODE === '1') process.stderr.write(chunk); });
  backend.on('message', data => {
    if (data?.type === 'settings-applied') {
      const resolve = pendingSettings.get(data.requestId);
      pendingSettings.delete(data.requestId);
      resolve?.();
    }
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Local service startup timed out.')), 30000);
    const onMessage = data => { if (data?.type === 'ready') { clearTimeout(timer); backend.removeListener('message', onMessage); resolve(); } };
    backend.on('message', onMessage);
    backend.once('exit', () => { clearTimeout(timer); reject(new Error('Local service stopped during startup.')); });
  });
  backend.on('exit', () => { if (!quitting) void failStartup(); });
  // A locked keychain does not prevent opening the research workspace.
  try { await applyAiSettings(await credentials.config()); } catch { await applyAiSettings({ key: '', model: 'deepseek-flash' }); }
  installMenu();
  await createWindow();
  await pet.init();
  void wallpaper.init().catch(() => { /* Wallpaper failure keeps the original desktop available. */ });
  updates.start();
}
function applyAiSettings(config) {
  if (!backend?.pid) return Promise.reject(new Error('The local AI service is unavailable. Restart Lumior.'));
  const requestId = randomBytes(12).toString('hex');
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pendingSettings.delete(requestId); reject(new Error('AI settings were saved. Restart Lumior to apply them.')); }, 5000);
    pendingSettings.set(requestId, () => { clearTimeout(timeout); resolve(); });
    backend.postMessage({ type: 'ai-settings', requestId, ...config });
  });
}
async function createWindow() {
  let state = {};
  try { state = JSON.parse(await fs.readFile(stateFile, 'utf8')); } catch { /* First launch uses standard dimensions. */ }
  window = new BrowserWindow({
    width: Math.max(900, Math.min(2200, Number(state.width) || 1440)),
    height: Math.max(650, Math.min(1600, Number(state.height) || 940)),
    minWidth: 760, minHeight: 560,
    title: appName, backgroundColor: '#161616', show: false,
    ...mainWindowMaterial(process.platform, os.release()),
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hidden', trafficLightPosition: { x: 16, y: 14 } } : {}),
    ...(process.platform === 'win32' ? { titleBarStyle: 'hidden', titleBarOverlay: false, autoHideMenuBar: false } : {}),
    icon: path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon-windows.png' : 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), partition: SESSION_PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: true },
  });
  const current = window;
  if (process.platform === 'win32') {
    current.setMenuBarVisibility(false);
    const syncWindowState = () => current.webContents.send('lumior:window:state', { maximized: current.isMaximized(), fullscreen: current.isFullScreen() });
    for (const event of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) current.on(event, syncWindowState);
    current.webContents.on('dom-ready', syncWindowState);
  }
  if (development) current.on('page-title-updated', event => { event.preventDefault(); current.setTitle(appName); });
  current.webContents.setWindowOpenHandler(({ url }) => { const safe = externalUrl(url); if (safe && !isAppUrl(safe)) void shell.openExternal(safe).catch(() => {}); return { action: 'deny' }; });
  current.webContents.on('will-navigate', (event, url) => { if (!isAppUrl(url)) { event.preventDefault(); const safe = externalUrl(url); if (safe) void shell.openExternal(safe).catch(() => {}); } });
  current.webContents.on('will-attach-webview', event => event.preventDefault());
  let closing = false, savedForClose = false;
  current.on('close', event => {
    if (!quitting && updates?.getState().status === 'installing' && !(nativeUpdateQuit && updatePrepared)) {
      savedForClose = false; closing = false;
      event.preventDefault(); return;
    }
    if (!quitting && !savedForClose && !(nativeUpdateQuit && updatePrepared)) {
      event.preventDefault();
      if (closing) return;
      closing = true;
      void (async () => {
        if (pet?.getState().enabled && !preparingQuit) {
          await prepareClose(current);
          current.webContents.send('lumior:close-cancelled');
          if (!preparingQuit && !quitting) current.hide();
          return;
        }
        if (process.platform === 'win32' && !preparingQuit) {
          const behavior = await chooseWindowClose({ window: current, preferences: windowPreferences, dialog, english: !app.getPreferredSystemLanguages().some(language => language.startsWith('zh')) });
          // An explicit Quit/update may have begun while the question was open.
          if (current.isDestroyed() || quitting || preparingQuit) return;
          if (behavior !== 'quit') {
            if (behavior === 'minimize') current.minimize();
            return;
          }
          app.quit();
          return;
        }
        await prepareClose(current);
        savedForClose = true;
        current.close();
      })().catch(error => {
        if (error?.code === 'WINDOW_PREFERENCE_SAVE') dialog.showErrorBox('Lumior', '未能记住关闭选择，窗口已保留。请重试，或暂时不勾选“记住我的选择”。');
        else saveFailed();
      }).finally(() => { closing = false; });
      return;
    }
    const bounds = current.getNormalBounds();
    fs.writeFile(stateFile, JSON.stringify({ width: bounds.width, height: bounds.height, maximized: current.isMaximized() }), { mode: 0o600 }).catch(() => {});
  });
  current.on('closed', () => { if (window === current) window = undefined; });
  current.once('ready-to-show', () => { if (state.maximized) current.maximize(); current.show(); });
  await current.loadURL(DESKTOP_ORIGIN);
}
function installMenu() {
  const menu = [
    ...(process.platform === 'darwin' ? [{ label: appName, submenu: [{ label: `关于 ${appName}`, click: () => { void dialog.showMessageBox({ title: appName, message: `${appName} ${app.getVersion()}`, detail: development ? '保存界面代码后自动更新。开发预览使用独立的本地工作区。' : 'Desktop preview · 本地研究工作区' }); } }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    { label: 'File', submenu: [{ role: 'close' }, ...(process.platform !== 'darwin' ? [{ role: 'quit' }] : [])] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'reload' }, ...(development ? [{ role: 'toggleDevTools' }] : []), { role: 'togglefullscreen' }] },
    { role: 'window', submenu: [{ role: 'minimize' }, { role: 'zoom' }] },
  ];
  for (const entry of menu) if (['File', 'Edit', 'View'].includes(entry.label)) entry.id = entry.label.toLowerCase(); else if (entry.role === 'window') entry.id = 'window';
  applicationMenu = Menu.buildFromTemplate(menu);
  Menu.setApplicationMenu(applicationMenu);
}
