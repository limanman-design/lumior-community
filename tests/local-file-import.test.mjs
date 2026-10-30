import test from 'node:test';
import assert from 'node:assert/strict';
import { importLocalFileBatch } from '../app/local-file-import.ts';

const file = name => new File(['fixture'], name);
const card = name => ({ title: name, body: '', kind: name.endsWith('.pdf') ? 'pdf' : 'image' });

test('a damaged file does not stop later files and order stays intact', async () => {
  const files = [file('one.pdf'), file('damaged.pdf'), file('two.pdf')], progress = [];
  const result = await importLocalFileBatch(files, async item => {
    if (item.name === 'damaged.pdf') throw new Error('Damaged PDF');
    return card(item.name);
  }, { onProgress: value => progress.push(value) });
  assert.deepEqual(result.cards.map(value => value.title), ['one.pdf', 'two.pdf']);
  assert.deepEqual(result.errors, [{ name: 'damaged.pdf', message: 'Damaged PDF' }]);
  assert.equal(progress.at(-1).completed, 3);
  assert.equal(progress.at(-1).total, 3);
  assert.equal(files.length, 3);
});

test('media decoding is sequential so a batch does not multiply peak memory', async () => {
  let active = 0, maxActive = 0;
  await importLocalFileBatch([file('one.mp4'), file('two.mp4'), file('three.mp4')], async item => {
    active++; maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setTimeout(resolve, 1));
    active--;
    return card(item.name);
  });
  assert.equal(maxActive, 1);
  assert.equal(active, 0);
});

test('a type-specific picker rejects a mismatched file before decoding', async () => {
  const decoded = [];
  const result = await importLocalFileBatch([file('photo.png'), file('paper.pdf')], async item => {
    decoded.push(item.name); return card(item.name);
  }, { kind: 'pdf' });
  assert.deepEqual(decoded, ['paper.pdf']);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].name, 'photo.png');
  assert.equal(result.cards.length, 1);
});

test('cancelling an in-flight import prevents the next decode and batch commit', async () => {
  const controller = new AbortController(), decoded = [];
  await assert.rejects(importLocalFileBatch([file('one.pdf'), file('two.pdf')], async item => {
    decoded.push(item.name); controller.abort(); return card(item.name);
  }, { signal: controller.signal }), error => error.name === 'AbortError');
  assert.deepEqual(decoded, ['one.pdf']);
});

test('an empty selection creates no cards or progress output', async () => {
  const result = await importLocalFileBatch([], async () => { throw new Error('No selection'); }, {
    onProgress: () => { throw new Error('No progress'); },
  });
  assert.deepEqual(result, { cards: [], errors: [] });
});
