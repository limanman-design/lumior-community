'use strict';
/* oxlint-disable typescript/no-require-imports -- Electron main process helper. */
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');

const MAX_IMAGES = 20;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_BATCH_BYTES = 64 * 1024 * 1024;
const MAX_URL_BYTES = 128 * 1024;
const imageTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const macFileUrl = 'electron application/osclipboard;format="public.file-url"';

function imageType(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) return 'image/gif';
  return null;
}

function localImagePath(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'file:' || (url.hostname && url.hostname !== 'localhost') || url.username || url.password || url.search || url.hash) return null;
    const local = fileURLToPath(url);
    return !local.includes('\0') && path.isAbsolute(local) && /\.(png|jpe?g|webp|gif)$/i.test(local) ? local : null;
  } catch { return null; }
}

async function boundedImageFile(file) {
  // No arbitrary renderer-supplied paths, network shares, symlink targets,
  // directories or device files. Read only a bounded regular image file that
  // the OS clipboard explicitly offers; a cut operation never removes it.
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size <= 0) return null;
    if (stat.size > MAX_IMAGE_BYTES) throw new Error('Clipboard image exceeds 20 MiB.');
    const bytes = Buffer.alloc(stat.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset > stat.size) throw new Error('Clipboard image changed while being read.');
    return bytes.subarray(0, offset);
  } finally { await handle.close(); }
}

/** Electron 44 ClipboardItem API. Read only image formats / OS file URLs,
 * never ordinary clipboard text, HTML links or a path supplied by a caller.
 * https://www.electronjs.org/docs/latest/api/clipboard
 */
async function readClipboardImages(clipboard, { platform = process.platform } = {}) {
  const items = await clipboard.read();
  if (!Array.isArray(items) || items.length > 100) throw new Error('Too many clipboard items.');
  const result = [];
  let total = 0;
  const append = (bytes, name) => {
    const type = imageType(bytes);
    if (!type) return;
    if (result.length >= MAX_IMAGES) throw new Error('Paste at most 20 clipboard images at once.');
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error('Clipboard image exceeds 20 MiB.');
    if (total + bytes.length > MAX_BATCH_BYTES) throw new Error('Clipboard images exceed 64 MiB in total.');
    total += bytes.length;
    result.push({ name: name || `Pasted image ${result.length + 1}.${extensions[type]}`, type, bytes: new Uint8Array(bytes) });
  };
  for (const item of items) {
    // A single clipboard item often advertises several encodings of one image.
    const type = imageTypes.find(candidate => item.types.includes(candidate));
    if (!type) continue;
    const blob = await item.getType(type);
    if (blob.size > MAX_IMAGE_BYTES) throw new Error('Clipboard image exceeds 20 MiB.');
    if (total + blob.size > MAX_BATCH_BYTES) throw new Error('Clipboard images exceed 64 MiB in total.');
    append(Buffer.from(await blob.arrayBuffer()));
  }
  // Prefer bitmaps when the same clipboard also carries a source file URL.
  if (result.length) return result;
  const files = new Set();
  for (const item of items) {
    const type = platform === 'darwin' && item.types.includes(macFileUrl) ? macFileUrl : item.types.includes('text/uri-list') ? 'text/uri-list' : null;
    if (!type) continue;
    const blob = await item.getType(type);
    if (blob.size > MAX_URL_BYTES) throw new Error('Clipboard file list is too large.');
    let value = await blob.text();
    while (value.endsWith('\0')) value = value.slice(0, -1);
    for (const line of value.split(/\r?\n/)) {
      if (line.trim().startsWith('#')) continue;
      const file = localImagePath(line.trim());
      if (file) files.add(file);
    }
  }
  if (files.size > MAX_IMAGES) throw new Error('Paste at most 20 clipboard images at once.');
  for (const file of files) {
    const bytes = await boundedImageFile(file);
    if (bytes) append(bytes, path.basename(file));
  }
  return result;
}

module.exports = { readClipboardImages, localImagePath, MAX_IMAGES, MAX_IMAGE_BYTES, MAX_BATCH_BYTES };
