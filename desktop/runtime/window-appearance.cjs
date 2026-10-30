'use strict';

// System materials preserve normal resizing/maximizing; do not switch the
// main window to Electron's transparent-window mode (used by the pet only).
function mainWindowMaterial(platform, release) {
  // Electron's native color parser does not recognize the CSS keyword
  // `transparent`; it falls back to white. An explicit alpha hex preserves
  // the system material behind the renderer without transparent-window mode.
  const transparentBackground = '#00000000';
  if (platform === 'darwin') return { backgroundColor: transparentBackground, vibrancy: 'under-window', visualEffectState: 'active' };
  if (platform === 'win32') {
    const [major, , build] = String(release).split('.').map(Number);
    // DWM backdrop materials require Windows 11 22H2 (build 22621).
    if (major > 10 || (major === 10 && build >= 22621)) return { backgroundColor: transparentBackground, backgroundMaterial: 'acrylic' };
  }
  return {};
}

module.exports = { mainWindowMaterial };
