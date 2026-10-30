'use strict';
/* oxlint-disable typescript/no-require-imports -- Electron main uses CommonJS. */
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const animation = require('./pet-options.json');

const validAnimation = value => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === Object.keys(animation.defaults).length
  && Object.entries(animation.ranges).every(([key, [min, max]]) => Number.isFinite(value[key]) && value[key] >= min && value[key] <= max)
  && [15, 30].includes(value.fps) && ['auto', 'open', 'half', 'closed'].includes(value.eyes) && value.blinkMin <= value.blinkMax;
const imageTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_IMAGE = 10 * 1024 * 1024, MAX_TOTAL = 30 * 1024 * 1024, MAX_COUNT = 10;
const validImages = images => images === undefined || (Array.isArray(images) && images.length <= MAX_COUNT
  && images.every(i => i && validId(i.id) && typeof i.name === 'string' && i.name.length <= 200 && imageTypes.includes(i.type) && Number.isSafeInteger(i.size) && i.size > 0 && i.size <= MAX_IMAGE)
  && new Set(images.map(i => i.id)).size === images.length && images.reduce((sum, i) => sum + i.size, 0) <= MAX_TOTAL);
function validImageBytes(bytes, type) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_IMAGE) return false;
  const b = Buffer.from(bytes);
  return type === 'image/png' ? b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : type === 'image/jpeg' ? b[0] === 255 && b[1] === 216 && b[2] === 255
    : type === 'image/webp' ? b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP'
    : type === 'image/gif' && ['GIF87a', 'GIF89a'].includes(b.toString('ascii', 0, 6));
}

const validId = value => typeof value === 'string' && /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(value);
const validDraft = value => value && validId(value.id) && typeof value.title === 'string' && value.title.length <= 200 && typeof value.body === 'string' && value.body.length <= 100000 && typeof value.pending === 'boolean' && validImages(value.images);
const emptyDraft = () => ({ id: randomUUID(), title: '', body: '', images: [], pending: false });
const validPetSize = size => Number.isInteger(size) && size >= 75 && size <= 300;
const petWindowSize = (size = 100) => ({ width: Math.round(104 * size / 100), height: Math.round(112 * size / 100) });

function createPetStore(directory, storage = fs) {
  const file = path.join(directory, 'desktop-pet.json');
  const imageDirectory = path.join(directory, 'desktop-pet-images');
  const imageFile = id => path.join(imageDirectory, `${id}.bin`);
  let state = { enabled: false, position: null, size: 100, animation: { ...animation.defaults }, draft: emptyDraft() }, queue = Promise.resolve(), loadError;
  const get = () => structuredClone(state);
  const cleanup = async () => {
    try {
      const active = new Set(state.draft.images.map(i => `${i.id}.bin`));
      for (const name of await storage.readdir(imageDirectory)) {
        if (name.endsWith('.bin') && validId(name.slice(0, -4)) && !active.has(name)) await storage.unlink(path.join(imageDirectory, name)).catch(() => {});
      }
    } catch { /* Orphan cleanup must never fail an already durable save. */ }
  };
  const readImage = async (draftId, imageId) => {
    await queue;
    const meta = state.draft.id === draftId && state.draft.images.find(i => i.id === imageId);
    if (!meta) throw new Error('Unknown draft image.');
    const bytes = await storage.readFile(imageFile(meta.id));
    if (bytes.length !== meta.size || !validImageBytes(bytes, meta.type)) throw new Error('Draft image is unreadable.');
    return { ...meta, bytes };
  };
  const change = transform => {
    const job = queue.then(async () => {
      if (loadError) throw loadError;
      const next = await transform(get());
      await storage.mkdir(directory, { recursive: true });
      await storage.writeFile(`${file}.tmp`, JSON.stringify(next), { mode: 0o600 });
      await storage.rename(`${file}.tmp`, file);
      state = next;
      await cleanup();
      return get();
    });
    queue = job.catch(() => {});
    return job;
  };
  return {
    async load() {
      try {
        const saved = JSON.parse(await storage.readFile(file, 'utf8'));
        if (!validDraft(saved.draft) || typeof saved.enabled !== 'boolean') throw new Error('Saved pet draft is unreadable.');
        const position = saved.position && Number.isFinite(saved.position.x) && Number.isFinite(saved.position.y) ? saved.position : null;
        state = { enabled: saved.enabled, position, size: validPetSize(saved.size) ? saved.size : 100,
          animation: validAnimation(saved.animation) ? saved.animation : { ...animation.defaults }, draft: { ...saved.draft, images: saved.draft.images || [] } };
      } catch (error) {
        if (error.code !== 'ENOENT') { loadError = error; throw error; }
      }
      return get();
    },
    get,
    settle: () => queue,
    setEnabled: enabled => change(s => ({ ...s, enabled })),
    setPosition: position => change(s => ({ ...s, position })),
    setAnimation: value => {
      if (!validAnimation(value)) return Promise.reject(new Error('Invalid animation settings.'));
      const next = structuredClone(value);
      return change(s => ({ ...s, animation: next }));
    },
    readImage,
    addImage: payload => change(async s => {
      if (!payload || payload.draftId !== s.draft.id || s.draft.pending) throw new Error('Stale or locked draft.');
      if (!validImageBytes(payload.bytes, payload.type) || typeof payload.name !== 'string' || payload.name.length > 200) throw new Error('Invalid image.');
      const meta = { id: randomUUID(), name: payload.name, type: payload.type, size: payload.bytes.length };
      const images = [...s.draft.images, meta];
      if (!validImages(images)) throw new Error('Image limit reached.');
      await storage.mkdir(imageDirectory, { recursive: true });
      // Bytes become durable before the JSON is allowed to reference them.
      await storage.writeFile(imageFile(meta.id), payload.bytes, { mode: 0o600, flag: 'wx' });
      return { ...s, draft: { ...s.draft, images } };
    }),
    removeImage: payload => change(s => {
      if (!payload || payload.draftId !== s.draft.id || s.draft.pending || !s.draft.images.some(i => i.id === payload.id)) throw new Error('Stale or locked image.');
      return { ...s, draft: { ...s.draft, images: s.draft.images.filter(i => i.id !== payload.id) } };
    }),
    setSize: (size, position) => {
      if (!validPetSize(size)) return Promise.reject(new Error('Invalid pet size.'));
      if (position && (!Number.isFinite(position.x) || !Number.isFinite(position.y))) return Promise.reject(new Error('Invalid pet position.'));
      return change(s => ({ ...s, size, ...(position ? { position: { x: position.x, y: position.y } } : {}) }));
    },
    updateDraft: draft => change(s => {
      if (!validDraft({ ...draft, pending: false }) || draft.id !== s.draft.id) throw new Error('Stale or invalid draft.');
      if (s.draft.pending && (draft.title !== s.draft.title || draft.body !== s.draft.body)) throw new Error('Retry the pending save before editing.');
      return { ...s, draft: { ...s.draft, title: draft.title, body: draft.body } };
    }),
    beginSave: () => change(s => {
      if (!s.draft.title.trim() && !s.draft.body.trim() && !s.draft.images.length) throw new Error('Write something first.');
      return { ...s, draft: { ...s.draft, pending: true } };
    }),
    completeSave: id => change(s => {
      if (s.draft.id !== id || !s.draft.pending) throw new Error('Draft save changed.');
      return { ...s, draft: emptyDraft() };
    }),
  };
}

function clampPetBounds(position, area, size = { width: 104, height: 112 }) {
  return {
    x: Math.round(Math.max(area.x, Math.min(area.x + Math.max(0, area.width - size.width), position.x))),
    y: Math.round(Math.max(area.y, Math.min(area.y + Math.max(0, area.height - size.height), position.y))),
    ...size,
  };
}
function petMessageLayout(anchor, area, measured) {
  const maxWidth = Math.min(320, area.width), maxHeight = Math.min(480, area.height);
  const size = { width: Math.min(measured.width, maxWidth), height: Math.min(measured.height, maxHeight) };
  const above = anchor.y - size.height - 4 >= area.y;
  const bounds = clampPetBounds({ x: anchor.x + (anchor.width - size.width) / 2,
    y: above ? anchor.y - size.height - 4 : anchor.y + anchor.height + 4 }, area, size);
  // Tail coordinates are relative to the bubble, inside the 8 px shadow gutter.
  const tailX = Math.max(20, Math.min(size.width - 36, anchor.x + anchor.width / 2 - bounds.x - 8));
  return { bounds, placement: above ? 'above' : 'below', tailX, maxWidth, maxHeight };
}
module.exports = { createPetStore, clampPetBounds, petMessageLayout, validDraft, validPetSize, petWindowSize, validAnimation };
