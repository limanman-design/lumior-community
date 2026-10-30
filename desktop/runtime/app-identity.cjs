'use strict';

const WINDOWS_PREVIEW_CHANNEL = 'windows-preview';
function desktopIdentity({ development, platform, channel, distribution = 'official' }) {
  if (distribution === 'community') return {
    appName: development ? 'Lumior Community Development' : 'Lumior Community',
    userDataName: development ? 'Lumior Community Development' : 'Lumior Community',
    appId: development ? 'app.lumior.community.development' : 'app.lumior.community',
  };
  const preview = platform === 'win32' && channel === WINDOWS_PREVIEW_CHANNEL && !development;
  return {
    appName: development ? 'Lumior 开发预览' : preview ? 'Lumior Preview' : 'Lumior',
    userDataName: development ? 'Lumior Development' : preview ? 'Lumior Windows Preview' : 'Lumior',
    appId: preview ? 'app.lumior.desktop.windows-preview' : 'app.lumior.desktop',
  };
}
module.exports = { desktopIdentity, WINDOWS_PREVIEW_CHANNEL };
