import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { validateUpdateVersion, verifyUpdateDirectory, writeUpdateVerification } from '../desktop/scripts/verify-update-metadata.mjs';
import { publicUpdateRoot, verifyPublicUpdates } from '../desktop/scripts/verify-public-updates.mjs';

const desktopRequire = createRequire(new URL('../desktop/package.json', import.meta.url));
const builderRequire = createRequire(desktopRequire.resolve('electron-builder'));
const libraryRequire = createRequire(builderRequire.resolve('app-builder-lib'));
const { buildBlockMap } = libraryRequire('./targets/blockmap/blockmap');
const version = '0.1.34-win.2';
const manifestName = 'windows-preview.yml';
const installerName = `Lumior-${version}-windows-x64.exe`;

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'lumior-windows-update-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bytes = Buffer.from(Array.from({ length: 70000 }, (_, index) => (index * 17 + 19) % 256));
  const installer = path.join(directory, installerName);
  await writeFile(installer, bytes);
  await buildBlockMap(installer, 'gzip', `${installer}.blockmap`);
  const sha512 = createHash('sha512').update(bytes).digest('base64');
  const metadata = { version, files: [{ url: installerName, size: bytes.length, sha512 }], path: installerName, sha512 };
  const writeMetadata = () => writeFile(path.join(directory, manifestName), JSON.stringify(metadata));
  await writeMetadata();
  const options = { directory, version, platform: 'windows-preview', arch: 'x64' };
  await writeUpdateVerification(options);
  const objects = new Map(await Promise.all((await readdir(directory)).map(async name => [name, await readFile(path.join(directory, name))])));
  const calls = [];
  const fetcher = change => async (url, init) => {
    calls.push({ url, init });
    const name = new URL(url).pathname.split('/').at(-1);
    const original = objects.get(name);
    assert.ok(original, 'Verifier must only request known synthetic artifacts');
    const match = init.headers.Range?.match(/^bytes=(\d+)-(\d+)$/);
    const start = match ? Number(match[1]) : 0, end = match ? Number(match[2]) : original.length - 1;
    const manifest = name === manifestName;
    const state = { name, init, status: match ? 206 : 200, body: Buffer.from(original.subarray(start, end + 1)),
      headers: { 'Content-Length': String(end - start + 1),
        'Content-Type': manifest ? 'application/yaml' : name.endsWith('.exe') ? 'application/vnd.microsoft.portable-executable' : 'application/octet-stream',
        'Cache-Control': manifest ? 'max-age=0, no-cache, no-store' : 'public, max-age=31536000, immutable',
        ...(match ? { 'Content-Range': `bytes ${start}-${end}/${original.length}` } : {}) } };
    await change?.(state);
    return new Response(state.body, { status: state.status, headers: state.headers });
  };
  return { directory, installer, bytes, metadata, writeMetadata, options, objects, calls, fetcher };
}

void test('Windows preview verification keeps its exact installer, blockmap and feed separate from Mac', async t => {
  const entry = await fixture(t);
  const report = await verifyUpdateDirectory(entry.options);
  assert.equal(report.platform, 'windows-preview');
  assert.equal(report.metadataName, manifestName);
  assert.equal(report.files.length, 1);
  assert.equal(report.files[0].name, installerName);
  assert.equal(report.files[0].bytes, entry.bytes.length);
  assert.equal(report.checksums.length, 3);
  assert.equal(await readFile(path.join(entry.directory, 'SHA256SUMS.txt'), 'utf8'), `${report.checksums.join('\n')}\n`);
  assert.equal(publicUpdateRoot('x64', 'windows-preview'), 'https://updates.lumior.work/windows/x64/');
  assert.equal(publicUpdateRoot('arm64'), 'https://updates.lumior.work/mac/arm64/');
  assert.equal(publicUpdateRoot('x64'), 'https://updates.lumior.work/mac/x64/');
  await assert.rejects(verifyUpdateDirectory({ ...entry.options, platform: 'mac' }), /stable/);
});

void test('Windows preview requires a bounded strict win revision and x64 before public requests', async t => {
  const entry = await fixture(t);
  for (const invalid of ['0.1.34', '0.1.34-beta.2', '0.1.34-win.0', '0.1.34-win.02', '00.1.34-win.2', '0.1.34-win.2+other', '../0.1.34-win.2', '0.1.34-win.9007199254740992', `${'1'.repeat(97)}.1.1-win.1`]) {
    assert.throws(() => validateUpdateVersion(invalid, 'windows-preview'), /Windows preview/);
    await assert.rejects(verifyPublicUpdates({ ...entry.options, version: invalid, fetcher: entry.fetcher() }));
  }
  for (const change of [{ arch: 'arm64' }, { arch: 'ia32' }, { platform: 'win' }]) {
    await assert.rejects(verifyPublicUpdates({ ...entry.options, ...change, fetcher: entry.fetcher() }));
  }
  assert.equal(entry.calls.length, 0);
});

void test('Windows metadata cannot reference another version, external URL, ZIP or web installer', async t => {
  for (const change of [
    metadata => { metadata.files[0].url = installerName.replace('win.2', 'win.3'); },
    metadata => { metadata.files[0].url = `https://other.invalid/${installerName}`; },
    metadata => { metadata.files[0].url = `../${installerName}`; },
    metadata => { metadata.files[0].url = installerName.replace('.exe', '.zip'); },
    metadata => { metadata.files.push({ ...metadata.files[0] }); },
    metadata => { metadata.packages = { x64: { path: 'other.7z' } }; },
    metadata => { delete metadata.files[0].size; },
    metadata => { metadata.path = 'other.exe'; },
    metadata => { metadata.sha512 = 'A'.repeat(86) + '=='; },
  ]) {
    const entry = await fixture(t);
    change(entry.metadata);
    await entry.writeMetadata();
    await assert.rejects(verifyUpdateDirectory(entry.options));
  }
});

void test('Windows artifact verification rejects changed bytes, bad coverage and block checksums', async t => {
  const changed = await fixture(t);
  const bytes = Buffer.from(changed.bytes); bytes[30000] ^= 1;
  await writeFile(changed.installer, bytes);
  await assert.rejects(verifyUpdateDirectory(changed.options), /SHA-512 mismatch/);
  for (const change of [
    blockmap => { blockmap.files[0].sizes[0]--; },
    blockmap => { blockmap.files[0].offset = 1; },
    blockmap => { blockmap.files[0].checksums[0] = 'A'.repeat(24); },
  ]) {
    const entry = await fixture(t);
    const filename = `${entry.installer}.blockmap`;
    const blockmap = JSON.parse(gunzipSync(await readFile(filename)).toString());
    change(blockmap);
    await writeFile(filename, gzipSync(JSON.stringify(blockmap)));
    await assert.rejects(verifyUpdateDirectory(entry.options), /Blockmap|blockmap/);
  }
});

void test('Windows upload directory excludes ZIPs, old feeds, missing blockmaps and linked artifacts', async t => {
  for (const name of [installerName.replace('.exe', '.zip'), 'latest.yml', 'latest-mac.yml']) {
    const entry = await fixture(t);
    await writeFile(path.join(entry.directory, name), 'unapproved');
    await assert.rejects(verifyUpdateDirectory(entry.options), /unexpected file/);
  }
  const missing = await fixture(t);
  await rm(`${missing.installer}.blockmap`);
  await assert.rejects(verifyUpdateDirectory(missing.options), /ENOENT/);
  const linked = await fixture(t);
  await rm(linked.installer);
  await symlink(`${linked.installer}.blockmap`, linked.installer);
  await assert.rejects(verifyUpdateDirectory(linked.options), /regular files/);
});

void test('Windows public checks use full bytes and middle ranges, with manifest activation checked only on request', async t => {
  const entry = await fixture(t);
  const report = await verifyPublicUpdates({ ...entry.options, fetcher: entry.fetcher() });
  assert.equal(report.platform, 'windows-preview');
  assert.equal(report.readOnly, true);
  assert.equal(report.manifestChecked, false);
  assert.equal(report.files.length, 2);
  assert.equal(entry.calls.length, 4);
  assert.ok(report.files[0].range.start > 0);
  assert.equal(entry.calls.every(({ url, init }) => url.startsWith('https://updates.lumior.work/windows/x64/')
    && !url.endsWith('.yml') && init.method === 'GET' && init.redirect === 'manual' && init.credentials === 'omit'), true);
  const active = await verifyPublicUpdates({ ...entry.options, manifest: true, fetcher: entry.fetcher() });
  assert.equal(active.manifestChecked, true);
  assert.equal(active.manifest.url, 'https://updates.lumior.work/windows/x64/windows-preview.yml');
  assert.equal(entry.calls.length, 9);
});

void test('Windows public checks reject corrupt downloads, bad MIME, weak cache and bad Range responses', async t => {
  const entry = await fixture(t);
  for (const [change, error] of [
    [state => { state.body[0] ^= 1; }, /hash mismatch/],
    [state => { state.headers['Content-Type'] = 'text/html'; }, /Content-Type/],
    [state => { state.headers['Cache-Control'] = 'public, max-age=3600'; }, /immutable caching/],
    [state => { if (state.init.headers.Range) state.status = 200; }, /status or redirect/],
    [state => { if (state.init.headers.Range) state.body[0] ^= 1; }, /Range bytes mismatch/],
    [state => { if (state.init.headers.Range) state.headers['Content-Range'] = 'bytes 0-1023/70000'; }, /Content-Range/],
  ]) await assert.rejects(verifyPublicUpdates({ ...entry.options, fetcher: entry.fetcher(change) }), error);
});

void test('Windows active manifest must be byte-exact and uncached, and local evidence must match', async t => {
  const entry = await fixture(t);
  for (const [change, error] of [
    [state => { if (state.name === manifestName) state.headers['Cache-Control'] = 'public, max-age=3600, immutable'; }, /manifest/],
    [state => { if (state.name === manifestName) state.body = Buffer.from(state.body.toString().replace('win.2', 'win.3')); }, /manifest/],
  ]) await assert.rejects(verifyPublicUpdates({ ...entry.options, manifest: true, fetcher: entry.fetcher(change) }), error);
  const callCount = entry.calls.length;
  await writeFile(path.join(entry.directory, 'release-verification.json'), '{}');
  await assert.rejects(verifyPublicUpdates({ ...entry.options, fetcher: entry.fetcher() }), /Local release verification records/);
  assert.equal(entry.calls.length, callCount);
});
