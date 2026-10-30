import { desktopIdentity, WINDOWS_PREVIEW_CHANNEL } from '../runtime/app-identity.cjs';

export function createWindowsPreviewConfiguration({ baseVersion, revision = 1, outputDirectory }) {
  if (!/^\d+\.\d+\.\d+$/.test(baseVersion) || !Number.isSafeInteger(revision) || revision < 1) {
    throw new Error('A stable base version and a positive preview revision are required.');
  }
  const version = `${baseVersion}-win.${revision}`;
  const identity = desktopIdentity({ development: false, platform: 'win32', channel: WINDOWS_PREVIEW_CHANNEL });
  return {
    appId: identity.appId,
    productName: identity.appName,
    extraMetadata: { version, productName: identity.appName, lumiorChannel: WINDOWS_PREVIEW_CHANNEL, lumiorDistribution: 'official' },
    directories: { output: outputDirectory },
    artifactName: `Lumior-${version}-windows-x64.` + '${ext}',
    publish: null,
    forceCodeSigning: false,
    win: {
      target: [{ target: 'nsis', arch: ['x64'] }, { target: 'zip', arch: ['x64'] }],
      signExecutable: false,
      // Keep the Lumior icon/version resources even in an unsigned internal build.
      signAndEditExecutable: true,
      requestedExecutionLevel: 'asInvoker',
    },
    nsis: {
      include: 'assets/windows-installer.nsh',
      oneClick: false,
      perMachine: false,
      allowToChangeInstallationDirectory: true,
      deleteAppDataOnUninstall: false,
      installerLanguages: ['en_US', 'zh_CN'],
      runAfterFinish: false,
    },
  };
}

export function inspectWindowsExecutable(bytes) {
  if (bytes.length < 64 || bytes.toString('ascii', 0, 2) !== 'MZ') throw new Error('Not a Windows executable.');
  const pe = bytes.readUInt32LE(60);
  if (pe + 24 + 152 > bytes.length || bytes.toString('ascii', pe, pe + 4) !== 'PE\u0000\u0000') throw new Error('Invalid Windows executable header.');
  const machine = bytes.readUInt16LE(pe + 4);
  const optionalHeader = pe + 24;
  const magic = bytes.readUInt16LE(optionalHeader);
  if (![0x10b, 0x20b].includes(magic)) throw new Error('Unsupported Windows executable format.');
  const certificate = optionalHeader + (magic === 0x20b ? 112 : 96) + 4 * 8;
  return { architecture: machine === 0x8664 ? 'x64' : machine === 0x14c ? 'x86' : 'unknown', signed: bytes.readUInt32LE(certificate + 4) > 0 };
}
