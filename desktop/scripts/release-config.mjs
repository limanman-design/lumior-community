import path from 'node:path';

export const updateConfigFilename = 'lumior-update-config.json';
const architectures = { mac: ['arm64', 'x64'], win: ['x64'] };

export function validateReleaseVersion(version) {
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error('Release version must be a stable major.minor.patch version.');
  }
  return version;
}

export function createReleaseElectronDownload({ packageJson, electronPackage, checksums, platform, arch }) {
  const version = packageJson.devDependencies?.electron;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)
    || electronPackage?.name !== 'electron' || electronPackage.version !== version) {
    throw new Error('The installed Electron package must match the exact pinned desktop development dependency.');
  }
  if (!architectures[platform]?.includes(arch)) throw new Error('Unsupported release platform or architecture.');
  const filename = `electron-v${version}-${platform === 'mac' ? 'darwin' : 'win32'}-${arch}.zip`;
  const checksum = checksums?.[filename];
  if (typeof checksum !== 'string' || !/^[a-f0-9]{64}$/.test(checksum)) {
    throw new Error('The installed official Electron checksum table is missing a valid hash for this release target.');
  }
  // Builder's framework flattens mirrorOptions and drops checksums. An explicit
  // force flag survives that step and selects its @electron/get option shape.
  return { force: false, checksums: { [filename]: checksum } };
}

export function resolveUpdateFeed(baseUrl, platform, arch) {
  if (!architectures[platform]?.includes(arch)) throw new Error('Unsupported release platform or architecture.');
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) throw new Error('LUMIOR_UPDATE_BASE_URL is required for a release.');
  let url;
  try { url = new URL(baseUrl); } catch { throw new Error('LUMIOR_UPDATE_BASE_URL must be an absolute HTTPS URL.'); }
  const hostname = url.hostname.toLowerCase();
  const reserved = /(^|\.)(localhost|local|internal|test|invalid|example)$/.test(hostname)
    || /(^|\.)example\.(com|net|org)$/.test(hostname);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || (url.port && url.port !== '443') || reserved || !hostname.includes('.')
    || /^[\d.]+$/.test(hostname) || hostname.includes(':') || /[\\\s]/.test(baseUrl)
    || /%2f|%5c/i.test(url.pathname)) {
    throw new Error('Update feed must use a production HTTPS hostname without credentials, query, fragment, or a custom port.');
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${platform}/${arch}/`;
  return url.href;
}

export function validateReleasePreflight({ version, expectedVersion, platform, arch, env, hostPlatform }) {
  validateReleaseVersion(version);
  if (expectedVersion && version !== expectedVersion) throw new Error('Requested release version does not match desktop/package.json.');
  const url = resolveUpdateFeed(env.LUMIOR_UPDATE_BASE_URL, platform, arch);
  if (platform !== 'mac') throw new Error('Signed Windows releases are not enabled yet. Use the existing Windows preview workflow.');
  if (hostPlatform !== 'darwin') throw new Error('A signed macOS release must be built on macOS.');
  const missing = [];
  const importedCertificate = Boolean(env.CSC_LINK && env.CSC_KEY_PASSWORD);
  // Builder 26 selects the certificate type itself and rejects the type prefix
  // in CSC_NAME. Include the team suffix to avoid selecting another team's name.
  const keychainIdentity = typeof env.CSC_NAME === 'string' ? env.CSC_NAME.trim().match(/^([^:\r\n]+) \(([A-Z0-9]{10})\)$/) : null;
  if (!importedCertificate && !keychainIdentity) missing.push('CSC_LINK + CSC_KEY_PASSWORD, or CSC_NAME (Name (TEAMID), without certificate-type prefix)');
  if (env.CSC_NAME && (!keychainIdentity || !keychainIdentity[1].trim())) {
    throw new Error('CSC_NAME must be Name (TEAMID), without the Developer ID Application: prefix.');
  }
  if (env.CSC_IDENTITY_AUTO_DISCOVERY === 'false' && !keychainIdentity) {
    throw new Error('Certificate discovery is disabled. Set CSC_NAME to Name (TEAMID), or enable CSC_IDENTITY_AUTO_DISCOVERY for imported certificate signing.');
  }
  if (!/^[A-Z0-9]{10}$/.test(env.LUMIOR_SIGNING_TEAM_ID || '')) missing.push('LUMIOR_SIGNING_TEAM_ID (Apple Developer team ID)');
  if (keychainIdentity && env.LUMIOR_SIGNING_TEAM_ID && keychainIdentity[2] !== env.LUMIOR_SIGNING_TEAM_ID) {
    throw new Error('CSC_NAME and LUMIOR_SIGNING_TEAM_ID must select the same Apple Developer team.');
  }
  // Match builder 26's credential priority, including incomplete higher-priority groups.
  if (env.APPLE_ID || env.APPLE_APP_SPECIFIC_PASSWORD) {
    if (!env.APPLE_ID || !env.APPLE_APP_SPECIFIC_PASSWORD || !env.APPLE_TEAM_ID) missing.push('APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID');
  } else if (env.APPLE_API_KEY || env.APPLE_API_KEY_ID || env.APPLE_API_ISSUER) {
    if (!env.APPLE_API_KEY || !env.APPLE_API_KEY_ID || !env.APPLE_API_ISSUER) missing.push('APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER');
  } else if (!env.APPLE_KEYCHAIN_PROFILE) {
    missing.push('Apple notarization credentials (API key, Apple ID, or keychain profile)');
  }
  if (env.APPLE_TEAM_ID && env.APPLE_TEAM_ID !== env.LUMIOR_SIGNING_TEAM_ID) throw new Error('Apple notarization and signing team IDs must match.');
  if (missing.length) throw new Error(`Release preflight failed. Missing: ${missing.join('; ')}.`);
  return { url, teamId: env.LUMIOR_SIGNING_TEAM_ID };
}

export function createReleaseConfiguration({ packageJson, baseUrl, platform, arch, outputDirectory, trustedConfigFile }) {
  const version = validateReleaseVersion(packageJson.version);
  const url = resolveUpdateFeed(baseUrl, platform, arch);
  const trustedConfig = {
    schemaVersion: 1,
    enabled: true,
    provider: 'generic',
    url,
    channel: 'latest',
    platform: platform === 'mac' ? 'darwin' : 'win32',
    arch,
    version,
  };
  const config = structuredClone(packageJson.build);
  config.appId = 'app.lumior.desktop';
  config.productName = 'Lumior';
  config.artifactName = 'Lumior-${version}-${os}-${arch}.${ext}';
  config.extraMetadata = { ...config.extraMetadata, productName: 'Lumior', lumiorDistribution: 'official', lumiorChannel: 'stable' };
  config.directories = { ...config.directories, output: path.resolve(outputDirectory) };
  config.publish = { provider: 'generic', url, channel: 'latest', useMultipleRangeRequest: false };
  config.generateUpdatesFilesForAllChannels = false;
  config.detectUpdateChannel = false;
  config.forceCodeSigning = true;
  config.extraResources = [...(config.extraResources || []), { from: path.resolve(trustedConfigFile), to: updateConfigFilename }];
  if (platform === 'mac') {
    config.mac = { ...config.mac, forceCodeSigning: true, hardenedRuntime: true, notarize: true,
      target: [{ target: 'dmg', arch: [arch] }, { target: 'zip', arch: [arch] }] };
  } else {
    config.win = { ...config.win, forceCodeSigning: true, target: [{ target: 'nsis', arch: [arch] }] };
  }
  return { config, trustedConfig };
}
