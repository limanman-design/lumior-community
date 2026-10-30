import test from 'node:test';
import assert from 'node:assert/strict';
import { createWindowsPreviewConfiguration, inspectWindowsExecutable } from '../desktop/scripts/windows-preview-config.mjs';
import { desktopIdentity } from '../desktop/runtime/app-identity.cjs';
import { formatKeyboardShortcut, isComposingShortcut } from '../app/keyboard-shortcuts.ts';

void test('Windows shortcut hints preserve translated text and modifier combinations', () => {
  assert.equal(formatKeyboardShortcut('已添加卡片 · ⌘Z 撤销', 'win32'), '已添加卡片 · Ctrl+Z 撤销');
  assert.equal(formatKeyboardShortcut('⌘Z / ⇧⌘Z', 'win32'), 'Ctrl+Z / Ctrl+Shift+Z');
  assert.equal(formatKeyboardShortcut('⌥⌘F', 'win32'), 'Ctrl+Alt+F');
  assert.equal(formatKeyboardShortcut('⌘ + 滚轮缩放', 'win32'), 'Ctrl+滚轮缩放');
  for (const platform of ['darwin', null]) assert.equal(formatKeyboardShortcut('⌘Z / ⇧⌘Z', platform), '⌘Z / ⇧⌘Z');
});

void test('IME composition and its final Windows commit key cannot trigger canvas shortcuts', () => {
  assert.equal(isComposingShortcut({ isComposing: true, keyCode: 13 }), true);
  assert.equal(isComposingShortcut({ isComposing: false, keyCode: 229 }), true);
  assert.equal(isComposingShortcut({ isComposing: false, keyCode: 13 }), false);
  assert.equal(isComposingShortcut({ keyCode: 90 }), false);
});

void test('internal Windows build has a distinct identity and retains data across preview revisions', () => {
  const first = createWindowsPreviewConfiguration({ baseVersion: '0.1.28', outputDirectory: '/preview' });
  const next = createWindowsPreviewConfiguration({ baseVersion: '0.1.28', revision: 2, outputDirectory: '/next' });
  assert.notEqual(first.extraMetadata.version, next.extraMetadata.version);
  assert.equal(first.appId, next.appId);
  assert.equal(first.publish, null);
  assert.equal(first.win.signExecutable, false);
  assert.equal(first.win.signAndEditExecutable, true);
  assert.equal(first.nsis.deleteAppDataOnUninstall, false);
  assert.deepEqual(first.win.target.map(item => item.arch), [['x64'], ['x64']]);
  const preview = desktopIdentity({ platform: 'win32', development: false, channel: first.extraMetadata.lumiorChannel });
  assert.equal(preview.appId, first.appId);
  assert.equal(preview.appName, first.productName);
  assert.notEqual(preview.userDataName, desktopIdentity({ platform: 'win32', development: false }).userDataName);
  assert.equal(desktopIdentity({ platform: 'darwin', development: false, channel: 'windows-preview' }).userDataName, 'Lumior');
  assert.equal(desktopIdentity({ platform: 'win32', development: true, channel: 'windows-preview' }).userDataName, 'Lumior Development');
  for (const baseVersion of ['../1.0.0', '1.0.0-beta', 'not-a-version']) assert.throws(() => createWindowsPreviewConfiguration({ baseVersion }));
  assert.throws(() => createWindowsPreviewConfiguration({ baseVersion: '1.0.0', revision: NaN }));
});

void test('artifact validation detects wrong architecture, signing and damaged PE headers', () => {
  const bytes = Buffer.alloc(512);
  bytes.write('MZ'); bytes.writeUInt32LE(128, 60); bytes.write('PE\0\0', 128);
  bytes.writeUInt16LE(0x8664, 132); bytes.writeUInt16LE(0x20b, 152);
  assert.deepEqual(inspectWindowsExecutable(bytes), { architecture: 'x64', signed: false });
  bytes.writeUInt16LE(0x14c, 132); bytes.writeUInt16LE(0x10b, 152);
  bytes.writeUInt32LE(2048, 152 + 96 + 4 * 8 + 4);
  assert.deepEqual(inspectWindowsExecutable(bytes), { architecture: 'x86', signed: true });
  bytes.writeUInt32LE(99999, 60);
  assert.throws(() => inspectWindowsExecutable(bytes), /Invalid/);
  assert.throws(() => inspectWindowsExecutable(Buffer.alloc(16)), /Not a Windows/);
});
