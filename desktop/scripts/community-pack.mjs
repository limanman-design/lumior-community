import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { verifyDistributionBuild } from './distribution-build.mjs';
import { createReleaseElectronDownload } from './release-config.mjs';

const desktop = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));
const builder = require('electron-builder');
const metadata = require('./package.json');
const electronPackage = require('electron/package.json');
const { values } = parseArgs({ options: {
  platform: { type: 'string', default: process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux' },
  arch: { type: 'string', default: process.arch },
  dir: { type: 'boolean', default: false },
} });
if (!['mac', 'win', 'linux'].includes(values.platform) || !['arm64', 'x64'].includes(values.arch)) throw new Error('Unsupported community packaging target.');
await verifyDistributionBuild(path.join(desktop, 'generated'), 'community');
const platforms = { mac: builder.Platform.MAC, win: builder.Platform.WINDOWS, linux: builder.Platform.LINUX };
const targets = values.dir ? ['dir'] : values.platform === 'mac' ? ['dmg', 'zip'] : values.platform === 'win' ? ['nsis', 'zip'] : ['AppImage'];
// Community builds never discover the maintainer's local signing identities.
process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
for (const key of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'CSC_NAME', 'WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD']) delete process.env[key];
await builder.build({
  projectDir: desktop,
  targets: platforms[values.platform].createTarget(targets, builder.Arch[values.arch]),
  publish: 'never',
  config: {
    electronVersion: electronPackage.version,
    ...(['mac', 'win'].includes(values.platform) ? { electronDownload: createReleaseElectronDownload({
      packageJson: metadata, electronPackage, checksums: require('electron/checksums.json'), platform: values.platform, arch: values.arch,
    }) } : {}),
    appId: 'app.lumior.community', productName: 'Lumior Community',
    extraMetadata: { productName: 'Lumior Community', lumiorDistribution: 'community', lumiorChannel: 'community' },
    artifactName: 'Lumior-Community-${version}-${os}-${arch}.${ext}',
    directories: { output: '../output/community-builds.noindex' },
    publish: null, forceCodeSigning: false,
    mac: { identity: null, notarize: false },
    win: { signExecutable: false, signAndEditExecutable: true },
  },
});
console.log('Community package prepared with its own data directory and official updates disabled. Nothing was published.');
