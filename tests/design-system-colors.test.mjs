import test from 'node:test';
import assert from 'node:assert/strict';
import { rgba, composite, contrast } from '../design-system/color-utils.ts';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const root = new URL('../', import.meta.url);
const palette = JSON.parse(await readFile(new URL('design-system/ui-palette.json',root),'utf8'));
const values=Object.fromEntries(palette.colors.map(c=>[c.key,c.value]));
await test('hex parsing includes shorthand transparency and rejects malformed review input',()=>{
  assert.deepEqual(rgba('#fff'),[255,255,255,1]);
  assert.deepEqual(rgba('#1234'),[17,34,51,68/255]);
  assert.throws(()=>rgba('#12xz89'));
});
await test('contrast uses actual composited background and standard black-white endpoints',()=>{
  assert.equal(contrast('#000000','#ffffff'),21);
  assert.equal(contrast('#ffffff','#ffffff'),1);
  assert.equal(composite('#ffffff00','#191919'),'#191919');
  assert.equal(contrast('#ffffff80','#191919'),contrast(composite('#ffffff80','#191919'),'#191919'));
  assert.throws(()=>contrast('#ffffff','#19191980'));
});
await test('separating destructive text from fill solves the white small-text contrast problem',()=>{
  assert.ok(contrast('#ffffff','#f4776b')<4.5);
  assert.ok(contrast('#ffffff','#b73f34')>=4.5);
  assert.ok(contrast('#f4776b','#232323')>=4.5);
});
await test('the production palette stays under 50 including alpha variants, with unique purposes',()=>{
  assert.ok(palette.colors.length<=50);
  assert.equal(new Set(palette.colors.map(c=>c.key)).size,palette.colors.length);
  for(const c of palette.colors){assert.ok(c.name && c.usage && c.group);assert.equal(rgba(c.value).length,4);}
});
await test('production reading colors and destructive / neutral action pairs remain legible',()=>{
  for(const bg of ['canvas','surface','panel','control','control-raised','control-hover']) {
    for(const fg of ['text','text-secondary','text-muted']) assert.ok(contrast(values[fg],values[bg])>=4.5,`${fg} on ${bg}`);
  }
  assert.ok(contrast(values.white,values['danger-fill'])>=4.5);
  assert.ok(contrast(values.ink,values.white)>=4.5);
  assert.ok(contrast(values.danger,values.panel)>=4.5);
});
await test('selected background keeps white 10 percent and is distinct from hover and pressed',()=>{
  const [r,g,b,a]=rgba(values['fill-selected']);
  assert.deepEqual([r,g,b],[255,255,255]);
  assert.ok(Math.abs(a-.1)<1/255);
  assert.notEqual(values['fill-selected'],values['fill-hover']);
  assert.notEqual(values['fill-selected'],values['fill-pressed']);
});
await test('migration preserves registered PDF, user tag, and artwork colors',async()=>{
  const require=createRequire(import.meta.url);
  const postcss=createRequire(require.resolve('vite/package.json'))('postcss');
  const fixtures=JSON.parse(await readFile(new URL('tests/fixtures/ui-content-colors.json',root),'utf8'));
  const sheets=new Map();
  for(const entry of fixtures) {
    if(!sheets.has(entry.file))sheets.set(entry.file,postcss.parse(await readFile(new URL(entry.file,root),'utf8')));
    const found=[];
    sheets.get(entry.file).walkDecls(d=>{if(d.parent.selector===entry.selector && d.prop===entry.property)found.push(d.value);});
    assert.ok(found.includes(entry.value),`${entry.reason}: ${entry.file} ${entry.selector}`);
  }
});
