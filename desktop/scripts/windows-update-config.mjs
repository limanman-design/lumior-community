import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createWindowsPreviewConfiguration } from './windows-preview-config.mjs';

export const windowsUpdateFeed = 'https://updates.lumior.work/windows/x64/';
export const windowsUpdateChannel = 'windows-preview';
export const windowsUpdateManifest = `${windowsUpdateChannel}.yml`;

export function createWindowsUpdateConfiguration({ packageJson, revision = 1, outputDirectory, trustedConfigFile }) {
  if (typeof trustedConfigFile !== 'string' || !trustedConfigFile) throw new Error('Windows updates require an embedded build configuration.');
  const config = createWindowsPreviewConfiguration({ baseVersion: packageJson.version, revision, outputDirectory });
  const trustedConfig = {
    schemaVersion: 1, enabled: true, provider: 'generic', url: windowsUpdateFeed,
    channel: windowsUpdateChannel, platform: 'win32', arch: 'x64', version: config.extraMetadata.version,
  };
  config.publish = { provider: 'generic', url: windowsUpdateFeed, channel: windowsUpdateChannel, useMultipleRangeRequest: false };
  config.detectUpdateChannel = false;
  config.generateUpdatesFilesForAllChannels = false;
  config.extraResources = [
    ...(structuredClone(packageJson.build?.extraResources || [])),
    { from: path.resolve(trustedConfigFile), to: 'lumior-update-config.json' },
  ];
  return { config, trustedConfig };
}

export async function verifyWindowsUpdateBuild({ resources, trustedConfig, parseYaml }) {
  const embedded = JSON.parse(await readFile(path.join(resources, 'lumior-update-config.json'), 'utf8'));
  if (JSON.stringify(embedded) !== JSON.stringify(trustedConfig)) throw new Error('Packaged Windows update configuration differs from the prepared build.');
  const provider = parseYaml(await readFile(path.join(resources, 'app-update.yml'), 'utf8'));
  if (!provider || provider.provider !== 'generic' || provider.url !== windowsUpdateFeed
    || provider.channel !== windowsUpdateChannel || provider.useMultipleRangeRequest !== false
    || provider.publisherName !== undefined) {
    throw new Error('Packaged Windows update provider does not match the unsigned preview channel.');
  }
  return { enabled: true, feed: windowsUpdateFeed, channel: windowsUpdateChannel, publisherSignature: false };
}
