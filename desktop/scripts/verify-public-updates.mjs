import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, open, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { validateUpdateVersion, verifyUpdateDirectory } from './verify-update-metadata.mjs';

const evidenceHeaders = ['content-length', 'content-type', 'content-range', 'cache-control', 'cf-cache-status', 'etag', 'age', 'last-modified'];
const longCacheSeconds = 31_536_000;
const defaultLimit = 1024 * 1024 * 1024;
const manifestLimit = 1024 * 1024;
const fail = message => { throw new Error(message); };

export function publicUpdateRoot(arch, platform = 'mac') {
  if (platform === 'windows-preview') {
    if (arch !== 'x64') fail('Unsupported public update architecture.');
    return 'https://updates.lumior.work/windows/x64/';
  }
  if (platform !== 'mac') fail('Unsupported public update platform.');
  if (!['arm64', 'x64'].includes(arch)) fail('Unsupported public update architecture.');
  return `https://updates.lumior.work/mac/${arch}/`;
}

function cachePolicy(headers, manifest) {
  const value = headers.get('cache-control') || '';
  const directives = value.toLowerCase().split(',').map(part => part.trim());
  const age = directives.find(part => part.startsWith('max-age='));
  const seconds = age && /^max-age=\d+$/.test(age) ? Number(age.slice(8)) : undefined;
  if (manifest) {
    if (!directives.some(part => part === 'no-cache' || part === 'no-store')
      || directives.includes('immutable') || (seconds !== undefined && seconds !== 0)) fail('Public manifest must disable caching.');
  } else if (!directives.includes('public') || !directives.includes('immutable')
    || !Number.isSafeInteger(seconds) || seconds < longCacheSeconds
    || directives.some(part => ['private', 'no-store', 'no-cache'].includes(part))) {
    fail('Versioned public artifacts must use public, long-lived immutable caching.');
  }
}

function contentTypeAllowed(name, value) {
  const type = (value || '').split(';')[0].trim().toLowerCase();
  if (name === 'latest-mac.yml' || name === 'windows-preview.yml') return ['text/yaml', 'text/x-yaml', 'application/yaml', 'application/x-yaml', 'text/plain', 'application/octet-stream'].includes(type);
  if (name.endsWith('.blockmap')) return ['application/octet-stream', 'application/gzip', 'application/x-gzip'].includes(type);
  if (name.endsWith('.zip')) return ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'].includes(type);
  if (name.endsWith('.exe')) return ['application/vnd.microsoft.portable-executable', 'application/x-msdownload', 'application/x-msdos-program', 'application/octet-stream'].includes(type);
  return ['application/x-apple-diskimage', 'application/octet-stream'].includes(type);
}

async function localHashes(filename) {
  const sha256 = createHash('sha256'), sha512 = createHash('sha512');
  for await (const chunk of createReadStream(filename)) { sha256.update(chunk); sha512.update(chunk); }
  return { sha256: sha256.digest('hex'), sha512: sha512.digest('base64') };
}

async function boundedRegularFile(filename, limit) {
  const stat = await lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > limit) fail('Local update files must be bounded regular files.');
  return stat;
}

async function verifyLocal({ directory, version, arch, platform, maxArtifactBytes }) {
  const windowsPreview = platform === 'windows-preview';
  const manifestName = windowsPreview ? 'windows-preview.yml' : 'latest-mac.yml';
  const names = (windowsPreview ? ['exe'] : ['zip', 'dmg']).flatMap(extension => {
    const name = `Lumior-${version}-${windowsPreview ? 'windows' : 'mac'}-${arch}.${extension}`;
    return [name, `${name}.blockmap`];
  });
  for (const name of [...names, manifestName, 'SHA256SUMS.txt', 'release-verification.json']) {
    await boundedRegularFile(path.join(directory, name), /\.(zip|dmg|exe)$/.test(name) ? maxArtifactBytes : manifestLimit);
  }
  const verified = await verifyUpdateDirectory({ directory, version, arch, platform });
  const recorded = JSON.parse(await readFile(path.join(directory, 'release-verification.json'), 'utf8'));
  if (recorded.version !== version || recorded.arch !== arch || recorded.platform !== platform
    || JSON.stringify(recorded.files) !== JSON.stringify(verified.files)
    || JSON.stringify(recorded.checksums) !== JSON.stringify(verified.checksums)
    || await readFile(path.join(directory, 'SHA256SUMS.txt'), 'utf8') !== `${verified.checksums.join('\n')}\n`) {
    fail('Local release verification records do not match the verified update directory.');
  }
  const files = [];
  for (const name of names) {
    const bytes = (await lstat(path.join(directory, name))).size;
    files.push({ name, bytes, ...await localHashes(path.join(directory, name)) });
  }
  return { files, manifestName, manifest: await readFile(path.join(directory, manifestName)) };
}

// Streams downloads through hashes; only bounded Range/manifest bytes enter memory.
async function requestBytes({ url, name, bytes, range, manifest, fetcher, requestTimeoutMs, collect }) {
  const controller = new AbortController();
  const timeoutError = new Error('Public update request timed out.');
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = reject; });
  const timer = setTimeout(() => { controller.abort(); rejectAbort(timeoutError); }, requestTimeoutMs);
  const started = Date.now();
  let response, reader;
  try {
    try {
      response = await Promise.race([fetcher(url, {
        method: 'GET', redirect: 'manual', credentials: 'omit', signal: controller.signal,
        headers: { 'Accept-Encoding': 'identity', ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}) },
      }), aborted]);
    } catch (error) {
      if (error === timeoutError) throw error;
      fail('Public update HTTPS request failed.');
    }
    if (response.status !== (range ? 206 : 200) || response.redirected || (response.url && response.url !== url)) fail('Public update response status or redirect is invalid.');
    const length = response.headers.get('content-length');
    if (!/^(0|[1-9]\d*)$/.test(length || '') || Number(length) !== bytes) fail('Public update Content-Length is invalid.');
    if (!contentTypeAllowed(name, response.headers.get('content-type'))) fail('Public update Content-Type is invalid.');
    const encoding = response.headers.get('content-encoding');
    if (encoding && encoding.toLowerCase() !== 'identity') fail('Public update content must not use transport compression.');
    cachePolicy(response.headers, manifest);
    if (range && response.headers.get('content-range') !== `bytes ${range.start}-${range.end}/${range.total}`) fail('Public update Content-Range is invalid.');
    if (!range && response.headers.has('content-range')) fail('Full public update response must not include Content-Range.');
    if (!response.body) fail('Public update response has no body.');
    const sha256 = createHash('sha256'), sha512 = createHash('sha512'), chunks = [];
    let received = 0;
    reader = response.body.getReader();
    while (true) {
      let next;
      try { next = await Promise.race([reader.read(), aborted]); }
      catch (error) { if (error === timeoutError) throw error; fail('Public update response stream failed.'); }
      if (next.done) break;
      received += next.value.byteLength;
      if (received > bytes) fail('Public update response exceeds its expected size.');
      sha256.update(next.value); sha512.update(next.value);
      if (collect) chunks.push(Buffer.from(next.value));
    }
    if (received !== bytes) fail('Public update response ended before its expected size.');
    const headers = Object.fromEntries(evidenceHeaders.map(key => [key, response.headers.get(key)]));
    return { bytes: received, sha256: sha256.digest('hex'), sha512: sha512.digest('base64'), headers,
      status: response.status, milliseconds: Date.now() - started, ...(collect ? { content: Buffer.concat(chunks) } : {}) };
  } finally {
    clearTimeout(timer);
    if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); }
    else if (response?.body) void response.body.cancel().catch(() => {});
  }
}

export async function verifyPublicUpdates({ directory, version, arch = 'arm64', platform = 'mac', manifest = false,
  fetcher = globalThis.fetch, requestTimeoutMs = 180_000, maxArtifactBytes = defaultLimit, rangeBytes = 1024 }) {
  validateUpdateVersion(version, platform);
  const root = publicUpdateRoot(arch, platform);
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') fail('TLS certificate verification must remain enabled.');
  if (typeof fetcher !== 'function' || !Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 600_000
    || !Number.isSafeInteger(maxArtifactBytes) || maxArtifactBytes < 1 || maxArtifactBytes > defaultLimit
    || !Number.isSafeInteger(rangeBytes) || rangeBytes < 1 || rangeBytes > 65_536 || typeof manifest !== 'boolean') fail('Invalid public update verification limits.');
  const local = await verifyLocal({ directory, version, arch, platform, maxArtifactBytes });
  const files = [];
  for (const file of local.files) {
    const url = new URL(file.name, root).href;
    const full = await requestBytes({ url, name: file.name, bytes: file.bytes, fetcher, requestTimeoutMs, manifest: false });
    if (full.sha256 !== file.sha256 || full.sha512 !== file.sha512) fail(`Public update hash mismatch: ${file.name}.`);
    const length = Math.min(rangeBytes, file.bytes);
    const start = Math.floor((file.bytes - length) / 2), end = start + length - 1;
    const handle = await open(path.join(directory, file.name), 'r');
    const expected = Buffer.alloc(length);
    try { if ((await handle.read(expected, 0, length, start)).bytesRead !== length) fail('Local Range comparison bytes could not be read.'); }
    finally { await handle.close(); }
    const ranged = await requestBytes({ url, name: file.name, bytes: length, range: { start, end, total: file.bytes }, manifest: false,
      fetcher, requestTimeoutMs, collect: true });
    if (!ranged.content.equals(expected)) fail(`Public update Range bytes mismatch: ${file.name}.`);
    const { content: _rangeContent, ...rangeEvidence } = ranged;
    files.push({ name: file.name, url, full, range: { start, end, ...rangeEvidence } });
  }
  let manifestEvidence;
  if (manifest) {
    const url = new URL(local.manifestName, root).href;
    const response = await requestBytes({ url, name: local.manifestName, bytes: local.manifest.length, manifest: true, fetcher, requestTimeoutMs, collect: true });
    if (!response.content.equals(local.manifest)) fail('Public manifest must match the verified local manifest byte for byte.');
    const { content: _manifestContent, ...evidence } = response;
    manifestEvidence = { url, ...evidence };
  }
  return { schemaVersion: 1, checkedAt: new Date().toISOString(), version, platform, arch, root,
    readOnly: true, tlsCertificateVerificationEnabled: true, manifestChecked: manifest, files,
    ...(manifestEvidence ? { manifest: manifestEvidence } : {}) };
}

export async function writePublicUpdateVerification({ output, ...options }) {
  if (!output) fail('A separate --output report path is required.');
  const directory = await realpath(options.directory);
  const reportPath = path.resolve(output);
  // Resolve the nearest existing ancestor before mkdir, including symlinked parents.
  // A rejected destination must not leave a new directory in accepted release files.
  let ancestor = path.dirname(reportPath), ancestorPath;
  const missingParts = [];
  while (!ancestorPath) {
    try { ancestorPath = await realpath(ancestor); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      missingParts.unshift(path.basename(ancestor));
      ancestor = path.dirname(ancestor);
    }
  }
  const realParent = path.join(ancestorPath, ...missingParts);
  const destination = path.join(realParent, path.basename(reportPath));
  const relative = path.relative(directory, destination);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) fail('Public verification reports must be outside the local update directory.');
  try {
    if ((await lstat(destination)).isSymbolicLink()) fail('Public verification reports must not overwrite a symbolic link.');
    fail('Public verification report already exists; choose a new --output path.');
  }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(realParent, { recursive: true });
  const report = await verifyPublicUpdates({ ...options, directory });
  await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { directory: { type: 'string' }, version: { type: 'string' }, arch: { type: 'string', default: 'arm64' }, platform: { type: 'string', default: 'mac' },
      output: { type: 'string' }, manifest: { type: 'boolean', default: false } } });
    if (!values.directory || !values.version || !values.output) fail('--directory, --version and --output are required.');
    const report = await writePublicUpdateVerification({ ...values, directory: path.resolve(values.directory) });
    console.log(`Verified ${report.files.length} public versioned files for ${report.version}/${report.arch}${report.manifestChecked ? ' and the active manifest' : '; active manifest was not requested'}. No uploads or activation performed.`);
  } catch (error) {
    // Errors from local OS/network APIs can include paths or credentials; expose only our fixed validation messages.
    const message = error.message || '';
    console.error(/^(Public |Versioned public |TLS |Unsupported public |Invalid public |Local |A separate |--directory)/.test(message) ? message : 'Public update verification failed; check the local release directory and separate output path.');
    process.exitCode = 1;
  }
}
