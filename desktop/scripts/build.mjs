import { spawnSync } from 'node:child_process';
import { cp, mkdir, readdir, rm, writeFile, readFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { includeDesktopAsset, omittedDesktopAssets } from './asset-policy.mjs';
import { resolveTrialServiceBuild, writeTrialServiceBuild } from './trial-service-build.mjs';
import { generateIcon } from './icon.mjs';
import { preparePetAssets } from './pet-assets.mjs';
import { resolveDesktopBuildDistribution, writeDistributionBuild } from './distribution-build.mjs';

const desktop = fileURLToPath(new URL('..', import.meta.url));
const root = path.resolve(desktop, '..');
const generated = path.join(desktop, 'generated');
for (const {script, args} of [
  {script: 'sync-ui-colors.mjs', args: ['--check']},
  {script: 'check-ui-colors.mjs', args: []},
]) {
  const checked = spawnSync(process.execPath, [path.join(root, 'scripts', script), ...args], { cwd: root, stdio: 'inherit' });
  if (checked.status !== 0) process.exit(checked.status || 1);
}
const distribution = resolveDesktopBuildDistribution(process.argv.slice(2));
const trialGatewayUrl = distribution === 'official' ? await resolveTrialServiceBuild(path.join(desktop, 'runtime')) : '';
await generateIcon({ macIcon: process.platform === 'darwin' && !process.argv.includes('--windows') });
await preparePetAssets();
if (!process.argv.includes('--skip-web-build')) {
  const result = spawnSync(process.execPath, [path.join(root, 'node_modules/vinext/dist/cli.js'), 'build'], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
try { if ((await lstat(generated)).isSymbolicLink()) throw new Error('Refusing to replace a linked generated directory.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
await rm(generated, { recursive: true, force: true });
await mkdir(path.join(generated, 'web'), { recursive: true });
const forbidden = new Set(['.DS_Store', '.openai', 'wrangler.json', '_headers', '.assetsignore']);
const clientRoot = path.join(root, 'dist/client');
await cp(clientRoot, path.join(generated, 'web/client'), { recursive: true, filter: source => !forbidden.has(path.basename(source)) && includeDesktopAsset(source, clientRoot) });
await cp(path.join(root, 'dist/server'), path.join(generated, 'web/server'), { recursive: true, filter: source => !forbidden.has(path.basename(source)) });
for (const name of ['backend.mjs', 'security.cjs', 'ai-settings.cjs', 'trial-access.cjs', 'network.cjs']) await cp(path.join(desktop, 'runtime', name), path.join(generated, name));
if (distribution === 'official') await writeTrialServiceBuild(generated, trialGatewayUrl);
await writeDistributionBuild(generated, distribution);
await cp(path.join(root, 'scripts/node-worker-env-loader.mjs'), path.join(generated, 'node-worker-env-loader.mjs'));
await writeFile(path.join(generated, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
await build({ entryPoints: [path.join(root, 'node_modules/vinext/dist/server/prod-server.js')], outfile: path.join(generated, 'production-server.mjs'), platform: 'node', format: 'esm', bundle: true, target: 'node22', logLevel: 'warning' });
let count = 0, bytes = 0;
async function verify(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || /^(?:\.env|\.dev\.vars|credentials|service-account)/i.test(entry.name) || /\.(?:p12|pfx|key|pem)$/i.test(entry.name)) throw new Error(`Unexpected private/runtime file: ${entry.name}`);
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) await verify(filename);
    else { count++; bytes += (await lstat(filename)).size; }
  }
}
await verify(generated);
const externals = JSON.parse(await readFile(path.join(root, 'dist/server/vinext-externals.json'), 'utf8'));
if (!Array.isArray(externals) || externals.length) throw new Error('The web build has external dependencies. Bundle them before packaging.');
await writeFile(path.join(generated, 'verification.json'), JSON.stringify({ distribution, files: count, bytes, omittedDesktopAssets, privateConfigurationCopied: false, includesUserBrowserData: false, pdfLayoutEngineBundled: false, createdAt: new Date().toISOString() }, null, 2));
console.log(`Desktop runtime prepared: ${count} files, ${bytes} bytes. No developer configuration or browser data copied.`);
