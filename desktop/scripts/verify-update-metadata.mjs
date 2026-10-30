import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { validateReleaseVersion } from './release-config.mjs';

const require = createRequire(import.meta.url);
// Reuse the YAML parser already locked by electron-builder; no runtime dependency is added.
const builderRequire = createRequire(require.resolve('electron-builder'));
const libraryRequire = createRequire(builderRequire.resolve('app-builder-lib'));
export const parseYaml = source => libraryRequire('js-yaml').load(source);
const { blake2b } = libraryRequire('@noble/hashes/blake2.js');

async function verifyBlockChecksums(filename, blockmap, blockmapName) {
  const stream = createReadStream(filename);
  const chunks = stream[Symbol.asyncIterator]();
  let pending = Buffer.alloc(0);
  let pendingOffset = 0;
  try {
    for (const blockFile of blockmap.files) {
      for (let index = 0; index < blockFile.sizes.length; index++) {
        const expected = blockFile.checksums[index];
        if (typeof expected !== 'string' || !/^[A-Za-z0-9+/]{24}$/.test(expected)
          || Buffer.from(expected, 'base64').length !== 18 || Buffer.from(expected, 'base64').toString('base64') !== expected) {
          throw new Error(`Invalid blockmap checksum: ${blockmapName}.`);
        }
        const bytes = Buffer.allocUnsafe(blockFile.sizes[index]);
        let filled = 0;
        while (filled < bytes.length) {
          if (pendingOffset === pending.length) {
            const next = await chunks.next();
            if (next.done) throw new Error(`Blockmap file ended early: ${blockmapName}.`);
            pending = next.value;
            pendingOffset = 0;
          }
          const count = Math.min(bytes.length - filled, pending.length - pendingOffset);
          pending.copy(bytes, filled, pendingOffset, pendingOffset + count);
          pendingOffset += count;
          filled += count;
        }
        // Same algorithm and 18-byte digest as app-builder-lib 26.15.3's buildBlockMap.
        const actual = Buffer.from(blake2b(bytes, { dkLen: 18 })).toString('base64');
        if (actual !== expected) throw new Error(`Blockmap checksum mismatch: ${blockmapName}.`);
      }
    }
    if (pendingOffset !== pending.length || !(await chunks.next()).done) throw new Error(`Blockmap file has uncovered bytes: ${blockmapName}.`);
  } finally {
    stream.destroy();
  }
}

async function hashFile(filename, algorithm, encoding) {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest(encoding);
}

async function regularFile(filename) {
  const stat = await lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Release artifacts must be regular files.');
  return stat;
}

export function validateUpdateVersion(version, platform) {
  if (platform !== 'windows-preview') return validateReleaseVersion(version);
  if (typeof version !== 'string' || version.length > 96
    || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-win\.([1-9]\d*)$/.test(version)
    || version.split(/[.-]/).filter(part => part !== 'win').some(part => !Number.isSafeInteger(Number(part)))) {
    throw new Error('Windows preview update version must be major.minor.patch-win.N with a positive revision.');
  }
  return version;
}

export async function verifyUpdateDirectory({ directory, version, platform = 'mac', arch = 'arm64' }) {
  validateUpdateVersion(version, platform);
  if (!['mac', 'win', 'windows-preview'].includes(platform) || !['arm64', 'x64'].includes(arch) || (platform !== 'mac' && arch !== 'x64')) {
    throw new Error('Unsupported update verification target.');
  }
  const windowsPreview = platform === 'windows-preview';
  const metadataName = platform === 'mac' ? 'latest-mac.yml' : windowsPreview ? 'windows-preview.yml' : 'latest.yml';
  await regularFile(path.join(directory, metadataName));
  const metadata = parseYaml(await readFile(path.join(directory, metadataName), 'utf8'));
  if (!metadata || metadata.version !== version || !Array.isArray(metadata.files) || metadata.files.length === 0) {
    throw new Error('Update metadata version or file list is invalid.');
  }
  if (windowsPreview && (metadata.packages !== undefined || metadata.files.length !== 1)) {
    throw new Error('Windows preview metadata must contain only the complete NSIS installer.');
  }
  const requiredExtensions = platform === 'mac' ? ['zip', 'dmg'] : ['exe'];
  const allowedNames = new Set([metadataName, 'SHA256SUMS.txt', 'release-verification.json']);
  const files = [];
  for (const entry of metadata.files) {
    const extension = typeof entry?.url === 'string' ? entry.url.split('.').at(-1) : '';
    const expectedName = `Lumior-${version}-${windowsPreview ? 'windows' : platform}-${arch}.${extension}`;
    if (!requiredExtensions.includes(extension) || entry.url !== expectedName || allowedNames.has(entry.url)
      || typeof entry.sha512 !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(entry.sha512)) {
      throw new Error('Update metadata must reference unique, versioned artifacts within its own architecture directory.');
    }
    const filename = path.join(directory, entry.url);
    const stat = await regularFile(filename);
    if (windowsPreview && (!Number.isSafeInteger(entry.size) || entry.size <= 0)) throw new Error('Windows preview artifact size is required.');
    if (entry.size !== undefined && entry.size !== stat.size) throw new Error(`Update artifact size mismatch: ${entry.url}.`);
    if (await hashFile(filename, 'sha512', 'base64') !== entry.sha512) throw new Error(`Update SHA-512 mismatch: ${entry.url}.`);
    const blockmapName = `${entry.url}.blockmap`;
    await regularFile(path.join(directory, blockmapName));
    const blockmap = JSON.parse(gunzipSync(await readFile(path.join(directory, blockmapName)), { maxOutputLength: 64 * 1024 * 1024 }).toString('utf8'));
    if (blockmap.version !== '2' || !Array.isArray(blockmap.files) || blockmap.files.length === 0) throw new Error(`Invalid blockmap: ${blockmapName}.`);
    let coveredBytes = 0;
    for (const blockFile of blockmap.files) {
      if (blockFile.offset !== coveredBytes || !Array.isArray(blockFile.sizes) || !Array.isArray(blockFile.checksums)
        || blockFile.sizes.length !== blockFile.checksums.length || !blockFile.sizes.length
        || blockFile.sizes.some(size => !Number.isSafeInteger(size) || size <= 0 || size > 32768)) throw new Error(`Invalid blockmap coverage: ${blockmapName}.`);
      coveredBytes += blockFile.sizes.reduce((sum, size) => sum + size, 0);
    }
    if (coveredBytes !== stat.size) throw new Error(`Blockmap size mismatch: ${blockmapName}.`);
    await verifyBlockChecksums(filename, blockmap, blockmapName);
    if (entry.blockMapSize !== undefined && entry.blockMapSize !== (await lstat(path.join(directory, blockmapName))).size) {
      throw new Error(`Blockmap metadata size mismatch: ${blockmapName}.`);
    }
    allowedNames.add(entry.url);
    allowedNames.add(blockmapName);
    files.push({ name: entry.url, bytes: stat.size, sha512: entry.sha512 });
  }
  for (const extension of requiredExtensions) {
    if (!files.some(file => file.name.endsWith(`.${extension}`))) throw new Error(`Required ${extension.toUpperCase()} update artifact is missing.`);
  }
  const primary = files.find(file => file.name === metadata.path);
  if (!primary || metadata.sha512 !== primary.sha512 || (platform === 'mac' && !primary.name.endsWith('.zip'))) {
    throw new Error('Legacy update path/hash must match the primary update artifact.');
  }
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !allowedNames.has(entry.name)) throw new Error('Update upload directory contains an unexpected file or directory.');
  }
  const checksums = [];
  for (const name of [...allowedNames].filter(name => !['SHA256SUMS.txt', 'release-verification.json'].includes(name)).sort()) {
    checksums.push(`${await hashFile(path.join(directory, name), 'sha256', 'hex')}  ${name}`);
  }
  return { version, platform, arch, metadataName, files, checksums, externallyPublished: false };
}

export async function writeUpdateVerification(options) {
  const report = await verifyUpdateDirectory(options);
  await writeFile(path.join(options.directory, 'SHA256SUMS.txt'), `${report.checksums.join('\n')}\n`);
  await writeFile(path.join(options.directory, 'release-verification.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { directory: { type: 'string' }, version: { type: 'string' }, platform: { type: 'string', default: 'mac' }, arch: { type: 'string', default: 'arm64' } } });
    if (!values.directory || !values.version) throw new Error('--directory and --version are required.');
    const report = await writeUpdateVerification({ ...values, directory: path.resolve(values.directory) });
    console.log(`Verified ${report.files.length} ${report.platform}/${report.arch} artifacts for ${report.version}. No files uploaded.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
