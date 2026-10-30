'use strict';
/* oxlint-disable typescript/no-require-imports -- Electron sandboxed preloads require a CommonJS entry. */
const { contextBridge, ipcRenderer } = require('electron');
let closeHandler, registeredSaveHandler = false, restoreEditing, quickNoteHandler;
ipcRenderer.on('lumior:pet:save-request', async (_event, request) => {
  if (typeof request?.requestId !== 'string') return;
  try {
    if (!quickNoteHandler || restoreEditing) throw new Error('The workspace is not ready.');
    await quickNoteHandler(request.note);
    ipcRenderer.send('lumior:pet:save-result', { requestId: request.requestId, saved: true });
  } catch { ipcRenderer.send('lumior:pet:save-result', { requestId: request.requestId, saved: false }); }
});
ipcRenderer.on('lumior:close-cancelled', () => { restoreEditing?.(); restoreEditing = undefined; });
ipcRenderer.on('lumior:prepare-close', async (_event, requestId) => {
  if (typeof requestId !== 'string') return;
  try {
    if (!closeHandler && registeredSaveHandler) throw new Error('The workspace is reloading.');
    if (!restoreEditing) {
      const body = document.body, inert = body?.inert;
      if (body) body.inert = true;
      restoreEditing = () => { if (body?.isConnected) body.inert = inert; };
    }
    await closeHandler?.();
    ipcRenderer.send('lumior:close-ready', { requestId, saved: true });
  } catch {
    restoreEditing?.(); restoreEditing = undefined;
    ipcRenderer.send('lumior:close-ready', { requestId, saved: false });
  }
});
contextBridge.exposeInMainWorld('lumiorDesktop', Object.freeze({
  platform: process.platform,
  getPetState: () => ipcRenderer.invoke('lumior:pet:get'),
  setPetEnabled: enabled => ipcRenderer.invoke('lumior:pet:enable', enabled),
  setPetSize: size => ipcRenderer.invoke('lumior:pet:size', size),
  setPetAnimation: value => ipcRenderer.invoke('lumior:pet:animation', value),
  blinkPet: () => ipcRenderer.invoke('lumior:pet:blink'),
  openPetQuickNote: () => ipcRenderer.invoke('lumior:pet:quick-note'),
  onPetState: handler => {
    if (typeof handler !== 'function') throw new Error('A pet state handler is required.');
    const listener = (_event, state) => handler(state);
    ipcRenderer.on('lumior:pet:state', listener);
    return () => ipcRenderer.removeListener('lumior:pet:state', listener);
  },
  onQuickNote: handler => {
    if (typeof handler !== 'function') throw new Error('A quick note save handler is required.');
    quickNoteHandler = handler;
    return () => { if (quickNoteHandler === handler) quickNoteHandler = undefined; };
  },
  getWindowPreferences: () => ipcRenderer.invoke('lumior:window:preferences'),
  setWindowCloseBehavior: behavior => ipcRenderer.invoke('lumior:window:close-behavior', behavior),
  openWindowMenu: request => ipcRenderer.invoke('lumior:window:menu', request),
  getWindowState: () => ipcRenderer.invoke('lumior:window:state'),
  performWindowAction: action => ipcRenderer.invoke('lumior:window:action', action),
  onWindowState: handler => {
    if (typeof handler !== 'function') throw new Error('A window state handler is required.');
    const listener = (_event, state) => { if (typeof state?.maximized === 'boolean' && typeof state?.fullscreen === 'boolean') handler(state); };
    ipcRenderer.on('lumior:window:state', listener);
    return () => ipcRenderer.removeListener('lumior:window:state', listener);
  },
  getSystemLocale: () => ipcRenderer.invoke('lumior:locale:get'),
  getClipboardImages: () => ipcRenderer.invoke('lumior:clipboard:images'),
  getAiSettings: () => ipcRenderer.invoke('lumior:ai:get'),
  saveAiSettings: settings => ipcRenderer.invoke('lumior:ai:save', settings),
  activateAiTrial: code => ipcRenderer.invoke('lumior:ai:trial:activate', code),
  setAiUsageMode: mode => ipcRenderer.invoke('lumior:ai:usage-mode', mode),
  clearAiTrial: () => ipcRenderer.invoke('lumior:ai:trial:clear'),
  getUpdateState: () => ipcRenderer.invoke('lumior:update:get'),
  checkForUpdates: () => ipcRenderer.invoke('lumior:update:check'),
  installUpdate: () => ipcRenderer.invoke('lumior:update:install'),
  getWallpaperState: () => ipcRenderer.invoke('lumior:wallpaper:get'),
  setWallpaperEnabled: enabled => ipcRenderer.invoke('lumior:wallpaper:enable', enabled),
  setWallpaperScene: scene => ipcRenderer.invoke('lumior:wallpaper:scene', scene),
  onWallpaperState: handler => {
    if (typeof handler !== 'function') throw new Error('A wallpaper state handler is required.');
    const listener = (_event, state) => handler(state);
    ipcRenderer.on('lumior:wallpaper:state', listener);
    return () => ipcRenderer.removeListener('lumior:wallpaper:state', listener);
  },
  onUpdateState: handler => {
    if (typeof handler !== 'function') throw new Error('An update handler is required.');
    const listener = (_event, state) => handler(state);
    ipcRenderer.on('lumior:update-state', listener);
    return () => ipcRenderer.removeListener('lumior:update-state', listener);
  },
  onBeforeClose: handler => {
    if (typeof handler !== 'function') throw new Error('A save handler is required.');
    closeHandler = handler;
    registeredSaveHandler = true;
    return () => { if (closeHandler === handler) closeHandler = undefined; };
  },
}));
