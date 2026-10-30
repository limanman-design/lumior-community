'use strict';
/* oxlint-disable typescript/no-require-imports -- Electron sandboxed preload. */
const { contextBridge, ipcRenderer } = require('electron');
const listen = (channel, handler) => {
  if (typeof handler !== 'function') throw new Error('An event handler is required.');
  const listener = (_event, data) => handler(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld('lumiorPet', Object.freeze({
  get: () => ipcRenderer.invoke('lumior:pet:action', 'get'),
  open: () => ipcRenderer.invoke('lumior:pet:action', 'open'),
  menu: () => ipcRenderer.invoke('lumior:pet:action', 'menu'),
  startDrag: () => ipcRenderer.invoke('lumior:pet:action', 'drag-start'),
  stopDrag: () => ipcRenderer.invoke('lumior:pet:action', 'drag-end'),
  hover: on => ipcRenderer.invoke('lumior:pet:action', 'hover', on),
  onVisible: handler => listen('lumior:pet:visible', handler),
  onAnimation: handler => listen('lumior:pet:animation', handler),
  onBlink: handler => listen('lumior:pet:blink', handler),
  addImage: value => ipcRenderer.invoke('lumior:pet:action', 'image-add', value),
  removeImage: value => ipcRenderer.invoke('lumior:pet:action', 'image-remove', value),
  readImage: value => ipcRenderer.invoke('lumior:pet:action', 'image-read', value),
  draft: value => ipcRenderer.invoke('lumior:pet:action', 'draft', value),
  save: () => ipcRenderer.invoke('lumior:pet:action', 'save'),
  hide: value => ipcRenderer.invoke('lumior:pet:action', 'hide', value),
  main: () => ipcRenderer.invoke('lumior:pet:action', 'main'),
  onHide: handler => listen('lumior:pet:hide-request', handler),
  onResume: handler => listen('lumior:pet:resume', handler),
  onFocus: handler => listen('lumior:pet:focus', handler),
  onMessageLayout: handler => listen('lumior:pet:message-layout', handler),
  resizeMessage: size => ipcRenderer.invoke('lumior:pet:action', 'message-size', size),
  onFlush: handler => listen('lumior:pet:flush', async request => {
    try { await handler(request.frozen === true); ipcRenderer.send('lumior:pet:flush-result', { id: request.id, saved: true }); }
    catch { ipcRenderer.send('lumior:pet:flush-result', { id: request.id, saved: false }); }
  }),
}));
