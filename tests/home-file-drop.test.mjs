import test from 'node:test';
import assert from 'node:assert/strict';
import { isHomeFileDrop, readHomeFileDrop } from '../app/home-file-drop.ts';
import { homeFileDragType } from '../app/home-file-tree-model.ts';
import { importLocalFileBatch } from '../app/local-file-import.ts';

const file = name => new File(['fixture'], name);
const item = value => ({ kind: 'file', getAsFile: () => value });
const transfer = (files, items = files.map(item), types = ['Files']) => ({ types, items, files });

test('native file drags are accepted before protected FileList becomes readable', () => {
  assert.equal(isHomeFileDrop(transfer([])), true);
  assert.deepEqual(readHomeFileDrop(transfer([])), { files: [], directories: 0 });
});

test('internal moves, text and links are not interpreted as uploaded files', () => {
  for (const types of [[homeFileDragType], [homeFileDragType, 'Files'], ['text/plain'], ['text/uri-list']]) {
    const source = transfer([file('existing.pdf')], undefined, types);
    assert.equal(isHomeFileDrop(source), false);
    assert.deepEqual(readHomeFileDrop(source), { files: [], directories: 0 });
  }
});

test('all dropped files retain their order and identity, without duplicate FileList imports', () => {
  const files = [file('一篇文献.pdf'), file('reading notes.md'), file('image.png')];
  const result = readHomeFileDrop(transfer(files));
  assert.deepEqual(result.files, files);
  assert.equal(result.files[0], files[0]);
  assert.equal(result.directories, 0);
});

test('directories are reported and skipped while valid siblings still import', async () => {
  const valid = file('notes.txt');
  const source = transfer([file('folder'), valid], [
    { kind: 'file', webkitGetAsEntry: () => ({ isDirectory: true }), getAsFile: () => { throw new Error('Must not read a directory'); } },
    item(valid),
  ]);
  const dropped = readHomeFileDrop(source);
  assert.equal(dropped.directories, 1);
  const result = await importLocalFileBatch(dropped.files, async incoming => ({ kind: 'note', title: incoming.name, body: await incoming.text() }));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.cards.map(card => card.title), ['notes.txt']);
});

test('FileList-only browsers and missing entry metadata preserve valid files', () => {
  const files = [file('paper.pdf')];
  assert.deepEqual(readHomeFileDrop(transfer(files, [])).files, files);
  assert.deepEqual(readHomeFileDrop(transfer(files, [{ ...item(files[0]), webkitGetAsEntry: () => { throw new Error('Not available'); } }])).files, files);
});

test('non-file items and unreadable entries do not hide valid file entries', () => {
  const valid = file('image.png');
  const source = transfer([valid], [{ kind: 'string' }, item(null), item(valid)]);
  assert.deepEqual(readHomeFileDrop(source), { files: [valid], directories: 0 });
});

test('a rejected file is left to the existing importer and does not block the next file', async () => {
  const dropped = readHomeFileDrop(transfer([file('broken.pdf'), file('notes.txt')]));
  const result = await importLocalFileBatch(dropped.files, async incoming => {
    if (incoming.name === 'broken.pdf') throw new Error('Invalid PDF');
    return { kind: 'note', title: incoming.name, body: await incoming.text() };
  });
  assert.deepEqual(result.errors, [{ name: 'broken.pdf', message: 'Invalid PDF' }]);
  assert.equal(result.cards[0].title, 'notes.txt');
});
