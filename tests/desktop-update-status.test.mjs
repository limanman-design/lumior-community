import test from 'node:test';
import assert from 'node:assert/strict';
import {
  desktopUpdateCopy,
  desktopUpdateInstallFailure,
  desktopUpdateNoticeKey,
  desktopUpdateProgress,
} from '../app/desktop-update-status.ts';
const state = (status, extra = {}) => ({
  status,
  currentVersion: '0.1.1',
  ...extra,
});
const en = (english) => english;
const zh = (_english, chinese) => chinese;

void test('background states never trigger the ready notification and a later version gets a new dismissal key', () => {
  for (const status of [
    'disabled',
    'development',
    'idle',
    'checking',
    'available',
    'downloading',
    'up-to-date',
    'error',
  ]) {
    assert.equal(
      desktopUpdateNoticeKey(state(status, { version: '0.1.2' })),
      null,
    );
  }
  assert.equal(desktopUpdateNoticeKey(null), null);
  const ready = desktopUpdateNoticeKey(
    state('downloaded', { version: '0.1.2' }),
  );
  assert.equal(
    desktopUpdateNoticeKey(state('installing', { version: '0.1.2' })),
    ready,
  );
  assert.notEqual(
    desktopUpdateNoticeKey(state('downloaded', { version: '0.1.3' })),
    ready,
  );
  assert.notEqual(
    desktopUpdateNoticeKey(
      state('error', {
        version: '0.1.2',
        message: 'The update could not be installed. Try again later.',
      }),
    ),
    ready,
  );
});

void test('download progress stays bounded and unknown or stale progress stays indeterminate', () => {
  assert.equal(
    desktopUpdateProgress(state('downloading', { progress: -12 })),
    0,
  );
  assert.equal(
    desktopUpdateProgress(state('downloading', { progress: 120 })),
    100,
  );
  assert.equal(
    desktopUpdateProgress(state('downloading', { progress: 54.6 })),
    55,
  );
  for (const progress of [undefined, NaN, Infinity, '37'])
    assert.equal(
      desktopUpdateProgress(state('downloading', { progress })),
      undefined,
    );
  assert.equal(
    desktopUpdateProgress(state('error', { progress: 55 })),
    undefined,
  );
});

void test('save refusal stays actionable in both languages and raw messages never enter update notices', () => {
  const failed = state('downloaded', {
    message: 'Your work could not be saved. The app will stay open.',
  });
  assert.match(desktopUpdateInstallFailure(failed, en), /stay open/);
  assert.match(desktopUpdateInstallFailure(failed, zh), /保持打开/);
  for (const message of [
    'The update is ready. Restart to install.',
    'https://private.example/update?token=secret',
    '/Users/person/private-key',
    'unknown error',
  ]) {
    assert.equal(
      desktopUpdateInstallFailure(state('downloaded', { message }), en),
      '',
    );
    assert.ok(
      !desktopUpdateCopy(state('error', { message }), en).detail.includes(
        message,
      ),
    );
  }
});

void test('disabled and development builds do not claim automatic updating is enabled', () => {
  assert.match(desktopUpdateCopy(state('disabled'), en).title, /not enabled/);
  assert.match(desktopUpdateCopy(state('development'), zh).title, /开发预览/);
  assert.match(
    desktopUpdateCopy(state('development'), zh).detail,
    /无需下载安装更新/,
  );
});
