'use strict';
/* oxlint-disable typescript/no-require-imports -- Electron main-process module. */
const fs = require('node:fs/promises');
const path = require('node:path');
const { createReadStream } = require('node:fs');
const { createHash, randomBytes } = require('node:crypto');
const { gunzipSync, inflateRawSync } = require('node:zlib');
const { spawn } = require('node:child_process');
const net = require('node:net');

const MAX_EXPANDED = 512 * 1024 * 1024;
function safePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') || value.startsWith('/') || /^[a-z]:/i.test(value)) throw new Error('Invalid local translation archive path.');
  const cleaned = value.replace(/^(?:\.\/)+/, '').replace(/\/$/, '');
  if (!cleaned || cleaned.split('/').some(part => !part || part === '..' || part === '.')) throw new Error('Invalid local translation archive path.');
  return cleaned;
}
function inside(root, filename) { const relative = path.relative(root, filename); return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); }
function artifact(value) {
  const url = new URL(value?.url);
  if (url.protocol !== 'https:' || url.username || url.password || !/^[a-f0-9]{64}$/.test(value.sha256) || !Number.isSafeInteger(value.size) || value.size < 1) throw new Error('Invalid local translation download manifest.');
  return value;
}
async function digest(filename, signal) { const hash = createHash('sha256'); for await (const chunk of createReadStream(filename)) { signal?.throwIfAborted(); hash.update(chunk); } return hash.digest('hex'); }
async function regular(filename, root) {
  if (!inside(root, filename)) throw new Error('Invalid local translation installation.');
  const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Invalid local translation installation.');
  if (!inside(await fs.realpath(root), await fs.realpath(filename))) throw new Error('Invalid local translation installation.');
  return stat;
}
function cstring(buffer) { const end = buffer.indexOf(0); return buffer.subarray(0, end < 0 ? buffer.length : end).toString('utf8'); }
function tarEntries(buffer) {
  const entries = []; let offset = 0, pax = {};
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512); offset += 512;
    if (header.every(byte => byte === 0)) break;
    const size = parseInt(cstring(header.subarray(124, 136)).trim() || '0', 8);
    if (!Number.isSafeInteger(size) || size < 0 || offset + size > buffer.length) throw new Error('Invalid local translation archive.');
    const data = buffer.subarray(offset, offset + size); offset += Math.ceil(size / 512) * 512;
    const type = String.fromCharCode(header[156] || 48);
    if (type === 'x' || type === 'g') {
      let pos = 0; const values = {};
      while (pos < data.length) {
        const space = data.indexOf(32, pos), length = Number(data.subarray(pos, space).toString());
        if (space < 0 || !Number.isSafeInteger(length) || length < 3 || pos + length > data.length) throw new Error('Invalid archive metadata.');
        const line = data.subarray(space + 1, pos + length - 1).toString(), equal = line.indexOf('=');
        if (equal > 0) values[line.slice(0, equal)] = line.slice(equal + 1);
        pos += length;
      }
      if (type === 'x') pax = values;
      continue;
    }
    const prefix = cstring(header.subarray(345, 500)), name = cstring(header.subarray(0, 100));
    const filename = pax.path || (prefix ? `${prefix}/${name}` : name), link = pax.linkpath || cstring(header.subarray(157, 257));
    pax = {};
    if (filename === './' || filename === '.') continue;
    if (!['0', '5', '1', '2'].includes(type)) throw new Error('Unsupported local translation archive entry.');
    entries.push({ name: safePath(filename), type: type === '5' ? 'directory' : type === '2' ? 'symlink' : type === '1' ? 'hardlink' : 'file', data, link });
  }
  return entries;
}
function zipEntries(buffer) {
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0 || buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6)) throw new Error('Invalid local translation ZIP.');
  const count = buffer.readUInt16LE(end + 10); let offset = buffer.readUInt32LE(end + 16), expanded = 0;
  if (count === 65535) throw new Error('ZIP64 runtime archives are not supported.');
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid local translation ZIP.');
    const flags = buffer.readUInt16LE(offset + 8), method = buffer.readUInt16LE(offset + 10), compressed = buffer.readUInt32LE(offset + 20), size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28), extra = buffer.readUInt16LE(offset + 30), comment = buffer.readUInt16LE(offset + 32), local = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'), mode = buffer.readUInt32LE(offset + 38) >>> 16;
    offset += 46 + nameLength + extra + comment; expanded += size;
    if (flags & 1 || expanded > MAX_EXPANDED || local + 30 > buffer.length || buffer.readUInt32LE(local) !== 0x04034b50 || ![0, 8].includes(method)) throw new Error('Unsupported local translation ZIP.');
    const begin = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    if (begin + compressed > buffer.length) throw new Error('Invalid local translation ZIP.');
    const packed = buffer.subarray(begin, begin + compressed);
    const data = method === 0 ? packed : inflateRawSync(packed, { maxOutputLength: Math.max(1, size) });
    if (data.length !== size) throw new Error('Invalid local translation ZIP size.');
    const type = name.endsWith('/') ? 'directory' : (mode & 0xf000) === 0xa000 ? 'symlink' : 'file';
    entries.push({ name: safePath(name), type, data, link: type === 'symlink' ? data.toString('utf8') : '' });
  }
  return entries;
}
async function extractArchive(filename, destination, format) {
  const packed = await fs.readFile(filename);
  const entries = format === 'tar.gz' ? tarEntries(gunzipSync(packed, { maxOutputLength: MAX_EXPANDED })) : format === 'zip' ? zipEntries(packed) : null;
  if (!entries || entries.length > 10000) throw new Error('Unsupported local translation archive.');
  const names = new Set(), links = new Map(); let expanded = 0;
  for (const entry of entries) {
    if (names.has(entry.name)) throw new Error('Duplicate archive entry.');
    names.add(entry.name); expanded += entry.data.length;
    if (expanded > MAX_EXPANDED) throw new Error('Local translation archive is too large.');
    if (entry.type.endsWith('link')) {
      if (!entry.link || entry.link.includes('\\') || path.posix.isAbsolute(entry.link) || /^[a-z]:/i.test(entry.link)) throw new Error('Unsafe archive link.');
      const target = safePath(path.posix.normalize(entry.type === 'symlink' ? path.posix.join(path.posix.dirname(entry.name), entry.link) : entry.link));
      links.set(entry.name, target);
    }
  }
  for (const name of names) for (const link of links.keys()) if (name.startsWith(`${link}/`)) throw new Error('Archive writes through a link.');
  for (const [link, target] of links) {
    const seen = new Set([link]); let current = target;
    while (links.has(current)) { if (seen.has(current)) throw new Error('Cyclic archive link.'); seen.add(current); current = links.get(current); }
    if (!names.has(current) || entries.find(entry => entry.name === current)?.type !== 'file') throw new Error('Archive link target is not a regular file.');
  }
  await fs.mkdir(destination, { recursive: true, mode: 0o700 });
  for (const entry of entries.filter(value => !value.type.endsWith('link'))) {
    const target = path.join(destination, entry.name);
    if (entry.type === 'directory') await fs.mkdir(target, { recursive: true, mode: 0o700 });
    else { await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 }); await fs.writeFile(target, entry.data, { flag: 'wx', mode: 0o700 }); }
  }
  // Materialize internal links as regular files: no link can redirect later writes.
  for (const [link, original] of links) {
    let target = original; while (links.has(target)) target = links.get(target);
    const filename = path.join(destination, link); await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
    await fs.copyFile(path.join(destination, target), filename); await fs.chmod(filename, 0o700);
  }
  const files = {};
  for (const entry of entries.filter(value => value.type !== 'directory')) files[entry.name] = await digest(path.join(destination, entry.name));
  return files;
}
async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer(); server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(error => error ? reject(error) : resolve(port)); });
  });
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function createLocalTranslationController({ directory, platform = process.platform, arch = process.arch, manifest, fetcher = fetch, spawnProcess = spawn, onState = () => {}, portAllocator = availablePort, startupTimeout = 120000, pollInterval = 250, standbyTimeout = 5 * 60 * 1000 }) {
  const root = path.resolve(directory), current = path.join(root, 'installed'), staging = path.join(root, 'installing');
  const runtime = manifest.runtimes?.[`${platform}-${arch}`], supported = !!runtime;
  const model = artifact(manifest.model); if (runtime) { artifact(runtime); safePath(runtime.executable); }
  const modelId = model.id || 'hy-mt2-1.8b';
  if (!/^[a-zA-Z0-9._-]+$/.test(modelId)) throw new Error('Invalid local model identifier.');
  const state = { supported, status: 'not-installed', installed: false, downloadedBytes: 0, totalBytes: model.size + (runtime?.size || 0), progress: 0, model: modelId, error: '' };
  let installPromise, downloadController, child, startPromise, startController, connection, removePromise, stopPromise, standbyTimer, disposed = false, lastProgress = 0, stopGeneration = 0;
  const clearStandby = () => { clearTimeout(standbyTimer); standbyTimer = undefined; };
  const getState = () => ({ ...state });
  const emit = patch => { Object.assign(state, patch); try { onState(getState()); } catch { /* A closing window must not interrupt lifecycle cleanup. */ } return getState(); };
  const requireAvailable = () => { if (disposed) throw new Error('Local translation has closed.'); if (!supported) throw new Error('Local translation is not supported on this computer.'); };
  async function prepareRoot() { await fs.mkdir(root, { recursive: true, mode: 0o700 }); if ((await fs.lstat(root)).isSymbolicLink()) throw new Error('Local translation directory must not be a link.'); }
  async function inspectInstallation(full = false, signal) {
    if (!supported) return false;
    try {
      if ((await fs.lstat(current)).isSymbolicLink() || (await fs.lstat(path.join(current, 'runtime'))).isSymbolicLink()) return false;
      await regular(path.join(current, 'receipt.json'), current);
      const receipt = JSON.parse(await fs.readFile(path.join(current, 'receipt.json'), 'utf8'));
      if (receipt.model !== model.sha256 || receipt.runtime !== runtime.sha256 || receipt.executable !== runtime.executable || !receipt.files || Object.keys(receipt.files).length > 10000 || !Object.hasOwn(receipt.files, runtime.executable)) return false;
      if ((await regular(path.join(current, 'model.gguf'), current)).size !== model.size) return false;
      for (const [name, hash] of Object.entries(receipt.files)) {
        const filename = path.join(current, 'runtime', safePath(name)); await regular(filename, path.join(current, 'runtime'));
        if (!/^[a-f0-9]{64}$/.test(hash) || (full && await digest(filename, signal) !== hash)) return false;
      }
      return !full || await digest(path.join(current, 'model.gguf'), signal) === model.sha256;
    } catch { return false; }
  }
  async function refresh() {
    if (installPromise || startPromise || child) return getState();
    try {
      await prepareRoot(); const installed = await inspectInstallation();
      return emit({ installed, status: installed ? 'ready' : 'not-installed', error: '', progress: installed ? 1 : 0 });
    } catch (error) { return emit({ installed: false, status: 'error', error: error.message, progress: 0 }); }
  }
  async function download(info, filename, signal, offset) {
    let url = info.url, response;
    for (let redirects = 0; redirects < 6; redirects++) {
      signal.throwIfAborted();
      response = await fetcher(url, { signal, redirect: 'manual', credentials: 'omit', headers: { 'Accept-Encoding': 'identity' } });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const destination = new URL(response.headers.get('location'), url);
      await response.body?.cancel();
      if (destination.protocol !== 'https:' || destination.username || destination.password) throw new Error('Unsafe local translation download redirect.');
      url = destination.href;
    }
    if (!response?.ok || !response.body) throw new Error('Local translation download failed. Check your connection and try again.');
    const hash = createHash('sha256'); let received = 0; const file = await fs.open(filename, 'wx', 0o600);
    try {
      for await (const chunk of response.body) {
        signal.throwIfAborted(); received += chunk.byteLength;
        if (received > info.size) throw new Error('Local translation download size does not match.');
        hash.update(chunk); let written = 0; while (written < chunk.byteLength) { const result = await file.write(chunk, written, chunk.byteLength - written); if (!result.bytesWritten) throw new Error('Could not save local translation download.'); written += result.bytesWritten; }
        if (Date.now() - lastProgress > 200 || received === info.size) { lastProgress = Date.now(); emit({ downloadedBytes: offset + received, progress: (offset + received) / state.totalBytes }); }
      }
      signal.throwIfAborted();
      if (received !== info.size || hash.digest('hex') !== info.sha256) throw new Error('Local translation download verification failed. Please download again.');
      await file.sync();
    } finally { await file.close(); }
  }
  function install() {
    requireAvailable(); if (removePromise) return Promise.reject(new Error('Wait for local translation to finish removing.')); if (installPromise) return installPromise;
    if (child || startPromise) return Promise.reject(new Error('Stop local translation before installing.'));
    downloadController = new AbortController(); const signal = downloadController.signal;
    installPromise = (async () => {
      emit({ status: 'downloading', downloadedBytes: 0, progress: 0, error: '' });
      try {
        await prepareRoot(); await fs.rm(staging, { recursive: true, force: true }); await fs.mkdir(staging, { mode: 0o700 });
        if (fs.statfs) { const disk = await fs.statfs(root); if (disk.bavail * disk.bsize < model.size + runtime.size + MAX_EXPANDED + 64 * 1024 * 1024) throw new Error('Not enough free disk space for local translation.'); }
        await download(runtime, path.join(staging, 'runtime.archive'), signal, 0);
        const files = await extractArchive(path.join(staging, 'runtime.archive'), path.join(staging, 'runtime'), runtime.format);
        if (!Object.hasOwn(files, runtime.executable)) throw new Error('Local translation runtime is missing its executable.');
        signal.throwIfAborted();
        await download(model, path.join(staging, 'model.gguf'), signal, runtime.size);
        await fs.rm(path.join(staging, 'runtime.archive'));
        await fs.writeFile(path.join(staging, 'receipt.json'), JSON.stringify({ version: 1, model: model.sha256, runtime: runtime.sha256, executable: runtime.executable, files }), { mode: 0o600 });
        signal.throwIfAborted();
        // Install remains invisible until both artifacts have been verified.
        const previous = path.join(root, 'previous'); await fs.rm(previous, { recursive: true, force: true });
        try { await fs.rename(current, previous); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        try { await fs.rename(staging, current); } catch (error) { await fs.rename(previous, current).catch(() => {}); throw error; }
        await fs.rm(previous, { recursive: true, force: true });
        return emit({ status: 'ready', installed: true, downloadedBytes: state.totalBytes, progress: 1, error: '' });
      } catch (error) {
        await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
        const installed = await inspectInstallation();
        emit({ installed, status: signal.aborted ? (installed ? 'ready' : 'not-installed') : 'error', progress: installed ? 1 : 0, error: signal.aborted ? '' : error.message });
        if (!signal.aborted) throw error; return getState();
      } finally { downloadController = undefined; installPromise = undefined; }
    })();
    return installPromise;
  }
  async function cancelDownload() { downloadController?.abort(); await installPromise; return getState(); }
  function stop() {
    clearStandby();
    stopGeneration++;
    if (stopPromise) return stopPromise;
    startController?.abort(); connection = undefined;
    const stopping = child; child = undefined;
    stopPromise = (async () => {
      if (stopping) {
        const exited = new Promise(resolve => stopping.once('exit', resolve));
        if (platform === 'win32' && stopping.pid) {
          const killer = spawnProcess(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(stopping.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
          killer.on('error', () => { try { stopping.kill(); } catch {} });
        } else { try { stopping.kill('SIGTERM'); } catch {} }
        await Promise.race([exited, pause(1500)]);
        if (stopping.exitCode === null || stopping.exitCode === undefined) { try { stopping.kill('SIGKILL'); } catch {} }
      }
      if (state.installed) emit({ status: 'ready' });
      return getState();
    })().finally(() => { stopPromise = undefined; });
    return stopPromise;
  }
  // Only a completed task may enter standby; cancellation still calls stop().
  function standby() {
    clearStandby();
    if (disposed || stopPromise || startPromise || !connection || !child) return false;
    emit({ status: 'standby' });
    standbyTimer = setTimeout(() => { standbyTimer = undefined; void stop(); }, standbyTimeout);
    standbyTimer.unref?.();
    return true;
  }
  function start() {
    requireAvailable(); if (removePromise) return Promise.reject(new Error('Wait for local translation to finish removing.'));
    if (stopPromise) {
      const generation = stopGeneration;
      return stopPromise.then(() => {
        if (generation !== stopGeneration) throw new Error('Local translation was cancelled.');
        return start();
      });
    }
    clearStandby();
    if (connection && child) { emit({ status: 'running', error: '' }); return Promise.resolve({ ...connection }); } if (startPromise) return startPromise;
    if (installPromise) return Promise.reject(new Error('Wait for local translation to finish downloading.'));
    startController = new AbortController(); const signal = startController.signal;
    startPromise = (async () => {
      try {
        const installed = await inspectInstallation(true, signal); signal.throwIfAborted();
        if (!installed) { emit({ installed: false }); throw new Error('Local translation is not installed or has changed. Download it again.'); } emit({ status: 'starting', error: '', installed: true });
        const port = await portAllocator(); signal.throwIfAborted();
        const token = randomBytes(32).toString('hex'), baseUrl = `http://127.0.0.1:${port}/v1`;
        const executable = path.join(current, 'runtime', runtime.executable);
        const args = ['--model', path.join(current, 'model.gguf'), '--host', '127.0.0.1', '--port', String(port), '--api-key', token, '--alias', modelId, '--ctx-size', '8192', '--predict', '4096', '--temp', '0.7', '--top-p', '0.6', '--top-k', '20', '--repeat-penalty', '1.05', '--parallel', '1', '--n-gpu-layers', platform === 'darwin' ? '99' : '0', '--jinja'];
        const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'LANG', 'LC_ALL'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
        const processChild = spawnProcess(executable, args, { cwd: path.dirname(executable), env, windowsHide: true, stdio: 'ignore' }); child = processChild;
        let processError;
        processChild.once('error', error => { processError = error; });
        processChild.once('exit', () => {
          if (child !== processChild) return; clearStandby(); child = undefined; connection = undefined;
          if (!signal.aborted) emit({ status: 'error', error: 'Local translation stopped unexpectedly. Start it again.' });
        });
        const deadline = Date.now() + startupTimeout;
        while (Date.now() < deadline) {
          signal.throwIfAborted(); if (processError || child !== processChild) throw new Error('Local translation could not start on this computer.');
          try {
            const response = await fetcher(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.any([signal, AbortSignal.timeout(2000)]), redirect: 'error', headers: { Authorization: `Bearer ${token}` } });
            await response.body?.cancel(); if (response.ok) { connection = { baseUrl, token, model: modelId }; emit({ status: 'running' }); return { ...connection }; }
          } catch { signal.throwIfAborted(); }
          await pause(pollInterval);
        }
        throw new Error('Local translation took too long to start. Close other applications and try again.');
      } catch (error) {
        const cancelled = signal.aborted; await stop(); emit({ status: cancelled ? (state.installed ? 'ready' : 'not-installed') : 'error', error: cancelled ? '' : error.message }); throw error;
      } finally { startPromise = undefined; startController = undefined; }
    })();
    return startPromise;
  }
  function remove() { if (removePromise) return removePromise; removePromise = (async () => { try { await cancelDownload(); await stop(); if (startPromise) await startPromise.catch(() => {}); await Promise.all([current, staging, path.join(root, 'previous')].map(filename => fs.rm(filename, { recursive: true, force: true }))); return emit({ installed: false, status: 'not-installed', downloadedBytes: 0, progress: 0, error: '' }); } finally { removePromise = undefined; } })(); return removePromise; }
  async function dispose() { disposed = true; await cancelDownload().catch(() => {}); await stop(); if (startPromise) await startPromise.catch(() => {}); }
  return { getState, refresh, install, cancelDownload, remove, start, standby, stop, dispose };
}
module.exports = { createLocalTranslationController, extractArchive };
