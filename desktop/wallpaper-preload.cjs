'use strict';
/* oxlint-disable typescript/no-require-imports -- Electron sandboxed preloads require a CommonJS entry. */
const { contextBridge, ipcRenderer } = require('electron');
const validState = state => state && ['galaxy', 'shore'].includes(state.scene) && typeof state.paused === 'boolean';
const safeState = state => Object.freeze({ scene: state.scene, paused: state.paused });
contextBridge.exposeInMainWorld('lumiorWallpaper', Object.freeze({
  getState: async () => {
    const state = await ipcRenderer.invoke('lumior:wallpaper:get');
    if (!validState(state)) throw new Error('The wallpaper state is unavailable.');
    return safeState(state);
  },
  onState: handler => {
    if (typeof handler !== 'function') throw new Error('A wallpaper state handler is required.');
    const listener = (_event, state) => { if (validState(state)) handler(safeState(state)); };
    ipcRenderer.on('lumior:wallpaper:state', listener);
    return () => ipcRenderer.removeListener('lumior:wallpaper:state', listener);
  },
  ready: ok => {
    if (typeof ok !== 'boolean') throw new Error('A wallpaper readiness value is required.');
    ipcRenderer.send('lumior:wallpaper:ready', ok);
  },
}));
