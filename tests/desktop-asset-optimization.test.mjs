import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { optimizeDesktopPngs } from '../desktop/scripts/optimize-assets.mjs';
const require = createRequire(new URL('../desktop/package.json', import.meta.url));
const sharp = require('sharp');

test('package PNG optimization is pixel-exact, preserves paths and leaves other assets byte-identical', async t => {
  const dir = await mkdtemp('/private/tmp/lumior-png-');
  t.after(() => rm(dir, { recursive: true, force: true }));
  const png = await sharp({ create: { width: 300, height: 300, channels: 4, background: { r: 45, g: 100, b: 70, alpha: .6 } } }).png({ compressionLevel: 0 }).toBuffer();
  await writeFile(`${dir}/keep-name.png`, png);
  await writeFile(`${dir}/original.pdf`, 'original PDF bytes');
  const report = await optimizeDesktopPngs(dir);
  assert.equal(report.files.length, 1);
  assert.ok(report.savedBytes > 64000);
  const output = await readFile(`${dir}/keep-name.png`);
  assert.deepEqual(await sharp(output).ensureAlpha().raw().toBuffer(), await sharp(png).ensureAlpha().raw().toBuffer());
  assert.equal(await readFile(`${dir}/original.pdf`, 'utf8'), 'original PDF bytes');
  assert.deepEqual(await optimizeDesktopPngs(dir), { files: [], savedBytes: 0 });
});
