import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import JSZip from 'jszip';
const require = createRequire(import.meta.url);
const { createLocalTranslationController, extractArchive } = require('../desktop/runtime/local-translation.cjs');
const sha = buffer => createHash('sha256').update(buffer).digest('hex');
function tar(entries) {
  const blocks = [];
  for (const entry of entries) {
    const header = Buffer.alloc(512), data = Buffer.from(entry.data || '');
    header.write(entry.name, 0, 100); header.write(data.length.toString(8).padStart(11, '0'), 124, 11);
    header[156] = (entry.type || '0').charCodeAt(0); if (entry.link) header.write(entry.link, 157, 100);
    blocks.push(header, data, Buffer.alloc((512 - data.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}
async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lumior-local-translation-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const model = Buffer.from('test-only-gguf'), archive = tar([{ name: 'bin/llama-server', data: 'test-only-executable' }, { name: 'bin/libggml.dylib', data: 'test-library' }, { name: 'bin/libggml.1.dylib', type: '2', link: 'libggml.dylib' }]);
  const manifest = { version: 1, id: 'test-v1', model: { id: 'hy-mt2-1.8b', url: 'https://models.example.org/model.gguf', sha256: sha(model), size: model.length }, runtimes: {
    'darwin-arm64': { url: 'https://runtime.example.org/runtime.tar.gz', sha256: sha(archive), size: archive.length, format: 'tar.gz', executable: 'bin/llama-server' },
  } };
  const requests = [], spawns = [], states = [];
  const fetcher = async (url, init) => { requests.push({ url, init }); if (url.endsWith('/health')) return new Response('{}'); return new Response(url === manifest.model.url ? model : archive); };
  const spawnProcess = (filename, args, init) => { const child = new EventEmitter(); child.pid = 12345; child.exitCode = null; child.kill = signal => { child.signal = signal; child.exitCode = 0; child.emit('exit', 0); }; spawns.push({ filename, args, init, child }); return child; };
  const controller = createLocalTranslationController({ directory, platform: 'darwin', arch: 'arm64', manifest, fetcher, spawnProcess, portAllocator: async () => 34567, pollInterval: 1, startupTimeout: 20, onState: state => states.push(state), ...options });
  t.after(() => controller.dispose());
  return { directory, model, archive, manifest, requests, spawns, states, controller, fetcher, spawnProcess };
}

void test('verified model and runtime install atomically, refresh offline, start privately and uninstall without workspace changes', async t => {
  const f = await fixture(t), { controller } = f;
  assert.equal((await controller.refresh()).installed, false);
  await controller.install(); assert.equal(controller.getState().status, 'ready');
  assert.equal(await fs.readFile(path.join(f.directory, 'installed/runtime/bin/libggml.1.dylib'), 'utf8'), 'test-library');
  assert.equal((await fs.lstat(path.join(f.directory, 'installed/runtime/bin/libggml.1.dylib'))).isSymbolicLink(), false);
  const connection = await controller.start();
  assert.equal(connection.baseUrl, 'http://127.0.0.1:34567/v1'); assert.match(connection.token, /^[a-f0-9]{64}$/);
  assert.equal(connection.model, 'hy-mt2-1.8b'); assert.equal(controller.getState().status, 'running');
  assert.ok(f.states.every(state => !('token' in state) && !('baseUrl' in state)));
  assert.equal(f.spawns.length, 1); assert.equal(f.spawns[0].init.windowsHide, true);
  const args = f.spawns[0].args;
  assert.equal(args[args.indexOf('--host') + 1], '127.0.0.1'); assert.equal(args[args.indexOf('--ctx-size') + 1], '8192');
  assert.equal(f.requests.at(-1).init.headers.Authorization, `Bearer ${connection.token}`);
  assert.deepEqual(await controller.start(), connection); assert.equal(f.spawns.length, 1);
  await controller.stop(); assert.equal(controller.getState().status, 'ready');
  const before = f.requests.length; await controller.refresh(); assert.equal(f.requests.length, before);
  await controller.remove(); assert.equal(controller.getState().installed, false);
  await assert.rejects(fs.access(path.join(f.directory, 'installed')));
});

void test('digest mismatch rejects the install and does not expose unverified files', async t => {
  const f = await fixture(t, { fetcher: async () => new Response(Buffer.from('wrong')) });
  await assert.rejects(f.controller.install(), /verification|size/); assert.equal(f.controller.getState().status, 'error');
  await assert.rejects(fs.access(path.join(f.directory, 'installed'))); await assert.rejects(fs.access(path.join(f.directory, 'installing')));
});

void test('cancel interrupts a download, removes partial files and allows explicit retry', async t => {
  let begun; const waiting = new Promise(resolve => { begun = resolve; });
  const f = await fixture(t, { fetcher: (_url, { signal }) => new Promise((_resolve, reject) => { begun(); signal.addEventListener('abort', () => reject(signal.reason), { once: true }); }) });
  const job = f.controller.install(); await waiting; await f.controller.cancelDownload(); await job;
  assert.equal(f.controller.getState().status, 'not-installed'); await assert.rejects(fs.access(path.join(f.directory, 'installing')));
});

void test('model tampering is detected before launching executable and never causes a network download', async t => {
  const f = await fixture(t); await f.controller.install(); const count = f.requests.length;
  await fs.writeFile(path.join(f.directory, 'installed/model.gguf'), Buffer.alloc(f.model.length, 65));
  await assert.rejects(f.controller.start(), /changed/); assert.equal(f.spawns.length, 0); assert.equal(f.requests.length, count);
  assert.equal(f.controller.getState().status, 'error');
});

void test('runtime tampering and directory links are rejected before startup', async t => {
  const f = await fixture(t); await f.controller.install();
  await fs.writeFile(path.join(f.directory, 'installed/runtime/bin/llama-server'), 'tampered');
  await assert.rejects(f.controller.start(), /changed/); assert.equal(f.spawns.length, 0);
});

void test('unsupported platforms never download or spawn', async t => {
  const f = await fixture(t, { platform: 'linux' });
  assert.equal(f.controller.getState().supported, false);
  assert.throws(() => f.controller.install(), /not supported/); assert.throws(() => f.controller.start(), /not supported/);
  assert.equal(f.requests.length, 0); assert.equal(f.spawns.length, 0);
});

void test('health failure terminates the child, preserves installed files and reports a startup error', async t => {
  const f = await fixture(t); await f.controller.install();
  const failing = createLocalTranslationController({ directory: f.directory, platform: 'darwin', arch: 'arm64', manifest: f.manifest, portAllocator: async () => 34567, spawnProcess: f.spawnProcess, startupTimeout: 5, pollInterval: 1, fetcher: async () => new Response('{}', { status: 503 }) });
  t.after(() => failing.dispose());
  await assert.rejects(failing.start(), /too long/); assert.equal(failing.getState().status, 'error'); assert.equal(failing.getState().installed, true);
  assert.equal(f.spawns[0].child.signal, 'SIGTERM');
});

void test('unexpected runtime exit clears private connection and can start a new authenticated process', async t => {
  const f = await fixture(t); await f.controller.install(); const first = await f.controller.start();
  f.spawns[0].child.emit('exit', 1); assert.equal(f.controller.getState().status, 'error');
  const second = await f.controller.start(); assert.notEqual(first.token, second.token);
});

void test('runtime receives an allowlisted environment with no cloud keys or model override variables', async t => {
  const previousKey = process.env.LUMIOR_CUSTOM_API_KEY, previousArgs = process.env.LLAMA_ARG_MODEL;
  process.env.LUMIOR_CUSTOM_API_KEY = 'test-private-value'; process.env.LLAMA_ARG_MODEL = '/untrusted/model';
  t.after(() => { if (previousKey === undefined) delete process.env.LUMIOR_CUSTOM_API_KEY; else process.env.LUMIOR_CUSTOM_API_KEY = previousKey; if (previousArgs === undefined) delete process.env.LLAMA_ARG_MODEL; else process.env.LLAMA_ARG_MODEL = previousArgs; });
  const f = await fixture(t); await f.controller.install(); await f.controller.start();
  assert.equal(f.spawns[0].init.env.LUMIOR_CUSTOM_API_KEY, undefined); assert.equal(f.spawns[0].init.env.LLAMA_ARG_MODEL, undefined);
});

void test('ZIP runtime extraction supports Windows files and rejects traversal', async t => {
  const f = await fixture(t), zip = new JSZip(); zip.file('llama-server.exe', 'test-exe'); zip.file('ggml.dll', 'test-dll');
  const filename = path.join(f.directory, 'runtime.zip'); await fs.writeFile(filename, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  const files = await extractArchive(filename, path.join(f.directory, 'unpacked'), 'zip'); assert.equal(files['llama-server.exe'], sha('test-exe'));
  const evil = tar([{ name: '../escape', data: 'bad' }]); await fs.writeFile(filename, evil);
  await assert.rejects(extractArchive(filename, path.join(f.directory, 'evil'), 'tar.gz'), /path/);
});

void test('archive link traversal, cycles and nested link writes cannot escape extraction', async t => {
  const f = await fixture(t);
  for (const entries of [
    [{ name: 'bin/link', type: '2', link: '../../escape' }],
    [{ name: 'a', type: '2', link: 'b' }, { name: 'b', type: '2', link: 'a' }],
    [{ name: 'a', type: '2', link: 'target' }, { name: 'target', data: 'ok' }, { name: 'a/file', data: 'bad' }],
  ]) {
    const filename = path.join(f.directory, 'bad.tar.gz'); await fs.writeFile(filename, tar(entries));
    await assert.rejects(extractArchive(filename, path.join(f.directory, 'bad'), 'tar.gz'), /path|link/i);
  }
});

void test('Windows cleanup terminates the owned process tree and uses CPU runtime settings', async t => {
  const f = await fixture(t), manifest = { ...f.manifest, runtimes: { 'win32-x64': f.manifest.runtimes['darwin-arm64'] } };
  let runner; const calls = [];
  const spawnProcess = (filename, args, init) => {
    const child = new EventEmitter(); child.pid = 23456; child.exitCode = null;
    child.kill = () => { child.exitCode = 0; child.emit('exit', 0); };
    calls.push({ filename, args, init });
    if (filename.endsWith('taskkill.exe')) queueMicrotask(() => { runner.exitCode = 0; runner.emit('exit', 0); });
    else runner = child;
    return child;
  };
  const controller = createLocalTranslationController({ directory: path.join(f.directory, 'windows'), platform: 'win32', arch: 'x64', manifest, fetcher: f.fetcher, spawnProcess, portAllocator: async () => 34567 });
  t.after(() => controller.dispose());
  await controller.install(); await controller.start(); await controller.stop();
  assert.equal(calls[0].args[calls[0].args.indexOf('--n-gpu-layers') + 1], '0');
  assert.deepEqual(calls[1].args, ['/PID', '23456', '/T', '/F']); assert.equal(calls[1].init.windowsHide, true);
  assert.equal(controller.getState().status, 'ready');
});

void test('stopping while health waits aborts startup and preserves an installed component', async t => {
  const f = await fixture(t); await f.controller.install(); let requested;
  const healthStarted = new Promise(resolve => { requested = resolve; });
  const controller = createLocalTranslationController({ directory: f.directory, platform: 'darwin', arch: 'arm64', manifest: f.manifest, spawnProcess: f.spawnProcess, portAllocator: async () => 34567,
    fetcher: (_url, { signal }) => new Promise((_resolve, reject) => { requested(); signal.addEventListener('abort', () => reject(signal.reason), { once: true }); }) });
  t.after(() => controller.dispose());
  const starting = controller.start(); const rejected = assert.rejects(starting); await healthStarted; await controller.stop(); await rejected;
  assert.equal(controller.getState().status, 'ready'); assert.equal(controller.getState().installed, true); assert.equal(f.spawns[0].child.signal, 'SIGTERM');
});

void test('an unsuccessful replacement keeps the existing verified installation available', async t => {
  const f = await fixture(t); await f.controller.install();
  const controller = createLocalTranslationController({ directory: f.directory, platform: 'darwin', arch: 'arm64', manifest: f.manifest, fetcher: async () => new Response('unavailable', { status: 503 }) });
  t.after(() => controller.dispose());
  await controller.refresh(); await assert.rejects(controller.install(), /download failed/);
  assert.equal(controller.getState().installed, true); assert.equal((await controller.refresh()).status, 'ready');
});

void test('duplicate install requests share one verified installation job', async t => {
  const f = await fixture(t); const first = f.controller.install(), second = f.controller.install(); assert.equal(first, second);
  await first; assert.equal(f.requests.length, 2);
});

void test('HTTPS download redirects remain credential-free and cannot downgrade to plaintext', async t => {
  const f = await fixture(t); const requests = [];
  const controller = createLocalTranslationController({ directory: path.join(f.directory, 'redirect'), platform: 'darwin', arch: 'arm64', manifest: f.manifest,
    fetcher: async (url, init) => { requests.push({ url, init }); return new Response(null, { status: 302, headers: { location: 'http://localhost/file' } }); } });
  t.after(() => controller.dispose());
  await assert.rejects(controller.install(), /Unsafe/); assert.equal(requests.length, 1); assert.equal(requests[0].init.credentials, 'omit'); assert.equal(requests[0].init.headers.Authorization, undefined);
});

void test('equal-size corrupted model fails SHA-256 verification before installation is published', async t => {
  const f = await fixture(t);
  const controller = createLocalTranslationController({ directory: path.join(f.directory, 'hash-failure'), platform: 'darwin', arch: 'arm64', manifest: f.manifest,
    fetcher: async url => new Response(url === f.manifest.model.url ? Buffer.alloc(f.model.length, 65) : f.archive) });
  t.after(() => controller.dispose());
  await assert.rejects(controller.install(), /verification failed/); assert.equal(controller.getState().installed, false);
  await assert.rejects(fs.access(path.join(f.directory, 'hash-failure/installed')));
});

void test('inaccessible optional component directory is a visible state error rather than a workspace startup exception', async t => {
  const f = await fixture(t); const filename = path.join(f.directory, 'not-a-directory'); await fs.writeFile(filename, 'file');
  const controller = createLocalTranslationController({ directory: filename, platform: 'darwin', arch: 'arm64', manifest: f.manifest });
  t.after(() => controller.dispose());
  const state = await controller.refresh(); assert.equal(state.status, 'error'); assert.equal(state.installed, false);
});

void test('uninstall also removes stale interrupted download and previous-version directories', async t => {
  const f = await fixture(t); await f.controller.install();
  for (const name of ['installing', 'previous']) { await fs.mkdir(path.join(f.directory, name)); await fs.writeFile(path.join(f.directory, name, 'partial'), 'old'); }
  await f.controller.remove();
  for (const name of ['installed', 'installing', 'previous']) await assert.rejects(fs.access(path.join(f.directory, name)));
});
