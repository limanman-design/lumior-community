import { readdir, readFile, realpath, mkdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const compare = (a, b) => a.localeCompare(b, 'en');
const licenseName = /^(?:licen[sc]es?|notices?|copying|copyright|unlicense)(?:[._-].*)?$/i;
const sourceLicenses = /\b(?:A?GPL|LGPL|MPL|EPL|CDDL|EUPL|OSL|CPL)(?:-|\b)/i;
const portable = value => value.split(path.sep).join('/');
const exists = async file => { try { return await stat(file); } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; } };

function publicRepository(value) {
  const text = typeof value === 'string' ? value : value?.url;
  if (typeof text !== 'string') return null;
  if (/^(?:github|gitlab|bitbucket):[\w.-]+\/[\w.-]+$/.test(text) || /^[\w.-]+\/[\w.-]+$/.test(text)) return text;
  try {
    const url = new URL(text.replace(/^git\+/, ''));
    if (!['https:', 'http:', 'git:', 'ssh:'].includes(url.protocol)) return null;
    url.username = ''; url.password = ''; url.search = ''; url.hash = '';
    return url.toString();
  } catch { return null; }
}
function metadataLicense(manifest) {
  const value = manifest.license ?? manifest.licenses;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(item => typeof item === 'string' ? item : item?.type).filter(item => typeof item === 'string').join(' OR ') || null;
  return typeof value?.type === 'string' ? value.type : null;
}
function matchesPlatform(values, platform) {
  if (!Array.isArray(values)) return true;
  if (values.includes(`!${platform}`)) return false;
  const positive = values.filter(value => !value.startsWith('!'));
  return !positive.length || positive.includes(platform) || positive.includes('any');
}
async function packageLicenseFiles(directory) {
  const files = [];
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || entry.name === 'node_modules' || entry.name === '.git') continue;
      const filename = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(filename);
      else if (entry.isFile() && licenseName.test(entry.name)) {
        const bytes = await readFile(filename);
        files.push({ path: portable(path.relative(directory, filename)), sha256: hash(bytes), bytes: bytes.length, text: bytes.toString('utf8') });
      }
    }
  }
  await visit(directory);
  return files.sort((a, b) => compare(a.path, b.path));
}

/** Installed-package evidence only. It intentionally does not decide which
 * packages a bundler/compiler ships or whether a license combination is lawful. */
export async function auditDependencyLicenses({ root, destination }) {
  root = path.resolve(root); destination = path.resolve(destination);
  if (destination === root || destination.startsWith(path.join(root, 'node_modules') + path.sep) || destination.startsWith(path.join(root, 'desktop', 'node_modules') + path.sep)) throw new Error('Choose a separate audit output directory.');
  const installations = new Map(), missing = [], manifests = [];
  async function installed(directory, store) {
    let resolved;
    try { resolved = await realpath(directory); } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
    if (installations.has(resolved)) { installations.get(resolved).stores.add(store); return installations.get(resolved); }
    let manifest;
    try { manifest = JSON.parse(await readFile(path.join(resolved, 'package.json'), 'utf8')); } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
    if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') return undefined;
    const item = { directory: resolved, manifest, stores: new Set([store]), direct: new Set(), reachable: new Set(), files: await packageLicenseFiles(resolved) };
    installations.set(resolved, item);
    return item;
  }
  for (const [project, relative] of [['root', ''], ['desktop', 'desktop']]) {
    const directory = path.join(root, relative);
    if (!await exists(path.join(directory, 'package.json'))) continue;
    const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
    manifests.push({ project, directory, manifest });
    const store = path.join(directory, 'node_modules/.pnpm');
    if (!await exists(store)) throw new Error(`Missing installed pnpm dependencies for ${project}; install its lockfile first.`);
    for (const entry of await readdir(store, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'node_modules') continue;
      const modules = path.join(store, entry.name, 'node_modules');
      if (!await exists(modules)) continue;
      for (const pkg of await readdir(modules, { withFileTypes: true })) {
        if (!pkg.isDirectory() || pkg.name.startsWith('.')) continue;
        if (pkg.name.startsWith('@')) {
          for (const scoped of await readdir(path.join(modules, pkg.name), { withFileTypes: true })) {
            if (scoped.isDirectory()) await installed(path.join(modules, pkg.name, scoped.name), project);
          }
        } else await installed(path.join(modules, pkg.name), project);
      }
    }
  }
  const resolutions = new Map();
  async function resolveDependency(base, name, project) {
    const key = base + ':' + name;
    if (resolutions.has(key)) return resolutions.get(key);
    let directory = base, result;
    while (true) {
      const candidate = path.join(directory, 'node_modules', name);
      if (await exists(path.join(candidate, 'package.json'))) { result = await installed(candidate, project); break; }
      const parent = path.dirname(directory);
      if (directory === parent || directory === root) break;
      directory = parent;
    }
    resolutions.set(key, result);
    return result;
  }
  const queue = [];
  for (const { project, directory, manifest } of manifests) {
    for (const [field, scope] of [['dependencies', 'runtime'], ['devDependencies', 'development'], ['optionalDependencies', 'optional-runtime']]) {
      for (const name of Object.keys(manifest[field] || {}).sort(compare)) {
        const item = await resolveDependency(directory, name, project);
        if (!item) { missing.push({ project, parent: 'project-manifest', name, field, requested: manifest[field][name], optional: field === 'optionalDependencies' }); continue; }
        item.direct.add(`${project}:${scope}`); queue.push({ item, role: `${project}:${scope}`, project });
      }
    }
  }
  for (let index = 0; index < queue.length; index++) {
    const { item, role, project } = queue[index];
    if (item.reachable.has(role)) continue;
    item.reachable.add(role);
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const name of Object.keys(item.manifest[field] || {}).sort(compare)) {
        const child = await resolveDependency(item.directory, name, project);
        if (child) queue.push({ item: child, role, project });
        else missing.push({ project, parent: `${item.manifest.name}@${item.manifest.version}`, name, field, requested: item.manifest[field][name], optional: field === 'optionalDependencies' || (field === 'peerDependencies' && item.manifest.peerDependenciesMeta?.[name]?.optional === true) });
      }
    }
  }
  const grouped = new Map();
  for (const item of installations.values()) {
    const license = metadataLicense(item.manifest), repository = publicRepository(item.manifest.repository);
    const key = JSON.stringify([item.manifest.name, item.manifest.version, license, repository, item.files.map(({ path, sha256 }) => ({ path, sha256 }))]);
    if (!grouped.has(key)) grouped.set(key, { ...item, stores: new Set(), direct: new Set(), reachable: new Set() });
    const group = grouped.get(key);
    for (const field of ['stores', 'direct', 'reachable']) for (const entry of item[field]) group[field].add(entry);
  }
  const texts = [], packages = [], issues = [];
  for (const [key, item] of [...grouped].sort(([, a], [, b]) => compare(a.manifest.name, b.manifest.name) || compare(a.manifest.version, b.manifest.version))) {
    const manifest = item.manifest, license = metadataLicense(manifest), id = `${manifest.name}@${manifest.version}#${hash(key).slice(0, 12)}`;
    const platformMatches = matchesPlatform(manifest.os, process.platform) && matchesPlatform(manifest.cpu, process.arch);
    const record = { id, name: manifest.name, version: manifest.version, license, repository: publicRepository(manifest.repository), installedStores: [...item.stores].sort(compare),
      direct: [...item.direct].sort(compare), reachableFrom: [...item.reachable].sort(compare), relationship: item.direct.size ? 'direct' : item.reachable.size ? 'transitive' : 'not-reached-from-current-manifests',
      platform: { os: manifest.os || null, cpu: manifest.cpu || null, libc: manifest.libc || null, osAndCpuMatchAuditHost: platformMatches },
      distribution: 'not-determined-from-installation', licenseFiles: item.files.map(({ text: _text, ...file }) => file), review: [] };
    if (!license) record.review.push('Missing package license metadata; review any supplied license text before deciding terms.');
    if (!item.files.length) record.review.push('No LICENSE/NOTICE/COPYING/COPYRIGHT file found in this installed package; source or bundled upstream notices may be needed.');
    if (license && sourceLicenses.test(license)) record.review.push('Source-availability/copyleft license indicated; review actual distribution, corresponding source and applicable notices.');
    if (license && /SEE\s+LICEN[SC]E|UNLICENSED|LicenseRef-|custom/i.test(license)) record.review.push('Custom, file-referenced or restricted metadata requires manual review.');
    if (!platformMatches) record.review.push('Installed optional/platform package does not match the audit host; do not assume it is shipped on this host or absent on another target.');
    if (!item.reachable.size) record.review.push('Installed store entry is not reached from current manifests; may be stale/cache-only, not proof of distribution.');
    if (manifest.name === 'electron') record.review.push('Electron is declared as a development tool but its runtime is redistributed by desktop packaging; include Chromium and bundled component notices.');
    packages.push(record);
    if (record.review.length) issues.push({ id, name: manifest.name, version: manifest.version, review: record.review });
    texts.push(`\n${'='.repeat(78)}\n${id}\nDeclared license: ${license || '(missing)'}\nRepository: ${record.repository || '(not supplied)'}\n`);
    for (const file of item.files) texts.push(`\n--- ${file.path} | SHA-256 ${file.sha256} | ${file.bytes} bytes ---\n${file.text}\n`);
  }
  const unresolved = [...new Map(missing.map(item => [JSON.stringify(item), item])).values()];
  const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), host: { platform: process.platform, arch: process.arch, node: process.version },
    scope: 'Currently installed root and desktop pnpm packages, including development tools, transitive dependencies, stale store entries and host-available optional packages. Not a lockfile-complete inventory for every platform and not a packaged-artifact SBOM.',
    limitations: ['No legal compatibility conclusion or permission grant.', 'Direct/development/reachability are manifest evidence, not proof of inclusion or exclusion from a release.', 'Optional packages absent on this host, Python engines, external downloads, vendored code and product assets require separate inventories.', 'Repository values are metadata, not independently verified provenance. License text is copied verbatim from installed packages; source files are not copied.'],
    summary: { packageRecords: packages.length, physicalInstallations: installations.size, withReviewItems: issues.length, missingLicenseMetadata: packages.filter(item => !item.license).length, withoutLicenseFiles: packages.filter(item => !item.licenseFiles.length).length, sourceLicenseReview: packages.filter(item => item.license && sourceLicenses.test(item.license)).length, unresolvedDependencies: unresolved.length },
    packages, unresolvedDependencies: unresolved, reviewItems: issues };
  await mkdir(destination, { recursive: true });
  await writeFile(path.join(destination, 'dependency-licenses.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(path.join(destination, 'THIRD-PARTY-LICENSE-TEXTS.txt'), 'Installed dependency license evidence. This is not a legal compliance declaration.\nSee dependency-licenses.json for scope, versions, reachability and unresolved items.\n' + texts.join(''));
  return report;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  let values;
  try { ({ values } = parseArgs({ options: { output: { type: 'string' }, root: { type: 'string' } }, strict: true, allowPositionals: false })); } catch {}
  if (!values?.output) {
    console.error('Usage: node scripts/audit-dependency-licenses.mjs --output <evidence-directory> [--root <installed-project>]'); process.exitCode = 1;
  } else {
    auditDependencyLicenses({ root: values.root || fileURLToPath(new URL('../', import.meta.url)), destination: values.output }).then(report => console.log(JSON.stringify(report.summary, null, 2))).catch(error => { console.error(error.code ? `Dependency audit failed (${error.code}). Check the installed dependency trees and output directory.` : error.message); process.exitCode = 1; });
  }
}
