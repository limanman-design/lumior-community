'use strict';

const UPDATE_STATUSES = Object.freeze([
  'disabled', 'development', 'idle', 'checking', 'available', 'downloading',
  'downloaded', 'up-to-date', 'installing', 'error',
]);
const UPDATE_MESSAGES = Object.freeze({
  development: 'Updates are off in the development preview.',
  disabled: 'Automatic updates are not configured for this build.',
  idle: 'Updates are checked in the background.',
  checking: 'Checking for updates…',
  available: 'An update is available.',
  downloading: 'Downloading the update in the background…',
  downloaded: 'The update is ready. Restart to install.',
  upToDate: 'You are using the latest version.',
  installing: 'Saving your work before restarting…',
  error: 'Updates are temporarily unavailable. Try again later.',
  saveFailed: 'Your work could not be saved. The app will stay open.',
  installFailed: 'The update could not be installed. Try again later.',
});
const stateKeys = new Set(['status', 'currentVersion', 'version', 'progress', 'message']);
const messages = new Set(Object.values(UPDATE_MESSAGES));
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const WINDOWS_PREVIEW_UPDATE_CHANNEL = 'windows-preview';
const windowsPreviewVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-win\.([1-9]\d*)$/;

function plainObject(value) {
  return value !== null && typeof value === 'object'
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function safeVersion(value) {
  return typeof value === 'string' && value.length <= 96 && versionPattern.test(value) ? value : undefined;
}
function windowsPreviewVersionParts(value) {
  const match = safeVersion(value)?.match(windowsPreviewVersionPattern);
  if (!match) return undefined;
  const parts = match.slice(1).map(Number);
  return parts.every(Number.isSafeInteger) ? parts : undefined;
}
function isWindowsPreviewVersion(value) {
  return windowsPreviewVersionParts(value) !== undefined;
}
function newerWindowsPreviewVersion(candidate, current) {
  const next = windowsPreviewVersionParts(candidate), previous = windowsPreviewVersionParts(current);
  if (!next || !previous) return false;
  for (let index = 0; index < next.length; index += 1) {
    if (next[index] !== previous[index]) return next[index] > previous[index];
  }
  return false;
}

// This is main-process build configuration, never a renderer request or an env override.
function normalizeBuildConfig(value) {
  try {
    if (!plainObject(value) || Reflect.ownKeys(value).some(key => !['provider', 'url', 'channel'].includes(key))) return null;
    if (Object.hasOwn(value, 'channel') && value.channel !== WINDOWS_PREVIEW_UPDATE_CHANNEL) return null;
    if (value.provider !== 'generic' || typeof value.url !== 'string' || value.url.length > 2048
      || Array.from(value.url).some(character => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)) return null;
    const url = new URL(value.url);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash) return null;
    return Object.freeze({ provider: 'generic', url: url.href,
      ...(value.channel === WINDOWS_PREVIEW_UPDATE_CHANNEL ? { channel: WINDOWS_PREVIEW_UPDATE_CHANNEL } : {}),
    });
  } catch { return null; }
}

// Update IPC has no configurable URL, channel, download path, or arbitrary options.
function isUpdateRequest(value) {
  try { return value === undefined || (plainObject(value) && Reflect.ownKeys(value).length === 0); }
  catch { return false; }
}
function isUpdateState(value) {
  try {
    return plainObject(value) && Reflect.ownKeys(value).every(key => stateKeys.has(key))
      && UPDATE_STATUSES.includes(value.status) && safeVersion(value.currentVersion) !== undefined
      && (value.version === undefined || safeVersion(value.version) !== undefined)
      && (value.progress === undefined || (typeof value.progress === 'number' && Number.isFinite(value.progress)
        && value.progress >= 0 && value.progress <= 100))
      && (value.message === undefined || messages.has(value.message));
  } catch { return false; }
}

/**
 * Owns updater events, not workspace persistence or the app lifecycle.
 * onBeforeInstall must return exactly true after saving and locking edits. Main keeps
 * the backend alive until native before-quit, so failed macOS staging can resume work.
 * install() resolving true means quitAndInstall was initiated; native install errors can
 * still arrive later and are published as a safe error state for main-process recovery.
 */
function createUpdateController({
  updater,
  currentVersion,
  isPackaged = false,
  development = false,
  buildConfig,
  onBeforeInstall,
  timers = globalThis,
  startupDelayMs = 30_000,
  checkIntervalMs = 6 * 60 * 60 * 1000,
} = {}) {
  const version = safeVersion(currentVersion) || '0.0.0';
  const config = normalizeBuildConfig(buildConfig);
  const windowsPreview = config?.channel === WINDOWS_PREVIEW_UPDATE_CHANNEL;
  const enabled = isPackaged === true && development !== true && config !== null
    && (!windowsPreview || isWindowsPreviewVersion(version));
  const acceptsVersion = candidate => windowsPreview
    ? newerWindowsPreviewVersion(candidate, version)
    : !!safeVersion(candidate) && !candidate.split('+')[0].includes('-');
  let state = { status: development === true ? 'development' : enabled ? 'idle' : 'disabled', currentVersion: version };
  state.message = UPDATE_MESSAGES[state.status];
  const subscribers = new Set();
  const listeners = [];
  let disposed = false, started = false, configured = false;
  let startupTimer, intervalTimer, checkPromise, installPromise, downloadPromise;
  let expectingDownload = false, readyToInstall = false;
  let originalUpdateSupported, updateSupported;

  const getState = () => Object.freeze({ ...state });
  function publish(status, message, details = {}) {
    if (disposed) return;
    const next = { status, currentVersion: version, message };
    const nextVersion = safeVersion(details.version);
    if (nextVersion) next.version = nextVersion;
    if (typeof details.progress === 'number' && Number.isFinite(details.progress)) {
      next.progress = Math.min(100, Math.max(0, details.progress));
    }
    if (JSON.stringify(next) === JSON.stringify(state)) return;
    state = next;
    for (const callback of subscribers) {
      try { callback(getState()); } catch { /* A UI subscriber cannot interrupt an update. */ }
    }
  }
  function fail(message = UPDATE_MESSAGES.error) {
    expectingDownload = false;
    readyToInstall = false;
    publish('error', message, { version: state.version });
  }
  function listen(event, callback) {
    updater.on(event, callback);
    listeners.push([event, callback]);
  }
  function detach() {
    for (const [event, callback] of listeners.splice(0)) updater.removeListener(event, callback);
    if (updateSupported && updater.isUpdateSupported === updateSupported) updater.isUpdateSupported = originalUpdateSupported;
    updateSupported = undefined;
  }
  function attach() {
    if (!enabled || disposed || configured) return;
    try {
      if (!updater || typeof updater.on !== 'function' || typeof updater.removeListener !== 'function'
        || typeof updater.checkForUpdates !== 'function' || typeof updater.quitAndInstall !== 'function'
        || typeof updater.setFeedURL !== 'function') throw new Error('Updater unavailable');
      // Set before configuring the provider: no downloaded update may bypass the save gate.
      updater.autoDownload = true;
      updater.autoInstallOnAppQuit = false;
      if ('autoInstallEvent' in updater) updater.autoInstallEvent = 'manual';
      updater.forceDevUpdateConfig = false;
      updater.allowPrerelease = windowsPreview;
      updater.allowDowngrade = false;
      updater.disableWebInstaller = true;
      // Generic feeds do not implement GitHub's prerelease filtering. Preserve
      // OS compatibility and limit Windows Preview to newer win.N versions;
      // existing stable builds continue to reject every prerelease channel.
      const supported = updater.isUpdateSupported;
      originalUpdateSupported = supported;
      updateSupported = info => {
        if (!acceptsVersion(info?.version)) return false;
        return typeof supported === 'function' ? supported.call(updater, info) : true;
      };
      updater.isUpdateSupported = updateSupported;
      listen('checking-for-update', () => {
        if (!expectingDownload && !readyToInstall && state.status !== 'installing') publish('checking', UPDATE_MESSAGES.checking);
      });
      listen('update-available', info => {
        if (disposed || readyToInstall || state.status === 'installing') return;
        const updateVersion = safeVersion(info?.version);
        if (!updateVersion || !acceptsVersion(updateVersion)) { fail(); return; }
        expectingDownload = true;
        publish('available', UPDATE_MESSAGES.available, { version: updateVersion });
      });
      listen('update-not-available', () => {
        if (!expectingDownload && !readyToInstall && state.status !== 'installing') publish('up-to-date', UPDATE_MESSAGES.upToDate);
      });
      listen('download-progress', progress => {
        if (!expectingDownload || readyToInstall || state.status === 'installing') return;
        publish('downloading', UPDATE_MESSAGES.downloading, { version: state.version, progress: progress?.percent });
      });
      listen('update-downloaded', info => {
        if (!expectingDownload || state.status === 'installing') return;
        const updateVersion = safeVersion(info?.version);
        if (!updateVersion || updateVersion !== state.version) { fail(); return; }
        expectingDownload = false;
        readyToInstall = true;
        publish('downloaded', UPDATE_MESSAGES.downloaded, { version: updateVersion, progress: 100 });
      });
      listen('update-cancelled', () => fail());
      listen('error', () => fail(state.status === 'installing' ? UPDATE_MESSAGES.installFailed : UPDATE_MESSAGES.error));
      // Preserve release configuration's single-range policy after normalizing the
      // trusted feed. Generic providers otherwise enable multipart range requests.
      updater.setFeedURL({ ...config, useMultipleRangeRequest: false });
      // A provider/channel setter may change these defaults, so enforce them afterwards too.
      updater.allowPrerelease = windowsPreview;
      updater.allowDowngrade = false;
      configured = true;
    } catch {
      if (listeners.length || updateSupported) detach();
      fail();
    }
  }

  function observeDownload(result) {
    if (!result?.downloadPromise || typeof result.downloadPromise.then !== 'function') return;
    const pending = Promise.resolve(result.downloadPromise);
    downloadPromise = pending;
    // Completion alone is not readiness: only the updater's verified downloaded event is.
    void pending.then(() => {
      if (downloadPromise === pending) downloadPromise = undefined;
    }, () => {
      if (downloadPromise !== pending) return;
      downloadPromise = undefined;
      if (!disposed) fail();
    });
    if (expectingDownload && !readyToInstall && state.status !== 'installing') {
      publish('downloading', UPDATE_MESSAGES.downloading, { version: state.version });
    }
  }
  function check() {
    if (disposed || !enabled) return Promise.resolve(getState());
    if (checkPromise) return checkPromise;
    if (expectingDownload || downloadPromise || readyToInstall || state.status === 'installing') return Promise.resolve(getState());
    attach();
    if (!configured) return Promise.resolve(getState());
    const pending = Promise.resolve().then(() => {
      if (!disposed) return updater.checkForUpdates();
    }).then(result => {
      observeDownload(result);
      return getState();
    }, () => {
      if (!disposed) fail();
      return getState();
    }).finally(() => {
      if (checkPromise === pending) checkPromise = undefined;
    });
    checkPromise = pending;
    publish('checking', UPDATE_MESSAGES.checking);
    return pending;
  }
  function install() {
    if (installPromise) return installPromise;
    if (disposed || !enabled || !configured || !readyToInstall || state.status !== 'downloaded') return Promise.resolve(false);
    const updateVersion = state.version;
    const pending = Promise.resolve().then(async () => {
      let saved = false;
      try { saved = typeof onBeforeInstall === 'function' && await onBeforeInstall() === true; } catch { /* Keep work open. */ }
      if (disposed) return false;
      if (!readyToInstall || state.status !== 'installing') return false;
      if (!saved) {
        publish('downloaded', UPDATE_MESSAGES.saveFailed, { version: updateVersion, progress: 100 });
        return false;
      }
      try {
        // NSIS honors force-run after a silent update; the ordinary installer
        // intentionally has runAfterFinish disabled. macOS keeps native staging.
        if (windowsPreview) updater.quitAndInstall(true, true);
        else updater.quitAndInstall();
        return state.status === 'installing';
      } catch {
        publish('downloaded', UPDATE_MESSAGES.installFailed, { version: updateVersion, progress: 100 });
        return false;
      }
    }).finally(() => {
      if (installPromise === pending) installPromise = undefined;
    });
    installPromise = pending;
    publish('installing', UPDATE_MESSAGES.installing, { version: updateVersion, progress: 100 });
    return pending;
  }
  function subscribe(callback) {
    if (disposed || typeof callback !== 'function') return () => {};
    subscribers.add(callback);
    return () => subscribers.delete(callback);
  }
  function start() {
    if (disposed || started || !enabled) return;
    started = true;
    attach();
    if (!configured) return;
    const delay = Number.isFinite(startupDelayMs) && startupDelayMs >= 0 ? startupDelayMs : 30_000;
    const interval = Number.isFinite(checkIntervalMs) && checkIntervalMs > 0 ? checkIntervalMs : 6 * 60 * 60 * 1000;
    startupTimer = timers.setTimeout(() => { startupTimer = undefined; void check(); }, delay);
    intervalTimer = timers.setInterval(() => { void check(); }, interval);
    startupTimer?.unref?.();
    intervalTimer?.unref?.();
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    if (startupTimer !== undefined) timers.clearTimeout(startupTimer);
    if (intervalTimer !== undefined) timers.clearInterval(intervalTimer);
    detach();
    subscribers.clear();
  }

  attach();
  return Object.freeze({ start, getState, subscribe, check, install, dispose });
}

module.exports = { createUpdateController, normalizeBuildConfig, isUpdateRequest, isUpdateState,
  isWindowsPreviewVersion, WINDOWS_PREVIEW_UPDATE_CHANNEL, UPDATE_STATUSES, UPDATE_MESSAGES };
