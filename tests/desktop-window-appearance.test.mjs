import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { mainWindowMaterial } = require('../desktop/runtime/window-appearance.cjs');

test('macOS uses native under-window vibrancy without a transparent-mode window', () => {
  const options = mainWindowMaterial('darwin', '25.0.0');
  assert.equal(options.backgroundColor, '#00000000');
  assert.equal(options.vibrancy, 'under-window');
  assert.equal(options.visualEffectState, 'active');
  assert.equal(options.transparent, undefined);
});

test('Windows acrylic is limited to supported builds with opaque fallback elsewhere', () => {
  for (const release of ['10.0.22621', '10.0.26100', '11.0.1000']) {
    const options = mainWindowMaterial('win32', release);
    assert.equal(options.backgroundMaterial, 'acrylic');
    assert.equal(options.backgroundColor, '#00000000');
    assert.equal(options.transparent, undefined);
  }
  for (const release of ['10.0.19045', '10.0.22000', '10.0.22620', '', 'unknown']) assert.deepEqual(mainWindowMaterial('win32', release), {});
  assert.deepEqual(mainWindowMaterial('linux', '6.12.0'), {});
});

test('desktop bundle includes the material selector used by the main window', () => {
  const packageJson = require('../desktop/package.json');
  assert.ok(packageJson.build.files.includes('runtime/window-appearance.cjs'));
});
