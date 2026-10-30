import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { readClipboardImages, localImagePath, MAX_IMAGE_BYTES, MAX_BATCH_BYTES } = require('../desktop/runtime/clipboard-images.cjs');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const macFileUrl = 'electron application/osclipboard;format="public.file-url"';
const item = payloads => ({ types: Object.keys(payloads), getType: async type => payloads[type] });
const clipboard = (...items) => ({ read: async () => items });

test('prefers one bitmap encoding and does not read accompanying source file URLs', async () => {
  const data = item({ 'image/png': new Blob([png]), 'image/jpeg': new Blob([Buffer.from([255, 216, 255])]), [macFileUrl]: new Blob(['file:///private/nonexistent.png']) });
  const images = await readClipboardImages(clipboard(data), { platform: 'darwin' });
  assert.equal(images.length, 1);
  assert.equal(images[0].type, 'image/png');
  assert.deepEqual(Buffer.from(images[0].bytes), png);
  assert.equal(images[0].name, 'Pasted image 1.png');
});

test('does not expose clipboard plain text, HTML URLs, or fake image MIME data', async () => {
  const images = await readClipboardImages(clipboard(item({ 'text/plain': new Blob(['/private/document.txt']), 'text/html': new Blob(['<img src="https://example.test/personal.png">']), 'image/png': new Blob(['secret text']) })));
  assert.deepEqual(images, []);
});

test('local file URLs only: no remote hosts, credentials, query, traversal URL encodings or non-image names', () => {
  for (const url of ['https://example.test/a.png', 'file://server/share/a.png', 'file:///private/a.txt', 'file:///private/a.png?x', 'file:///private/a.png#x', 'file:///private/a%00.png', 'file:///private/a%2fb.png']) assert.equal(localImagePath(url), null, url);
  assert.equal(localImagePath('file:///tmp/a%20b.png'), '/tmp/a b.png');
});

test('copies bounded regular image files from Mac clipboard URLs without removing the source', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lumior-clipboard-'));
  try {
    const image = join(dir, 'image.png');
    await writeFile(image, png);
    const images = await readClipboardImages(clipboard(item({ [macFileUrl]: new Blob([pathToFileURL(image).href]) })), { platform: 'darwin' });
    assert.equal(images.length, 1);
    assert.equal(images[0].name, 'image.png');
    assert.deepEqual(Buffer.from(images[0].bytes), png);
    assert.deepEqual(await readFile(image), png);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('standard URI lists deduplicate images and ignore comments / non-file URLs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lumior-clipboard-'));
  try {
    const image = join(dir, 'image.png'), fake = join(dir, 'not-an-image.png');
    await writeFile(image, png);
    await writeFile(fake, 'private text');
    const value = ['# copy', pathToFileURL(image).href, pathToFileURL(image).href, pathToFileURL(fake).href, 'https://example.test/a.png'].join('\r\n');
    const images = await readClipboardImages(clipboard(item({ 'text/uri-list': new Blob([value]) })), { platform: 'linux' });
    assert.equal(images.length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('does not follow local symlinks offered as image files', { skip: process.platform === 'win32' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lumior-clipboard-'));
  try {
    const original = join(dir, 'original.png'), link = join(dir, 'alias.png');
    await writeFile(original, png);
    await symlink(original, link);
    await assert.rejects(readClipboardImages(clipboard(item({ 'text/uri-list': new Blob([pathToFileURL(link).href]) }))), /ELOOP/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('enforces per-image, batch and count limits before returning data', async () => {
  const oversized = { size: MAX_IMAGE_BYTES + 1, arrayBuffer: () => { throw new Error('must not allocate oversized payload'); } };
  await assert.rejects(readClipboardImages(clipboard(item({ 'image/png': oversized }))), /20 MiB/);
  const large = Buffer.alloc(MAX_IMAGE_BYTES); png.copy(large);
  const largeItem = item({ 'image/png': new Blob([large]) });
  await assert.rejects(readClipboardImages(clipboard(...Array(Math.ceil(MAX_BATCH_BYTES / MAX_IMAGE_BYTES)).fill(largeItem))), /64 MiB/);
  const small = item({ 'image/png': new Blob([png]) });
  await assert.rejects(readClipboardImages(clipboard(...Array(21).fill(small))), /20 clipboard images/);
  const urls = Array.from({ length: 21 }, (_, index) => `file:///tmp/image-${index}.png`).join('\n');
  await assert.rejects(readClipboardImages(clipboard(item({ 'text/uri-list': new Blob([urls]) }))), /20 clipboard images/);
});

test('runtime helper is included in the packaged desktop application', () => {
  assert.ok(require('../desktop/package.json').build.files.includes('runtime/clipboard-images.cjs'));
});
