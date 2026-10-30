import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { addDesktopQuickNote, prepareDesktopQuickNote } from '../app/desktop-quick-note.ts';
import { serializeWorkspace, fileReferences, releaseFileUrls } from '../app/workspace-assets.ts';
import { syncWorkspaceFiles, projectWorkspaceFiles } from '../app/workspace-files.ts';
import { readWorkspace } from '../app/workspace-store.ts';

const require = createRequire(import.meta.url);
const { createPetStore, clampPetBounds, petMessageLayout } = require('../desktop/runtime/pet-store.cjs');
const { createDesktopPet } = require('../desktop/runtime/desktop-pet.cjs');
const draftId = '3bc775d3-1965-4e7d-8b2f-fd5a4ef320e0';
const animationDefaults = require('../desktop/runtime/pet-options.json').defaults;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS24AAAAASUVORK5CYII=', 'base64');
const withDirectory = async callback => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'lumior-pet-'));
  try { await callback(directory); } finally { await fs.rm(directory, { recursive: true, force: true }); }
};

void test('quick notes are root NotePages with real timestamps and immediately appear in recents after reload', () => {
  const now = Date.UTC(2026, 9, 27, 14);
  const files = addDesktopQuickNote(syncWorkspaceFiles(undefined, []), { id: draftId, title: '桌面灵感', body: '第一行\n第二行' }, now);
  const snapshot = readWorkspace(JSON.stringify({ version: 1, boards: [], deletedBoards: [], activeId: '', nextUntitledIndex: 1, files }));
  const [item] = projectWorkspaceFiles(snapshot.files, []);
  assert.equal(item.kind, 'notePage'); assert.equal(item.entry.folderId, null);
  assert.equal(item.content.card.body, '第一行\n第二行'); assert.equal(item.lastOpenedAt, now); assert.equal(item.updatedAt, now);
  const retry = addDesktopQuickNote(snapshot.files, { id: draftId, title: '桌面灵感', body: '第一行\n第二行' }, now + 1000);
  assert.equal(retry, snapshot.files); assert.equal(retry.contents.length, 1);
});
void test('lost acknowledgements never resurrect recycled notes or overwrite later edits', () => {
  const request = { id: draftId, title: '', body: '自动提取的标题\n正文' };
  const files = addDesktopQuickNote(syncWorkspaceFiles(undefined, []), request);
  assert.equal(files.contents[0].card.title, '自动提取的标题');
  files.contents[0].card.body = 'Edited in main';
  assert.equal(addDesktopQuickNote(files, request).contents[0].card.body, 'Edited in main');
  const deleted = { ...files, contents: [], entries: [], deletedContentIds: [`pet-${draftId}`] };
  assert.equal(addDesktopQuickNote(deleted, request), deleted);
  for (const invalid of [{ ...request, id: '../bad' }, { ...request, body: ' ' }, { ...request, title: 'x'.repeat(201) }]) assert.throws(() => addDesktopQuickNote(files, invalid));
});
void test('draft is durable across hide/restart; failed writes preserve the previous file and can retry', async () => withDirectory(async directory => {
  let broken = false;
  const storage = { ...fs, rename: (...args) => broken ? Promise.reject(new Error('Disk full')) : fs.rename(...args) };
  const store = createPetStore(directory, storage); await store.load();
  const initial = store.get().draft;
  await store.updateDraft({ ...initial, title: '草稿', body: '保留这句' });
  await store.setEnabled(true); await store.setEnabled(false);
  const reopened = createPetStore(directory); await reopened.load(); assert.equal(reopened.get().draft.body, '保留这句');
  broken = true;
  await assert.rejects(store.updateDraft({ ...initial, body: '未写入' }));
  assert.equal(store.get().draft.body, '保留这句');
  assert.equal(JSON.parse(await fs.readFile(path.join(directory, 'desktop-pet.json'))).draft.body, '保留这句');
  broken = false; await store.updateDraft({ ...initial, body: '重试成功' });
  assert.equal(store.get().draft.body, '重试成功');
}));
void test('pending save locks its contents and ID across restart until workspace confirms persistence', async () => withDirectory(async directory => {
  const store = createPetStore(directory); await store.load();
  const draft = { ...store.get().draft, body: 'Only one note' }; await store.updateDraft(draft); await store.beginSave();
  const reopened = createPetStore(directory); await reopened.load();
  assert.equal(reopened.get().draft.id, draft.id); assert.equal(reopened.get().draft.pending, true);
  await assert.rejects(reopened.updateDraft({ ...draft, body: 'Must not lose this edit' }));
  await reopened.updateDraft(draft); await reopened.completeSave(draft.id);
  assert.notEqual(reopened.get().draft.id, draft.id); assert.equal(reopened.get().draft.body, '');
  await assert.rejects(reopened.updateDraft(draft), /Stale/);
}));
void test('damaged draft is not silently overwritten by settings or a new draft', async () => withDirectory(async directory => {
  const file = path.join(directory, 'desktop-pet.json'); await fs.writeFile(file, '{broken');
  const store = createPetStore(directory); await assert.rejects(store.load()); await assert.rejects(store.setEnabled(true));
  assert.equal(await fs.readFile(file, 'utf8'), '{broken');
}));
void test('pet and editor remain on screen after monitor removal, including negative monitor coordinates', () => {
  assert.deepEqual(clampPetBounds({ x: 4000, y: -400 }, { x: -1920, y: 24, width: 1920, height: 1056 }), { x: -104, y: 24, width: 104, height: 112 });
  assert.deepEqual(clampPetBounds({ x: -200, y: 999 }, { x: 0, y: 0, width: 800, height: 600 }, { width: 440, height: 410 }), { x: 0, y: 190, width: 440, height: 410 });
});
void test('measured messages keep their tail on the pet and fit the screen at every edge', () => {
  const area = { x: -1440, y: 24, width: 1440, height: 900 };
  for (const x of [-1440, -800, -104]) for (const y of [24, 400, 812]) {
    const anchor = { x, y, width: 104, height: 112 };
    for (const measured of [{ width: 98, height: 66 }, { width: 176, height: 66 }, { width: 320, height: 126 }]) {
      const layout = petMessageLayout(anchor, area, measured);
      assert.equal(layout.bounds.width, measured.width); assert.equal(layout.bounds.height, measured.height);
      assert.ok(layout.bounds.x >= area.x && layout.bounds.x + layout.bounds.width <= area.x + area.width);
      assert.ok(layout.bounds.y >= area.y && layout.bounds.y + layout.bounds.height <= area.y + area.height);
      assert.equal(layout.placement, y === 24 ? 'below' : 'above');
      assert.equal(layout.bounds.x + 8 + layout.tailX, anchor.x + anchor.width / 2);
    }
  }
});

async function fixture(directory) {
  const windows = [], handlers = new Map(); const ipcMain = new EventEmitter();
  ipcMain.handle = (channel, handler) => handlers.set(channel, handler); ipcMain.removeHandler = channel => handlers.delete(channel);
  const own = new EventEmitter(); own.webRequest = { onBeforeRequest: callback => { own.filter = callback; } };
  own.setPermissionRequestHandler = callback => { own.permission = callback; }; own.setPermissionCheckHandler = callback => { own.check = callback; };
  class Window extends EventEmitter {
    constructor(options) { super(); this.options = options; this.bounds = { ...options }; this.webContents = new EventEmitter();
      Object.assign(this.webContents, { id: windows.length + 1, mainFrame: { url: '' }, setWindowOpenHandler: handler => { this.openHandler = handler; }, send: (channel, data) => { this.webContents.emit('sent', channel, data); } }); windows.push(this); }
    isDestroyed() { return !!this.destroyed; } destroy() { this.destroyed = true; } setMenu() {} focus() {} show() { this.visible = true; } showInactive() { this.show(); } hide() { this.visible = false; }
    setIgnoreMouseEvents(value, options) { this.ignoreMouse = value; this.ignoreOptions = options; }
    setBounds(value) { this.bounds = value; } getBounds() { return this.bounds; }
    async loadFile(file, options) { this.webContents.mainFrame.url = `${pathToFileURL(file).href}?view=${options.query.view}`; }
  }
  const screen = new EventEmitter(); screen.getPrimaryDisplay = () => ({ workArea: { x: 0, y: 24, width: 1440, height: 900 } }); screen.getDisplayNearestPoint = screen.getPrimaryDisplay;
  let cursor = { x: 200, y: 200 };
  screen.getCursorScreenPoint = () => cursor;
  const main = { isDestroyed: () => false, webContents: new EventEmitter() };
  main.webContents.mainFrame = { url: 'http://127.0.0.1:43271/' }; main.webContents.send = (channel, value) => main.webContents.emit(channel, value);
  let shown = 0;
  const controller = createDesktopPet({ app: { getPath: () => directory, getPreferredSystemLanguages: () => ['zh-CN'] }, BrowserWindow: Window,
    Menu: { buildFromTemplate: () => ({ popup() {} }) }, session: { fromPartition: () => own }, screen, ipcMain,
    getMainWindow: () => main, showMainWindow: async () => { shown++; }, isAppUrl: value => value.startsWith('http://127.0.0.1:43271/'), isQuitting: () => false });
  const event = target => ({ sender: target.webContents, senderFrame: target.webContents.mainFrame });
  const action = (target, command, value) => handlers.get('lumior:pet:action')(event(target), command, value);
  await controller.init(); await controller.setEnabled(true);
  return { controller, windows, own, main, ipcMain, action, event, setCursor: point => { cursor = point; }, get shown() { return shown; } };
}
void test('pet sandbox permits only its own static assets and its main frame, no network, workspace or AI bridge', async () => withDirectory(async directory => {
  const f = await fixture(directory);
  try {
    const pet = f.windows[0];
    assert.equal(pet.options.webPreferences.nodeIntegration, false); assert.equal(pet.options.webPreferences.sandbox, true); assert.equal(f.own.check(), false);
    assert.equal(pet.options.acceptFirstMouse, true, 'A background pet must open on the first click on macOS.');
    for (const url of ['https://example.com/', 'http://127.0.0.1:43271/api/ai', 'file:///etc/passwd']) f.own.filter({ url, webContentsId: pet.webContents.id, resourceType: 'xhr' }, result => assert.equal(result.cancel, true));
    f.own.filter({ url: pet.webContents.mainFrame.url, webContentsId: pet.webContents.id, resourceType: 'mainFrame' }, result => assert.equal(result.cancel, false));
    for (const asset of ['lumior-pet.js', 'pet-data.js', 'pet-data@2x.js', 'options.js']) {
      const url = new URL(`lumior-pet/${asset}`, pet.webContents.mainFrame.url).href;
      f.own.filter({ url, webContentsId: pet.webContents.id, resourceType: 'script' }, result => assert.equal(result.cancel, false));
      f.own.filter({ url, webContentsId: 9999, resourceType: 'script' }, result => assert.equal(result.cancel, true));
    }
    await assert.rejects(f.action(f.main, 'get'));
    await assert.rejects(f.action(pet, 'save'));
    await f.action(pet, 'open'); const editor = f.windows[1];
    await assert.rejects(f.action(editor, 'drag-start'));
    const frame = editor.webContents.mainFrame; editor.webContents.mainFrame = { url: 'https://example.com/' };
    await assert.rejects(f.action(editor, 'get')); editor.webContents.mainFrame = frame;
  } finally { await f.controller.dispose(); }
}));
void test('character hover controls click-through, dragging holds input, and only the pet can change it', async () => withDirectory(async directory => {
  const f = await fixture(directory);
  try {
    const pet = f.windows[0], forwards = ['darwin', 'win32'].includes(process.platform);
    const originalBounds = { ...pet.bounds };
    assert.equal(pet.ignoreMouse, forwards);
    await f.action(pet, 'hover', true); assert.equal(pet.ignoreMouse, false);
    await f.action(pet, 'drag-start');
    await f.action(pet, 'hover', false); assert.equal(pet.ignoreMouse, false, 'Do not lose the mouse release while dragging.');
    assert.equal(await f.action(pet, 'drag-end'), false);
    assert.equal(pet.ignoreMouse, forwards); assert.deepEqual(pet.ignoreOptions, { forward: true });
    assert.deepEqual(pet.bounds, originalBounds, 'Hover does not move or resize the existing pet.');
    for (const invalid of [undefined, 'true', {}, 1]) await assert.rejects(f.action(pet, 'hover', invalid));
    await f.action(pet, 'open'); await assert.rejects(f.action(f.windows[1], 'hover', true));
    const visibility = [];
    pet.webContents.on('sent', (channel, visible) => { if (channel === 'lumior:pet:visible') visibility.push(visible); });
    for (const event of ['hide', 'show', 'minimize', 'restore']) pet.emit(event);
    assert.deepEqual(visibility, [false, true, false, true]);
  } finally { await f.controller.dispose(); }
}));
void test('only a trusted workspace acknowledgement clears the draft, and failed save can retry once', async () => withDirectory(async directory => {
  const f = await fixture(directory);
  try {
    await f.action(f.windows[0], 'open'); const editor = f.windows[1];
    const { draft } = await f.action(editor, 'get'); await f.action(editor, 'draft', { ...draft, body: 'Preserve me' });
    f.main.webContents.once('lumior:pet:save-request', request => {
      f.ipcMain.emit('lumior:pet:save-result', f.event(f.windows[0]), { requestId: request.requestId, saved: true });
      f.ipcMain.emit('lumior:pet:save-result', f.event(f.main), { requestId: request.requestId, saved: false });
    });
    await assert.rejects(f.action(editor, 'save'));
    assert.equal((await f.action(editor, 'get')).draft.body, 'Preserve me');
    assert.equal(editor.visible, true, 'A failed save keeps the editor open.');
    assert.equal(f.windows.length, 2, 'A failed save must never show a success bubble.');
    f.main.webContents.once('lumior:pet:save-request', request => {
      assert.equal(request.note.id, draft.id);
      f.ipcMain.emit('lumior:pet:save-result', f.event(f.main), { requestId: request.requestId, saved: true });
    });
    const cleared = await f.action(editor, 'save'); assert.equal(cleared.body, ''); assert.notEqual(cleared.id, draft.id);
    assert.equal(editor.visible, false, 'Only a durable save closes the editor.');
    const message = f.windows[2];
    assert.ok(message.webContents.mainFrame.url.endsWith('?view=message'));
    assert.notEqual(message.visible, true, 'The bubble stays hidden until its rendered text is measured.');
    assert.equal(message.options.focusable, false); assert.equal(message.ignoreMouse, true);
    const initialMessage = await f.action(message, 'get');
    assert.equal(initialMessage.english, false); assert.equal(initialMessage.message, '已经为你保存到首页');
    assert.equal(initialMessage.draft, undefined);
    await f.action(message, 'message-size', { width: 176, height: 66 });
    assert.equal(message.visible, true); assert.equal(message.bounds.width, 176); assert.equal(message.bounds.height, 66);
    await f.action(message, 'message-size', { width: 320, height: 106 });
    assert.equal(message.bounds.height, 106);
    await assert.rejects(f.action(editor, 'message-size', { width: 176, height: 66 }));
    for (const invalid of [{ width: NaN, height: 66 }, { width: 321, height: 66 }, { width: 176, height: 9999 }, { width: 176, height: 66, x: -999 }]) await assert.rejects(f.action(message, 'message-size', invalid));
    await assert.rejects(f.action(message, 'save'), /read-only/);
    await f.action(f.windows[0], 'open');
    assert.equal(message.destroyed, true, 'Reopening quick note dismisses the old message.');
    assert.equal(editor.visible, true); assert.equal((await f.action(editor, 'get')).draft.body, '');
    editor.webContents.on('sent', (channel, request) => { if (channel === 'lumior:pet:flush') f.ipcMain.emit('lumior:pet:flush-result', f.event(editor), { id: request.id, saved: true }); });
    await f.controller.prepareQuit(); await assert.rejects(f.action(editor, 'save'), /closing/);
    f.controller.resume(); await f.controller.setEnabled(false); assert.equal(f.shown, 1); assert.equal(f.controller.getState().enabled, false);
  } finally { await f.controller.dispose(); }
}));

void test('size preferences survive restart, legacy drafts default to 100%, and failed writes keep the old size', async () => withDirectory(async directory => {
  let broken = false;
  const storage = { ...fs, rename: (...args) => broken ? Promise.reject(new Error('Disk full')) : fs.rename(...args) };
  const store = createPetStore(directory, storage); await store.load();
  const draft = { ...store.get().draft, body: 'Keep my draft' };
  await store.updateDraft(draft); await store.setSize(225);
  const reopened = createPetStore(directory); await reopened.load();
  assert.equal(reopened.get().size, 225); assert.deepEqual(reopened.get().draft, draft);
  for (const size of [74, 301, 100.5, NaN, '200']) await assert.rejects(store.setSize(size));
  broken = true; await assert.rejects(store.setSize(300)); assert.equal(store.get().size, 225);
  const legacy = reopened.get(); delete legacy.size;
  await fs.writeFile(path.join(directory, 'desktop-pet.json'), JSON.stringify(legacy));
  const migrated = createPetStore(directory); await migrated.load();
  assert.equal(migrated.get().size, 100); assert.deepEqual(migrated.get().draft, draft);
}));
void test('resizing stays on screen, preserves dimensions while dragging and restores the chosen size', async t => withDirectory(async directory => {
  const f = await fixture(directory);
  try {
    const pet = f.windows[0];
    await f.controller.setSize(300);
    assert.equal(pet.bounds.width, 312); assert.equal(pet.bounds.height, 336);
    assert.ok(pet.bounds.x + 312 <= 1440); assert.ok(pet.bounds.y + 336 <= 924);
    const before = pet.getBounds();
    t.mock.timers.enable({ apis: ['setInterval'] });
    await f.action(pet, 'drag-start'); f.setCursor({ x: 160, y: 180 }); t.mock.timers.tick(16);
    assert.equal(await f.action(pet, 'drag-end'), true);
    assert.equal(pet.bounds.width, 312); assert.equal(pet.bounds.height, 336);
    assert.equal(pet.bounds.x, before.x - 40); assert.equal(pet.bounds.y, before.y - 20);
    await f.controller.setEnabled(false); await f.controller.setSize(150); await f.controller.setEnabled(true);
    assert.equal(f.windows.at(-1).bounds.width, 156); assert.equal(f.windows.at(-1).bounds.height, 168);
    await f.controller.prepareQuit(); await assert.rejects(f.controller.setSize(100), /closing/);
  } finally { t.mock.timers.reset(); await f.controller.dispose(); }
}));

void test('image-only drafts persist through restart; metadata failures preserve files and deletes commit before cleanup', async () => withDirectory(async directory => {
  let broken = false;
  const storage = { ...fs, rename: (...args) => broken ? Promise.reject(new Error('Disk full')) : fs.rename(...args) };
  const store = createPetStore(directory, storage); await store.load();
  const id = store.get().draft.id;
  await store.addImage({ draftId: id, name: '截图.png', type: 'image/png', bytes: png });
  const [meta] = store.get().draft.images;
  const reopened = createPetStore(directory); await reopened.load();
  assert.deepEqual((await reopened.readImage(id, meta.id)).bytes, png);
  assert.equal((await fs.readFile(path.join(directory, 'desktop-pet.json'), 'utf8')).includes(png.toString('base64')), false);
  broken = true;
  await assert.rejects(store.removeImage({ draftId: id, id: meta.id }));
  assert.deepEqual((await store.readImage(id, meta.id)).bytes, png);
  await assert.rejects(store.addImage({ draftId: id, name: 'second.png', type: 'image/png', bytes: png }));
  assert.equal(store.get().draft.images.length, 1);
  broken = false;
  await store.updateDraft({ id, title: '', body: 'Text does not replace image metadata', images: [] });
  assert.equal(store.get().draft.images.length, 1);
  await store.beginSave();
  await assert.rejects(store.removeImage({ draftId: id, id: meta.id }));
  await assert.rejects(store.addImage({ draftId: id, name: '', type: 'image/png', bytes: png }));
  await store.completeSave(id);
  assert.equal(store.get().draft.images.length, 0);
  assert.deepEqual(await fs.readdir(path.join(directory, 'desktop-pet-images')), []);
  await assert.rejects(store.readImage(id, meta.id));
}));
void test('image validation restricts type, count, bytes, active draft and referenced IDs', async () => withDirectory(async directory => {
  const store = createPetStore(directory); await store.load();
  const payload = { draftId: store.get().draft.id, name: 'image.png', type: 'image/png', bytes: png };
  for (const invalid of [{ ...payload, draftId }, { ...payload, type: 'image/svg+xml' }, { ...payload, bytes: Buffer.from('fake') }, { ...payload, bytes: Buffer.alloc(10 * 1024 * 1024 + 1) }]) await assert.rejects(store.addImage(invalid));
  for (let i = 0; i < 10; i++) await store.addImage(payload);
  await assert.rejects(store.addImage(payload), /limit/);
  await assert.rejects(store.readImage(payload.draftId, '../desktop-pet.json'));
  const [meta] = store.get().draft.images;
  await fs.unlink(path.join(directory, 'desktop-pet-images', `${meta.id}.bin`));
  await assert.rejects(store.readImage(payload.draftId, meta.id));
  assert.equal(store.get().draft.images.length, 10, 'Missing files do not silently discard draft references.');
}));
void test('image attachment save precedes root NotePage creation and retry uses stable file IDs', async () => {
  const request = { id: draftId, title: '', body: '', images: [{ id: '14419457-589d-4dd5-a75f-59dc3fdf94dd', name: '截图.png', type: 'image/png', size: png.length, bytes: png }] };
  const written = new Map();
  const write = async files => { for (const f of files) written.set(f.id, f); };
  await assert.rejects(prepareDesktopQuickNote(request, async () => { throw new Error('quota'); }));
  const prepared = await prepareDesktopQuickNote(request, write);
  const files = addDesktopQuickNote(syncWorkspaceFiles(undefined, []), prepared);
  assert.equal(files.contents[0].card.title, 'Image quick note');
  assert.equal(files.contents[0].card.blocks[0].type, 'image');
  assert.equal(fileReferences(serializeWorkspace(files)).length, 1);
  const again = await prepareDesktopQuickNote(request, write);
  assert.equal(addDesktopQuickNote(files, again), files); assert.equal(written.size, 1);
  assert.deepEqual(Buffer.from(await [...written.values()][0].blob.arrayBuffer()), png);
  releaseFileUrls();
});
void test('image save failure retains exact draft for retry, and only the note window can read images', async () => withDirectory(async directory => {
  const f = await fixture(directory);
  try {
    const pet = f.windows[0]; await f.action(pet, 'open'); const note = f.windows[1];
    const { draft } = await f.action(note, 'get');
    const payload = { draftId: draft.id, name: '剪贴板.png', type: 'image/png', bytes: png };
    await assert.rejects(f.action(pet, 'image-add', payload));
    const added = await f.action(note, 'image-add', payload);
    await assert.rejects(f.action(pet, 'image-read', { draftId: draft.id, id: added.images[0].id }));
    const delivered = [];
    let saved = false;
    f.main.webContents.on('lumior:pet:save-request', request => {
      delivered.push(request.note);
      f.ipcMain.emit('lumior:pet:save-result', f.event(f.main), { requestId: request.requestId, saved });
    });
    await assert.rejects(f.action(note, 'save'));
    assert.equal((await f.action(note, 'get')).draft.images.length, 1);
    await assert.rejects(f.action(note, 'image-remove', { draftId: draft.id, id: added.images[0].id }));
    saved = true; await f.action(note, 'save');
    assert.deepEqual(delivered[0], delivered[1]); assert.deepEqual(delivered[0].images[0].bytes, png);
    assert.equal((await f.action(note, 'get')).draft.images.length, 0);
  } finally { await f.controller.dispose(); }
}));
void test('animation settings validate ranges, persist and update the existing pet without moving it', async () => withDirectory(async directory => {
  const f = await fixture(directory);
  try {
    const pet = f.windows[0], bounds = { ...pet.bounds }, sent = [];
    pet.webContents.on('sent', (channel, value) => sent.push({ channel, value }));
    const next = { ...animationDefaults, breathAmp: 4, blinkMin: 3, blinkMax: 7, eyes: 'half', fps: 15 };
    for (const invalid of [{ ...next, breathPeriod: 0 }, { ...next, blinkMin: 10 }, { ...next, fps: 60 }, { ...next, eyes: 'bad' }, { ...next, extra: 1 }]) await assert.rejects(f.controller.setAnimation(invalid));
    await f.controller.setAnimation(next);
    assert.deepEqual(f.controller.getState().animation, next); assert.deepEqual(pet.bounds, bounds); assert.equal(f.windows.length, 1);
    assert.ok(sent.some(e => e.channel === 'lumior:pet:animation' && e.value.breathAmp === 4));
    f.controller.blink(); assert.ok(sent.some(e => e.channel === 'lumior:pet:blink'));
    const reopened = createPetStore(directory); await reopened.load(); assert.deepEqual(reopened.get().animation, next);
  } finally { await f.controller.dispose(); }
}));
