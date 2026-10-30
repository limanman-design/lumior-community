'use strict';
/* oxlint-disable typescript/no-require-imports -- Electron main uses CommonJS. */
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { createPetStore, clampPetBounds, petMessageLayout, validPetSize, petWindowSize, validAnimation } = require('./pet-store.cjs');

function createDesktopPet({ app, BrowserWindow, Menu, ipcMain, session, screen, getMainWindow, showMainWindow, isAppUrl, isQuitting }) {
  const root = path.join(__dirname, '..');
  const store = createPetStore(app.getPath('userData'));
  const english = !app.getPreferredSystemLanguages().some(value => value.startsWith('zh'));
  const t = (en, zh) => english ? en : zh;
  let pet, editor, messageWindow, messageTimer, disposed = false, error, drag, committing, frozen = false, flushing;
  let messageSize, messageLoaded = false, messageShown = false;
  let hovering = false;
  const forwardsMouseMoves = ['darwin', 'win32'].includes(process.platform);
  let operations = Promise.resolve();
  const listeners = new Set(), requests = new Map();
  const ownSession = session.fromPartition('lumior-desktop-pet');
  const html = path.join(root, 'pet', 'index.html');
  const allowed = new Set(['pet/index.html', 'pet/pet.css', 'pet/pet.js', 'pet/lumior-pet/lumior-pet.js',
    'pet/lumior-pet/pet-data.js', 'pet/lumior-pet/pet-data@2x.js', 'pet/lumior-pet/options.js', 'assets/ui-colors.css', 'assets/icon.png'].map(file => pathToFileURL(path.join(root, file)).href));
  ownSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ownSession.setPermissionCheckHandler(() => false);
  ownSession.webRequest.onBeforeRequest((details, callback) => {
    const contents = [pet, editor, messageWindow].filter(value => value && !value.isDestroyed()).map(value => value.webContents.id);
    const url = new URL(details.url); url.search = ''; url.hash = '';
    callback({ cancel: !contents.includes(details.webContentsId) || !allowed.has(url.href) || details.resourceType === 'subFrame' });
  });
  ownSession.on('will-download', event => event.preventDefault());
  const state = () => ({ supported: ['darwin', 'win32', 'linux'].includes(process.platform), enabled: !!pet && !pet.isDestroyed(), size: store.get().size, animation: store.get().animation, ...(error ? { error } : {}) });
  const publish = () => listeners.forEach(listener => listener(state()));
  const fail = () => { error = t('The desktop pet could not save its state. Your draft has been kept. Please retry.', '桌宠状态未能保存，草稿已保留，请重试。'); publish(); };
  function authorized(event, type) {
    const target = type === 'pet' ? pet : type === 'message' ? messageWindow : editor;
    if (!target || target.isDestroyed() || event.sender !== target.webContents || event.senderFrame !== target.webContents.mainFrame
      || event.senderFrame.url !== `${pathToFileURL(html).href}?view=${type}`) throw new Error('This action requires the desktop pet.');
  }
  const visibleArea = position => screen.getDisplayNearestPoint(position).workArea;
  function closeMessage() {
    clearTimeout(messageTimer); messageTimer = undefined;
    if (messageWindow && !messageWindow.isDestroyed()) messageWindow.destroy();
    messageWindow = undefined;
    messageSize = undefined; messageLoaded = false; messageShown = false;
  }
  function positionMessage() {
    if (!pet || pet.isDestroyed() || !messageWindow || messageWindow.isDestroyed()) return;
    const anchor = pet.getBounds(), area = visibleArea(anchor);
    const layout = petMessageLayout(anchor, area, messageSize || { width: 320, height: 120 });
    messageWindow.setBounds(layout.bounds);
    messageWindow.webContents.send('lumior:pet:message-layout', layout);
    return layout;
  }
  function presentMessage() {
    if (!messageLoaded || !messageSize || messageShown || !messageWindow || messageWindow.isDestroyed() || disposed || frozen) return;
    positionMessage(); messageWindow.showInactive(); messageShown = true;
    clearTimeout(messageTimer); messageTimer = setTimeout(closeMessage, 4000);
  }
  async function showSavedMessage() {
    closeMessage();
    if (!pet || pet.isDestroyed() || disposed || frozen || isQuitting()) return;
    const current = messageWindow = makeWindow('message', { ...pet.getBounds(), width: 320, height: 120 });
    current.setIgnoreMouseEvents(true);
    positionMessage();
    messageTimer = setTimeout(closeMessage, 5000);
    try {
      await current.loadFile(html, { query: { view: 'message' } });
      if (messageWindow !== current || current.isDestroyed() || disposed || frozen) return;
      messageLoaded = true; presentMessage();
    } catch {
      // A notification failure must never turn a durably saved note into an error.
      if (messageWindow === current) closeMessage();
    }
  }
  const locate = () => {
    for (const target of [pet, editor]) {
      if (!target || target.isDestroyed()) continue;
      const bounds = target.getBounds(); target.setBounds(clampPetBounds(bounds, visibleArea(bounds), { width: bounds.width, height: bounds.height }));
    }
    positionMessage();
  };
  screen.on('display-removed', locate); screen.on('display-metrics-changed', locate);
  function makeWindow(type, bounds) {
    const target = new BrowserWindow({ ...bounds, title: type === 'note' ? t('Lumior Quick Note', 'Lumior 速记') : 'Lumior',
      frame: false, transparent: true, resizable: false, maximizable: false, fullscreenable: false,
      show: false, alwaysOnTop: true, skipTaskbar: true, acceptFirstMouse: true, hasShadow: type === 'note', focusable: type !== 'message',
      webPreferences: { preload: path.join(root, 'pet-preload.cjs'), session: ownSession, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: true },
    });
    target.setMenu(null);
    if (type === 'pet') {
      // Linux cannot forward mouse moves; keep input available there.
      target.setIgnoreMouseEvents(forwardsMouseMoves, { forward: true });
      for (const event of ['show', 'restore']) target.on(event, () => target.webContents.send('lumior:pet:visible', true));
      for (const event of ['hide', 'minimize']) target.on(event, () => target.webContents.send('lumior:pet:visible', false));
    }
    target.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    target.webContents.on('will-navigate', event => event.preventDefault());
    target.webContents.on('will-attach-webview', event => event.preventDefault());
    target.on('close', event => {
      if (disposed || isQuitting()) return;
      event.preventDefault();
      if (type === 'message') closeMessage();
      else if (type === 'note') target.webContents.send('lumior:pet:hide-request');
      else void setEnabled(false).catch(fail);
    });
    target.webContents.on('render-process-gone', () => {
      if (disposed) return;
      if (type === 'message') { closeMessage(); return; }
      if (type === 'note') { editor = undefined; target.destroy(); }
      else { pet = undefined; target.destroy(); void showMainWindow().catch(() => {}); }
      fail();
    });
    return target;
  }
  async function openEditor() {
    if (disposed || isQuitting() || frozen) return;
    closeMessage();
    if (editor && !editor.isDestroyed()) { editor.show(); editor.focus(); editor.webContents.send('lumior:pet:focus'); return; }
    const anchor = pet?.getBounds() || screen.getPrimaryDisplay().workArea;
    const area = visibleArea(anchor);
    const size = { width: Math.min(440, area.width), height: Math.min(410, area.height) };
    editor = makeWindow('note', clampPetBounds({ x: anchor.x - size.width + anchor.width, y: anchor.y - size.height - 12 }, area, size));
    const current = editor;
    try { await current.loadFile(html, { query: { view: 'note' } }); current.show(); current.focus(); }
    catch (cause) { if (editor === current) editor = undefined; current.destroy(); throw cause; }
  }
  function stopDrag() {
    if (!drag) return false;
    const moved = drag.moved;
    clearInterval(drag.timer); drag = undefined;
    if (pet && !pet.isDestroyed()) {
      pet.setIgnoreMouseEvents(forwardsMouseMoves && !hovering, { forward: true });
      const { x, y } = pet.getBounds(); void store.setPosition({ x, y }).catch(fail);
    }
    return moved;
  }
  function startDrag() {
    stopDrag();
    pet.setIgnoreMouseEvents(false);
    const origin = screen.getCursorScreenPoint(), bounds = pet.getBounds();
    const started = Date.now();
    drag = { moved: false, timer: setInterval(() => {
      if (!pet || pet.isDestroyed() || Date.now() - started > 30000) { stopDrag(); return; }
      const point = screen.getCursorScreenPoint(), dx = point.x - origin.x, dy = point.y - origin.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      if (drag.moved) { pet.setBounds(clampPetBounds({ x: bounds.x + dx, y: bounds.y + dy }, visibleArea(point), { width: bounds.width, height: bounds.height })); positionMessage(); }
    }, 16) };
  }
  function setEnabled(enabled) {
    const work = operations.then(async () => {
      if (disposed || frozen || isQuitting()) throw new Error('Lumior is closing.');
      if (enabled && (!pet || pet.isDestroyed())) {
        const area = screen.getPrimaryDisplay().workArea;
        const point = store.get().position || { x: area.x + area.width - 136, y: area.y + area.height - 144 };
        hovering = false;
        pet = makeWindow('pet', clampPetBounds(point, visibleArea(point), petWindowSize(store.get().size)));
        try { await pet.loadFile(html, { query: { view: 'pet' } }); await store.setEnabled(true); pet.showInactive(); }
        catch (cause) { pet.destroy(); pet = undefined; throw cause; }
      } else if (!enabled) {
        if (editor && !editor.isDestroyed()) await flushEditor();
        await store.setEnabled(false);
        // Keep a way back to settings even when the main window was closed.
        await showMainWindow();
        stopDrag(); closeMessage(); pet?.destroy(); pet = undefined; editor?.hide();
      }
      error = undefined; publish(); return state();
    });
    operations = work.catch(() => {});
    return work;
  }
  function setSize(size) {
    if (!validPetSize(size)) return Promise.reject(new Error('Invalid pet size.'));
    const work = operations.then(async () => {
      if (disposed || frozen || isQuitting()) throw new Error('Lumior is closing.');
      stopDrag();
      const current = pet && !pet.isDestroyed() ? pet.getBounds() : undefined;
      const bounds = current ? clampPetBounds(current, visibleArea(current), petWindowSize(size)) : undefined;
      await store.setSize(size, bounds);
      if (bounds && pet && !pet.isDestroyed()) {
        pet.setBounds(bounds);
        positionMessage();
      }
      error = undefined; publish(); return state();
    });
    operations = work.catch(() => {});
    return work;
  }
  function setAnimation(value) {
    if (!validAnimation(value)) return Promise.reject(new Error('Invalid animation settings.'));
    const work = operations.then(async () => {
      if (disposed || frozen || isQuitting()) throw new Error('Lumior is closing.');
      const next = await store.setAnimation(value);
      if (pet && !pet.isDestroyed()) pet.webContents.send('lumior:pet:animation', next.animation);
      error = undefined; publish(); return state();
    });
    operations = work.catch(() => {}); return work;
  }
  function blink() {
    if (!disposed && !frozen && pet && !pet.isDestroyed()) pet.webContents.send('lumior:pet:blink');
  }
  async function requestSave(draft) {
    const images = await Promise.all(draft.images.map(i => store.readImage(draft.id, i.id)));
    const main = getMainWindow();
    if (!main || main.isDestroyed()) return Promise.reject(new Error('Open Lumior and retry saving.'));
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(false), 30000);
      const finish = saved => {
        clearTimeout(timer); requests.delete(requestId);
        if (saved) resolve(); else reject(new Error('The workspace has not confirmed saving. Retry with this draft.'));
      };
      requests.set(requestId, { contents: main.webContents, finish });
      main.webContents.send('lumior:pet:save-request', { requestId, note: { id: draft.id, title: draft.title, body: draft.body, images } });
    });
  }
  const saveResult = (event, result) => {
    const request = requests.get(result?.requestId);
    if (!request || event.sender !== request.contents || event.senderFrame !== request.contents.mainFrame || !isAppUrl(event.senderFrame.url)) return;
    request.finish(result.saved === true);
  };
  ipcMain.on('lumior:pet:save-result', saveResult);
  async function commit() {
    if (committing) return committing;
    committing = (async () => {
      const { draft } = await store.beginSave();
      await requestSave(draft);
      const next = (await store.completeSave(draft.id)).draft;
      if (editor && !editor.isDestroyed()) editor.hide();
      void showSavedMessage().catch(() => {});
      return next;
    })();
    try { return await committing; } finally { committing = undefined; }
  }
  async function flushEditor() {
    if (!editor || editor.isDestroyed()) return store.settle();
    if (flushing) return flushing.promise;
    const id = randomUUID();
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { flushing = undefined; reject(new Error('The quick note has not finished saving its draft.')); }, 5000);
      flushing = { id, finish: ok => { clearTimeout(timer); flushing = undefined; if (ok) resolve(); else reject(new Error('The quick note draft could not be saved.')); } };
    });
    flushing.promise = promise;
    editor.webContents.send('lumior:pet:flush', { id, frozen });
    return promise;
  }
  const flushResult = (event, result) => {
    try { authorized(event, 'note'); } catch { return; }
    if (flushing?.id === result?.id) flushing.finish(result.saved === true);
  };
  ipcMain.on('lumior:pet:flush-result', flushResult);
  ipcMain.handle('lumior:pet:action', async (event, action, payload, ...extra) => {
    if (extra.length) throw new Error('Unexpected desktop pet options.');
    const type = event.sender === pet?.webContents ? 'pet' : event.sender === messageWindow?.webContents ? 'message' : 'note'; authorized(event, type);
    if (type === 'message') {
      if (action === 'get') return { english, message: t('Saved to Home for you', '已经为你保存到首页'), layout: positionMessage() };
      if (action === 'message-size') {
        if (!payload || Object.keys(payload).some(key => !['width', 'height'].includes(key))
          || !Number.isSafeInteger(payload.width) || payload.width < 48 || payload.width > 320
          || !Number.isSafeInteger(payload.height) || payload.height < 48 || payload.height > 480) throw new Error('Invalid message size.');
        messageSize = { width: payload.width, height: payload.height };
        const layout = positionMessage(); presentMessage(); return layout;
      }
      throw new Error('The save notification is read-only.');
    }
    if (action === 'get') return { draft: store.get().draft, animation: store.get().animation, english, frozen };
    if (type === 'pet') {
      if (action === 'hover') {
        if (typeof payload !== 'boolean') throw new Error('Invalid pet hover state.');
        hovering = payload;
        if (!drag) pet.setIgnoreMouseEvents(forwardsMouseMoves && !hovering, { forward: true });
        return;
      }
      if (action === 'drag-start') { if (!frozen) startDrag(); return; }
      if (action === 'drag-end') return stopDrag();
      if (action === 'open') return openEditor();
      if (action === 'menu') {
        stopDrag();
        Menu.buildFromTemplate([
          { label: t('Quick note', '速记'), click: () => void openEditor().catch(fail) },
          { label: t('Open Lumior', '打开 Lumior'), click: () => void showMainWindow().catch(fail) },
          { type: 'separator' },
          { label: t('Hide desktop pet', '隐藏桌宠'), click: () => void setEnabled(false).catch(fail) },
        ]).popup({ window: pet }); return;
      }
    } else {
      // Flush remains allowed during quit so the final keystroke is retained.
      if (action === 'draft') return (await store.updateDraft(payload)).draft;
      if (action === 'image-read') {
        const image = await store.readImage(payload?.draftId, payload?.id);
        return `data:${image.type};base64,${image.bytes.toString('base64')}`;
      }
      // An in-flight paste may finish during quit; flush waits for its durable write.
      if (action === 'image-add') return (await store.addImage(payload)).draft;
      if (frozen || isQuitting()) throw new Error('Lumior is closing.');
      if (action === 'image-remove') return (await store.removeImage(payload)).draft;
      if (action === 'save') return commit();
      if (action === 'hide') { await store.updateDraft(payload); editor.hide(); return; }
      if (action === 'main') return showMainWindow();
    }
    throw new Error('Unknown desktop pet action.');
  });
  return {
    getState: state, setEnabled, setSize, setAnimation, blink, openEditor,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    async init() { try { await store.load(); if (store.get().enabled) await setEnabled(true); } catch { fail(); } },
    async prepareQuit() { frozen = true; stopDrag(); closeMessage(); await operations; await flushEditor(); if (committing) await committing; await store.settle(); },
    resume() { frozen = false; if (editor && !editor.isDestroyed()) editor.webContents.send('lumior:pet:resume'); },
    async dispose() {
      if (disposed) return store.settle();
      disposed = true; stopDrag(); closeMessage();
      pet?.destroy(); editor?.destroy();
      for (const request of requests.values()) request.finish(false);
      ipcMain.removeHandler('lumior:pet:action');
      ipcMain.removeListener('lumior:pet:save-result', saveResult); ipcMain.removeListener('lumior:pet:flush-result', flushResult);
      screen.removeListener('display-removed', locate); screen.removeListener('display-metrics-changed', locate);
      await store.settle();
    },
  };
}
module.exports = { createDesktopPet };
