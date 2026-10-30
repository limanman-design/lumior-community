import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { previewColors, withMerge, differentColorCount } from '../design-system/color-merge.ts';

const root = new URL('../', import.meta.url);
const palette = JSON.parse(await readFile(new URL('design-system/ui-palette.json', root), 'utf8'));
const examples = JSON.parse(await readFile(new URL('design-system/color-examples.json', root), 'utf8'));
const base = Object.fromEntries(palette.colors.map(c => [c.key, c.value]));

await test('every palette role has one contextual demo with a clear target and source status', () => {
  assert.deepEqual(examples.map(e => e.key).sort(), Object.keys(base).sort());
  for (const example of examples) {
    assert.ok(example.location && example.target && example.scene);
    assert.equal(example.source === null, example.kind === 'unused', example.key);
  }
});

await test('demo color declarations still exist in their stated production source', async () => {
  const require = createRequire(import.meta.url);
  const postcss = createRequire(require.resolve('vite/package.json'))('postcss');
  const sheets = new Map();
  for (const {key,source} of examples) {
    if (!source) continue;
    assert.ok(source.value.includes(`--ui-${key}`), key);
    const file = new URL(source.file, root);
    if (source.file.endsWith('.tsx')) {
      assert.ok((await readFile(file, 'utf8')).includes(`var(--ui-${key})`));
      continue;
    }
    if (!sheets.has(source.file)) sheets.set(source.file, postcss.parse(await readFile(file, 'utf8')));
    const matches = [];
    sheets.get(source.file).walkDecls(d => {
      if (d.parent.selector === source.selector && d.prop === source.property && d.value === source.value) matches.push(d);
    });
    assert.ok(matches.length, `${key}: ${source.file} ${source.selector}`);
  }
});

await test('unused candidates have no product reference, excluding palette definitions', async () => {
  const candidates = examples.filter(e => e.kind === 'unused');
  const files = [];
  async function collect(dir) {
    for (const entry of await readdir(new URL(dir, root), {withFileTypes:true})) {
      const file = `${dir}/${entry.name}`;
      if (entry.isDirectory()) await collect(file);
      else if (/\.(css|tsx?|jsx?)$/.test(entry.name) && file !== 'app/ui-colors.css') files.push(file);
    }
  }
  await collect('app'); await collect('components');
  for (const file of files) {
    const text = await readFile(new URL(file, root), 'utf8');
    for (const item of candidates) assert.ok(!text.includes(`--ui-${item.key}`), `${item.key} is used in ${file}`);
  }
});

await test('preview resolves chains without mutating the palette or retained choices', () => {
  const palette = Object.freeze({a:'#111111', b:'#222222', c:'#333333'});
  const plan = Object.freeze({a:'b'});
  const next = withMerge(palette, plan, 'b', 'c');
  assert.deepEqual(previewColors(palette, next), {a:'#333333', b:'#333333', c:'#333333'});
  assert.deepEqual(plan, {a:'b'});
  assert.equal(palette.a, '#111111');
  assert.deepEqual(withMerge(palette, next, 'a', 'a'), {b:'c'});
});

await test('cyclic or unknown aliases are rejected instead of breaking the preview', () => {
  assert.throws(() => withMerge(base, {canvas:'surface'}, 'surface', 'canvas'), /循环/);
  assert.throws(() => previewColors(base, {canvas:'missing'}), /未知/);
  assert.throws(() => previewColors(base, {missing:'canvas'}), /未知/);
  assert.throws(() => withMerge(base, {}, 'constructor', 'canvas'), /未知/);
});

await test('same-color roles do not pretend to reduce colors, while new merges do', () => {
  const count = differentColorCount(base);
  assert.equal(differentColorCount(previewColors(base, {'line-subtle':'fill-hover'})), count);
  assert.equal(differentColorCount(previewColors(base, {control:'control-raised'})), count);
  assert.equal(differentColorCount(previewColors(base, {panel:'surface'})), count - 1);
  assert.equal(differentColorCount({a:'#FFFFFF', b:'#ffffff'}), 1);
});
