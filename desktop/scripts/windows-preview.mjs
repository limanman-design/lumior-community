import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, lstat, writeFile, access, cp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createWindowsPreviewConfiguration, inspectWindowsExecutable } from './windows-preview-config.mjs';
import { verifyReleaseResources } from './release.mjs';
import { createReleaseElectronDownload } from './release-config.mjs';
import { createWindowsUpdateConfiguration, verifyWindowsUpdateBuild, windowsUpdateManifest } from './windows-update-config.mjs';
import { parseYaml, writeUpdateVerification } from './verify-update-metadata.mjs';
import { verifyDistributionBuild } from './distribution-build.mjs';

const desktop = fileURLToPath(new URL('..', import.meta.url));
const root = path.resolve(desktop, '..');
const require = createRequire(new URL('../package.json', import.meta.url));
const builder = require('electron-builder');
const builderRequire = createRequire(require.resolve('electron-builder'));
const asar = createRequire(builderRequire.resolve('app-builder-lib'))('@electron/asar');
const { values } = parseArgs({ options: { 'skip-build': { type: 'boolean' }, revision: { type: 'string', default: '1' }, updates: { type: 'boolean', default: false } } });
const metadata = JSON.parse(await readFile(path.join(desktop, 'package.json'), 'utf8'));
const revision = Number(values.revision);
let config = createWindowsPreviewConfiguration({ baseVersion: metadata.version, revision });
const version = config.extraMetadata.version;
const outputDirectory = path.join(root, 'output', `${values.updates ? 'windows-update' : 'windows-preview'}-${version}.noindex`);
let trustedConfig;
if (values.updates) {
  ({ config, trustedConfig } = createWindowsUpdateConfiguration({ packageJson: metadata, revision, outputDirectory,
    trustedConfigFile: path.join(outputDirectory, 'build-config', 'lumior-update-config.json') }));
}
config.electronDownload = createReleaseElectronDownload({
  packageJson: metadata, electronPackage: require('electron/package.json'),
  checksums: require('electron/checksums.json'), platform: 'win', arch: 'x64',
});
config.directories.output = outputDirectory;
try {
  await lstat(outputDirectory);
  throw new Error('This Windows candidate already exists. Preserve it and select a new revision or explicitly archive the failed attempt.');
} catch (error) { if (error.code !== 'ENOENT') throw error; }
if (!values['skip-build']) {
  const built = spawnSync(process.execPath, [path.join(desktop, 'scripts/build.mjs'), '--windows', '--official'], { cwd: root, stdio: 'inherit' });
  if (built.error) throw built.error;
  if (built.status !== 0) process.exit(built.status || 1);
}
await verifyReleaseResources(path.join(desktop, 'generated'));
await verifyDistributionBuild(path.join(desktop, 'generated'), 'official');
if (trustedConfig) {
  await mkdir(path.join(outputDirectory, 'build-config'), { recursive: true });
  await writeFile(path.join(outputDirectory, 'build-config', 'lumior-update-config.json'), JSON.stringify(trustedConfig, null, 2) + '\n', { flag: 'wx' });
}
const artifacts = await builder.build({
  projectDir: desktop,
  targets: builder.Platform.WINDOWS.createTarget(trustedConfig ? ['nsis'] : ['nsis', 'zip'], builder.Arch.x64),
  config,
  publish: 'never',
});
if (trustedConfig) {
  // NSIS adds its elevate helper to the packaged application. Archive that final
  // directory afterwards so the ZIP cannot race ahead and omit the helper.
  artifacts.push(...await builder.build({
    projectDir: desktop,
    prepackaged: path.join(outputDirectory, 'win-unpacked'),
    targets: builder.Platform.WINDOWS.createTarget(['zip'], builder.Arch.x64),
    config,
    publish: 'never',
  }));
}
const resources = path.join(outputDirectory, 'win-unpacked/resources');
let updateVerification;
if (trustedConfig) {
  updateVerification = await verifyWindowsUpdateBuild({ resources, trustedConfig, parseYaml });
} else {
  for (const name of ['app-update.yml', 'lumior-update-config.json']) {
    try { await access(path.join(resources, name)); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    throw new Error('Internal preview unexpectedly contains an updater configuration.');
  }
}
const appArchive = path.join(resources, 'app.asar');
const packaged = JSON.parse(asar.extractFile(appArchive, 'package.json').toString());
if (packaged.version !== version || packaged.lumiorChannel !== 'windows-preview') throw new Error('Packaged preview identity is incorrect.');
if (asar.listPackage(appArchive).some(name => name.endsWith('.node'))) throw new Error('Unexpected native Node add-on requires a Windows compatibility review.');
const executable = path.join(outputDirectory, 'win-unpacked', `${config.productName}.exe`);
const application = inspectWindowsExecutable(await readFile(executable));
if (application.architecture !== 'x64' || application.signed) throw new Error('Expected an unsigned Windows x64 internal application.');
const expected = ['exe', 'zip'].map(extension => `Lumior-${version}-windows-x64.${extension}`);
const files = [];
for (const name of expected) {
  const filename = path.join(outputDirectory, name);
  if (!artifacts.includes(filename)) throw new Error(`Missing Windows artifact: ${name}`);
  const stat = await lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Preview artifact must be a regular file.');
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(filename)) digest.update(chunk);
  files.push({ name, bytes: stat.size, sha256: digest.digest('hex') });
}
const installer = inspectWindowsExecutable(await readFile(path.join(outputDirectory, expected[0])));
if (installer.signed) throw new Error('Expected an unsigned internal installer.');
let uploadDirectory;
if (trustedConfig) {
  uploadDirectory = path.join(outputDirectory, 'updates', 'windows', 'x64');
  await mkdir(uploadDirectory, { recursive: true });
  for (const name of [expected[0], `${expected[0]}.blockmap`, windowsUpdateManifest]) {
    const source = path.join(outputDirectory, name);
    const stat = await lstat(source);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Windows update uploads must be regular files.');
    await cp(source, path.join(uploadDirectory, name));
  }
  await writeUpdateVerification({ directory: uploadDirectory, version, platform: 'windows-preview', arch: 'x64' });
}
await mkdir(outputDirectory, { recursive: true });
await writeFile(path.join(outputDirectory, 'SHA256SUMS.txt'), files.map(file => `${file.sha256}  ${file.name}`).join('\n') + '\n');
await writeFile(path.join(outputDirectory, 'windows-verification.json'), JSON.stringify({
  version, builtAt: new Date().toISOString(), target: 'Windows 11 x64', application, installer,
  updaterEnabled: Boolean(trustedConfig), ...(updateVerification ? { updateVerification, uploadDirectory } : {}), userDataDirectory: '%APPDATA%\\Lumior Windows Preview',
  nativeWindowsTested: false, published: false, files,
}, null, 2) + '\n');
console.log(`Windows ${trustedConfig ? 'auto-update candidate' : 'internal preview'} ready: ${outputDirectory}\nUnsigned; native Windows installation and runtime tests are still required. Nothing was published.`);
