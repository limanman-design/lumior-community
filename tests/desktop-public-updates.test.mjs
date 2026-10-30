import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { writeUpdateVerification } from '../desktop/scripts/verify-update-metadata.mjs';
import { publicUpdateRoot, verifyPublicUpdates, writePublicUpdateVerification } from '../desktop/scripts/verify-public-updates.mjs';

const desktopRequire = createRequire(new URL('../desktop/package.json', import.meta.url));
const builderRequire = createRequire(desktopRequire.resolve('electron-builder'));
const libraryRequire = createRequire(builderRequire.resolve('app-builder-lib'));
const { buildBlockMap } = libraryRequire('./targets/blockmap/blockmap');
const version = '0.1.3';

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'lumior-public-updates-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const files = [];
  for (const extension of ['zip', 'dmg']) {
    const name = `Lumior-${version}-mac-arm64.${extension}`;
    const bytes = Buffer.from(Array.from({ length: 3500 }, (_, index) => (index * 17 + extension.length) % 256));
    await writeFile(path.join(directory, name), bytes);
    await buildBlockMap(path.join(directory, name), 'gzip', path.join(directory, `${name}.blockmap`));
    files.push({ url: name, size: bytes.length, sha512: createHash('sha512').update(bytes).digest('base64') });
  }
  await writeFile(path.join(directory, 'latest-mac.yml'), JSON.stringify({ version, files, path: files[0].url, sha512: files[0].sha512 }));
  const options = { directory, version, arch: 'arm64' };
  await writeUpdateVerification(options);
  const objects = new Map(await Promise.all((await readdir(directory)).map(async name => [name, await readFile(path.join(directory, name))])));
  const calls = [];
  function fetcher(change) {
    return async (url, init) => {
      calls.push({ url, init });
      const name = new URL(url).pathname.split('/').at(-1);
      const original = objects.get(name);
      assert.ok(original, 'Only known synthetic files may be requested');
      const match = init.headers.Range?.match(/^bytes=(\d+)-(\d+)$/);
      const start = match ? Number(match[1]) : 0, end = match ? Number(match[2]) : original.length - 1;
      const state = { url, name, init, body: Buffer.from(original.subarray(start, end + 1)), status: match ? 206 : 200,
        headers: { 'Content-Length': String(end - start + 1), 'Content-Type': name === 'latest-mac.yml' ? 'text/yaml' : 'application/octet-stream',
          'Cache-Control': name === 'latest-mac.yml' ? 'no-cache, no-store, max-age=0, must-revalidate' : 'public, max-age=31536000, immutable',
          'CF-Cache-Status': 'HIT', ETag: '"synthetic-etag"', Age: '10',
          ...(match ? { 'Content-Range': `bytes ${start}-${end}/${original.length}` } : {}) } };
      await change?.(state);
      return state.response || new Response(state.body, { status: state.status, headers: state.headers });
    };
  }
  return { directory, options, objects, calls, fetcher };
}

void test('default public verification streams four exact files, checks middle ranges, and never requests latest or credentials', async t => {
  const entry = await fixture(t);
  const before = new Map(await Promise.all((await readdir(entry.directory)).map(async name => [name, await readFile(path.join(entry.directory, name))])));
  const report = await verifyPublicUpdates({ ...entry.options, fetcher: entry.fetcher() });
  assert.equal(report.readOnly, true);
  assert.equal(report.tlsCertificateVerificationEnabled, true);
  assert.equal(report.manifestChecked, false);
  assert.equal(report.files.length, 4);
  assert.equal(entry.calls.length, 8);
  assert.equal(entry.calls.every(({ url, init }) => url.startsWith(publicUpdateRoot('arm64')) && !url.includes('latest')
    && init.method === 'GET' && init.redirect === 'manual' && init.credentials === 'omit'
    && init.headers['Accept-Encoding'] === 'identity' && !('Authorization' in init.headers)), true);
  assert.ok(report.files[0].range.start > 0, 'A middle range catches servers that silently return the file prefix');
  assert.equal(report.files[0].full.headers['cf-cache-status'], 'HIT');
  assert.equal(report.files[0].full.headers.age, '10');
  assert.equal(JSON.stringify(report).includes('content"'), false, 'Report does not contain download bodies');
  for (const [name, bytes] of before) assert.deepEqual(await readFile(path.join(entry.directory, name)), bytes);
});

void test('manifest verification is opt-in, byte-exact, uncached, and recorded separately', async t => {
  const entry = await fixture(t);
  const report = await verifyPublicUpdates({ ...entry.options, manifest: true, fetcher: entry.fetcher() });
  assert.equal(entry.calls.length, 9);
  assert.equal(report.manifestChecked, true);
  assert.equal(report.manifest.url, `${publicUpdateRoot('arm64')}latest-mac.yml`);
  for (const change of [
    state => { if (state.name === 'latest-mac.yml') state.body = Buffer.from(state.body.toString().replace('0.1.3', '0.1.2')); },
    state => { if (state.name === 'latest-mac.yml') state.headers['Cache-Control'] = 'public, max-age=3600'; },
  ]) await assert.rejects(verifyPublicUpdates({ ...entry.options, manifest: true, fetcher: entry.fetcher(change) }), /manifest/);
});

void test('full download integrity refuses wrong bytes, incorrect sizes, truncation, and oversized bodies', async t => {
  const entry = await fixture(t);
  for (const [change, error] of [
    [state => { state.body[0] ^= 1; }, /hash mismatch/],
    [state => { state.headers['Content-Length'] = '1'; }, /Content-Length/],
    [state => { state.body = state.body.subarray(1); }, /ended before/],
    [state => { state.body = Buffer.concat([state.body, Buffer.from([1])]); }, /exceeds/],
  ]) await assert.rejects(verifyPublicUpdates({ ...entry.options, fetcher: entry.fetcher(change) }), error);
});

void test('single Range verification refuses 200 fallback, wrong range metadata, and incorrect same-length bytes', async t => {
  const entry = await fixture(t);
  for (const [change, error] of [
    [state => { if (state.init.headers.Range) state.status = 200; }, /status or redirect/],
    [state => { if (state.init.headers.Range) state.headers['Content-Range'] = 'bytes 0-1023/3500'; }, /Content-Range/],
    [state => { if (state.init.headers.Range) state.body[0] ^= 1; }, /Range bytes mismatch/],
  ]) await assert.rejects(verifyPublicUpdates({ ...entry.options, fetcher: entry.fetcher(change) }), error);
});

void test('public responses refuse redirects, unexpected MIME, compressed transport, and weak cache policies', async t => {
  const entry = await fixture(t);
  for (const [change, error] of [
    [state => { state.status = 302; state.headers.Location = 'https://other.test/private'; }, /status or redirect/],
    [state => { state.response = new Response(state.body, { headers: state.headers }); Object.defineProperty(state.response, 'redirected', { value: true }); }, /redirect/],
    [state => { state.response = new Response(state.body, { headers: state.headers }); Object.defineProperty(state.response, 'url', { value: 'https://other.test/file' }); }, /redirect/],
    [state => { state.headers['Content-Type'] = 'text/html'; }, /Content-Type/],
    [state => { state.headers['Content-Encoding'] = 'gzip'; }, /transport compression/],
    [state => { state.headers['Cache-Control'] = 'public, max-age=3600, immutable'; }, /immutable caching/],
    [state => { state.headers['Cache-Control'] = 'private, max-age=31536000, immutable'; }, /immutable caching/],
  ]) await assert.rejects(verifyPublicUpdates({ ...entry.options, fetcher: entry.fetcher(change) }), error);
});

void test('timeouts bound both connection waits and stalled response bodies, with safe network errors', async t => {
  const entry = await fixture(t);
  await assert.rejects(verifyPublicUpdates({ ...entry.options, requestTimeoutMs: 10, fetcher: () => new Promise(() => {}) }), /timed out/);
  await assert.rejects(verifyPublicUpdates({ ...entry.options, requestTimeoutMs: 10, fetcher: entry.fetcher(state => {
    state.response = new Response(new ReadableStream({ start() {}, cancel() {} }), { headers: state.headers });
  }) }), /timed out/);
  await assert.rejects(verifyPublicUpdates({ ...entry.options, fetcher: async () => { throw new Error('https://user:secret@other.test/private'); } }), /^Error: Public update HTTPS request failed\.$/);
});

void test('local accepted records, size bounds, stable versions, and architecture are checked before any network call', async t => {
  const entry = await fixture(t);
  for (const change of [{ version: '../secret' }, { arch: 'aarch64' }, { maxArtifactBytes: 10 }, { requestTimeoutMs: 0 }, { rangeBytes: 100_000 }]) {
    await assert.rejects(verifyPublicUpdates({ ...entry.options, ...change, fetcher: entry.fetcher() }));
  }
  await writeFile(path.join(entry.directory, 'release-verification.json'), '{}');
  await assert.rejects(verifyPublicUpdates({ ...entry.options, fetcher: entry.fetcher() }), /Local release verification records/);
  assert.equal(entry.calls.length, 0);
});

void test('report writing cannot touch accepted release files or symlink targets and never overwrites reports', async t => {
  const entry = await fixture(t);
  await assert.rejects(writePublicUpdateVerification({ ...entry.options, output: path.join(entry.directory, 'release-verification.json'), fetcher: entry.fetcher() }), /outside/);
  const originalNames = await readdir(entry.directory);
  await assert.rejects(writePublicUpdateVerification({ ...entry.options, output: path.join(entry.directory, 'new-directory/report.json'), fetcher: entry.fetcher() }), /outside/);
  assert.deepEqual(await readdir(entry.directory), originalNames);
  const reports = await mkdtemp(path.join(tmpdir(), 'lumior-public-report-'));
  t.after(() => rm(reports, { recursive: true, force: true }));
  const linked = path.join(reports, 'linked.json');
  await symlink(path.join(entry.directory, 'release-verification.json'), linked);
  await assert.rejects(writePublicUpdateVerification({ ...entry.options, output: linked, fetcher: entry.fetcher() }), /symbolic link/);
  const output = path.join(reports, 'report.json');
  const report = await writePublicUpdateVerification({ ...entry.options, output, fetcher: entry.fetcher() });
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), report);
  const count = entry.calls.length;
  await assert.rejects(writePublicUpdateVerification({ ...entry.options, output, fetcher: entry.fetcher() }), /already exists/);
  assert.equal(entry.calls.length, count);
});
