import { spawnSync } from 'node:child_process';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createReleaseConfiguration, createReleaseElectronDownload, updateConfigFilename, validateReleasePreflight, validateReleaseVersion } from './release-config.mjs';
import { parseYaml, writeUpdateVerification } from './verify-update-metadata.mjs';
import { verifyReleaseTrialService } from './trial-service-build.mjs';
import { verifyDistributionBuild } from './distribution-build.mjs';

const desktop = fileURLToPath(new URL('..', import.meta.url));
const root = path.resolve(desktop, '..');
const desktopRequire = createRequire(new URL('../package.json', import.meta.url));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error || result.status !== 0) throw new Error(`Release verification failed: ${command} ${args[0] || ''}.`);
  return `${result.stdout || ''}\n${result.stderr || ''}`;
}

export function createReleaseTargets({ platform, arch, builder }) {
  if ((platform !== 'mac' && platform !== 'win') || !['arm64', 'x64'].includes(arch) || (platform === 'win' && arch !== 'x64')) {
    throw new Error('Unsupported release platform or architecture.');
  }
  const targetPlatform = platform === 'mac' ? builder.Platform.MAC : builder.Platform.WINDOWS;
  // An empty target list makes builder append architectures from package.json.
  return targetPlatform.createTarget(platform === 'mac' ? ['dmg', 'zip'] : ['nsis'], builder.Arch[arch]);
}

export function selectMacReleaseUploads(names, { version, arch }) {
  validateReleaseVersion(version);
  if (!['arm64', 'x64'].includes(arch)) throw new Error('Unsupported release architecture.');
  const uploads = ['latest-mac.yml', ...['dmg', 'zip'].flatMap(extension => {
    const filename = `Lumior-${version}-mac-${arch}.${extension}`;
    return [filename, `${filename}.blockmap`];
  })];
  const expected = new Set(uploads);
  const candidates = names.filter(name => /^latest.*\.(?:ya?ml|json)$/.test(name) || /^Lumior-.*\.(?:dmg|zip)(?:\.blockmap)?$/.test(name));
  if (candidates.some(name => !expected.has(name))) throw new Error('Release output contains artifacts or update manifests from a different version, platform, or architecture.');
  if (uploads.some(name => !names.includes(name))) throw new Error('Release must contain latest-mac.yml, ZIP, DMG, and both blockmaps for its exact version and architecture.');
  return uploads;
}

export async function prepareReleaseUploads({ buildDirectory, stagingDirectory, version, platform, arch }) {
  if (platform !== 'mac') throw new Error('Signed Windows releases are not enabled yet.');
  const uploads = selectMacReleaseUploads(await readdir(buildDirectory), { version, arch });
  await mkdir(stagingDirectory);
  for (const name of uploads) {
    const source = path.join(buildDirectory, name);
    const file = await lstat(source);
    if (!file.isFile() || file.isSymbolicLink()) throw new Error('Release artifacts must be regular files.');
    await cp(source, path.join(stagingDirectory, name));
  }
  // Verify architecture references, hashes, and blockmaps before creating the upload directory.
  await writeUpdateVerification({ directory: stagingDirectory, version, platform, arch });
  return [...uploads, 'SHA256SUMS.txt', 'release-verification.json'];
}

export async function verifyReleaseResources(generated) {
  let directory;
  try { directory = await lstat(generated); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error('Prepare production resources with pnpm --dir desktop build:official before releasing.');
    throw error;
  }
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('Prepare production resources with pnpm --dir desktop build:official before releasing.');
  const prepared = JSON.parse(await readFile(path.join(generated, 'verification.json'), 'utf8'));
  if (prepared.privateConfigurationCopied !== false || prepared.includesUserBrowserData !== false) throw new Error('Desktop resource verification is missing or invalid.');
  await verifyReleaseTrialService(generated);
}

export async function verifyMacApplication({ application, trustedConfig, teamId, runCommand = run }) {
  const applicationStat = await lstat(application);
  if (!applicationStat.isDirectory() || applicationStat.isSymbolicLink()) throw new Error('Release application must be a real application directory.');
  runCommand('codesign', ['--verify', '--deep', '--strict', application]);
  const signature = runCommand('codesign', ['--display', '--verbose=4', application]);
  if (!signature.includes('Authority=Developer ID Application:') || !signature.includes(`TeamIdentifier=${teamId}\n`)) {
    throw new Error('Release application must carry the expected Apple Developer ID Application signature.');
  }
  const cdHash = signature.match(/^CDHash=([a-f0-9]{40})$/im)?.[1]?.toLowerCase();
  if (!cdHash) throw new Error('Release application code-signature digest is missing.');
  runCommand('xcrun', ['stapler', 'validate', application]);
  runCommand('spctl', ['--assess', '--type', 'execute', application]);
  const resources = path.join(application, 'Contents/Resources');
  await verifyReleaseTrialService(path.join(resources, 'lumior-runtime'));
  const embedded = JSON.parse(await readFile(path.join(resources, updateConfigFilename), 'utf8'));
  if (JSON.stringify(embedded) !== JSON.stringify(trustedConfig)) throw new Error('Packaged trusted update configuration does not match this release.');
  const updater = parseYaml(await readFile(path.join(resources, 'app-update.yml'), 'utf8'));
  if (updater.provider !== 'generic' || updater.url !== trustedConfig.url || updater.channel !== 'latest') {
    throw new Error('Packaged app-update.yml does not match the trusted release feed.');
  }
  return { cdHash, teamId };
}

export async function verifyMacArchive({ archive, temporary, trustedConfig, teamId, sourceSignature, runCommand = run }) {
  const archiveStat = await lstat(archive);
  if (!archiveStat.isFile() || archiveStat.isSymbolicLink()) throw new Error('Release ZIP must be a regular file.');
  const entries = runCommand('/usr/bin/unzip', ['-Z', '-1', archive], { maxBuffer: 32 * 1024 * 1024 }).split('\n').filter(Boolean);
  if (!entries.length || entries.some(entry => entry.startsWith('/') || entry.includes('\\') || entry.split('/').includes('..')
    || (!entry.startsWith('Lumior.app/') && !entry.startsWith('__MACOSX/')))) {
    throw new Error('Release ZIP must contain Lumior.app at its root and no escaping or unrelated paths.');
  }
  const extracted = await mkdtemp(path.join(temporary, 'zip-application-'));
  // ditto restores macOS application symlinks, extended attributes, and notarization resources.
  runCommand('/usr/bin/ditto', ['-x', '-k', archive, extracted]);
  const signature = await verifyMacApplication({ application: path.join(extracted, 'Lumior.app'), trustedConfig, teamId, runCommand });
  if (signature.cdHash !== sourceSignature.cdHash || signature.teamId !== sourceSignature.teamId) {
    throw new Error('Release ZIP application signature does not match the verified source application.');
  }
  return signature;
}

async function main() {
  const { values } = parseArgs({ options: {
    platform: { type: 'string', default: 'mac' },
    arch: { type: 'string', default: process.arch },
    version: { type: 'string' },
    preflight: { type: 'boolean', default: false },
  } });
  const packageJson = JSON.parse(await readFile(path.join(desktop, 'package.json'), 'utf8'));
  const [electronPackageSource, electronChecksumsSource] = await Promise.all([
    readFile(desktopRequire.resolve('electron/package.json'), 'utf8'),
    readFile(desktopRequire.resolve('electron/checksums.json'), 'utf8'),
  ]);
  const electronPackage = JSON.parse(electronPackageSource);
  const electronDownload = createReleaseElectronDownload({ packageJson, electronPackage, checksums: JSON.parse(electronChecksumsSource), platform: values.platform, arch: values.arch });
  const { teamId } = validateReleasePreflight({ version: packageJson.version, expectedVersion: values.version,
    platform: values.platform, arch: values.arch, env: process.env, hostPlatform: process.platform });
  const generated = path.join(desktop, 'generated');
  await verifyReleaseResources(generated);
  await verifyDistributionBuild(generated, 'official');
  if (values.preflight) {
    console.log(`Release preflight passed for ${packageJson.version} ${values.platform}/${values.arch}, including the production trial service. Signing credentials will be checked by the actual build.`);
    return;
  }
  const releaseRoot = path.join(root, 'output/desktop-builds.noindex/releases', packageJson.version);
  const uploadDirectory = path.join(releaseRoot, 'updates', values.platform, values.arch);
  const buildDirectory = path.join(releaseRoot, 'build', values.platform, values.arch);
  // Preserve earlier verified artifacts. An interrupted attempt must be inspected and moved aside explicitly.
  for (const directory of [uploadDirectory, buildDirectory]) {
    try { await lstat(directory); throw new Error('This version/architecture already has release output. Move the previous attempt aside before retrying.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const temporary = await mkdtemp(path.join(tmpdir(), 'lumior-release-'));
  try {
    const trustedConfigFile = path.join(temporary, updateConfigFilename);
    const { config, trustedConfig } = createReleaseConfiguration({ packageJson, baseUrl: process.env.LUMIOR_UPDATE_BASE_URL,
      platform: values.platform, arch: values.arch, outputDirectory: buildDirectory, trustedConfigFile });
    config.electronVersion = electronPackage.version;
    config.electronDownload = electronDownload;
    await writeFile(trustedConfigFile, `${JSON.stringify(trustedConfig, null, 2)}\n`);
    const builder = await import('electron-builder');
    await builder.build({ projectDir: desktop, config, targets: createReleaseTargets({ platform: values.platform, arch: values.arch, builder }), publish: 'never' });
    const appDirectory = path.join(buildDirectory, values.arch === 'arm64' ? 'mac-arm64' : 'mac', 'Lumior.app');
    const sourceSignature = await verifyMacApplication({ application: appDirectory, trustedConfig, teamId });
    const stagingDirectory = path.join(temporary, 'verified-updates');
    const uploads = await prepareReleaseUploads({ buildDirectory, stagingDirectory, version: packageJson.version, platform: values.platform, arch: values.arch });
    await verifyMacArchive({ archive: path.join(buildDirectory, `Lumior-${packageJson.version}-mac-${values.arch}.zip`),
      temporary, trustedConfig, teamId, sourceSignature });
    await mkdir(uploadDirectory, { recursive: true });
    for (const name of uploads) await cp(path.join(stagingDirectory, name), path.join(uploadDirectory, name));
    console.log(`Signed, notarized release verified: ${uploadDirectory}. No external upload performed.`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
