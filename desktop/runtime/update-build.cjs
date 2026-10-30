'use strict';
/* oxlint-disable typescript/no-require-imports -- The Electron main-process runtime uses CommonJS. */

const fs = require('node:fs/promises');
const path = require('node:path');
const { normalizeBuildConfig, isWindowsPreviewVersion, WINDOWS_PREVIEW_UPDATE_CHANNEL } = require('./updates.cjs');

// Both files are bundled into the app by the release builder. Runtime env
// variables and renderer-supplied addresses cannot enable or redirect updates.
async function readUpdateBuild({ isPackaged, development, resourcesPath, platform, arch, version, parseYaml }) {
  if (!isPackaged || development || typeof parseYaml !== 'function') return undefined;
  try {
    const [source, providerSource] = await Promise.all([
      fs.readFile(path.join(resourcesPath, 'lumior-update-config.json'), 'utf8'),
      fs.readFile(path.join(resourcesPath, 'app-update.yml'), 'utf8'),
    ]);
    if (source.length > 8192 || providerSource.length > 8192) return undefined;
    const value = JSON.parse(source);
    const keys = ['schemaVersion', 'enabled', 'provider', 'url', 'channel', 'platform', 'arch', 'version'];
    if (!value || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))
      || value.schemaVersion !== 1 || value.enabled !== true
      || value.platform !== platform || value.arch !== arch || value.version !== version) return undefined;
    const windowsPreview = value.channel === WINDOWS_PREVIEW_UPDATE_CHANNEL;
    if (windowsPreview) {
      if (platform !== 'win32' || arch !== 'x64' || !isWindowsPreviewVersion(version)) return undefined;
    } else if (value.channel !== 'latest' || isWindowsPreviewVersion(version)) return undefined;
    const config = normalizeBuildConfig({ provider: value.provider, url: value.url,
      ...(windowsPreview ? { channel: WINDOWS_PREVIEW_UPDATE_CHANNEL } : {}),
    });
    const provider = parseYaml(providerSource);
    const same = normalizeBuildConfig({ provider: provider?.provider, url: provider?.url });
    if (!config || !same || config.url !== same.url || (provider?.channel ?? 'latest') !== value.channel) return undefined;
    return config;
  } catch { return undefined; }
}

module.exports = { readUpdateBuild };
