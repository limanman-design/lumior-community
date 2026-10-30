import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendImportedImages,
  clipboardImages,
  importImageBatch,
  isImageFile,
} from '../app/image-input.ts';

const image = (name = 'photo.png') =>
  new File(['picture'], name, { type: 'image/png' });
const imported = {
  kind: 'image',
  title: 'Photo',
  sourceName: 'photo.png',
  body: '',
  image: 'blob:saved',
};
const board = (id) => ({ id, title: id, cards: [], edges: [] });

test('clipboard file and item representations add just one image; nameless images get an extension', () => {
  const file = image('');
  const files = clipboardImages({
    files: [file],
    items: [{ kind: 'file', type: file.type, getAsFile: () => file }],
    getData: () => '',
  });
  assert.equal(files.length, 1);
  assert.equal(files[0].name, 'Pasted image.png');
  assert.equal(files[0].size, file.size);
});

test('clipboard falls back to binary items but leaves text and remote image URLs alone', () => {
  const file = image();
  assert.deepEqual(
    clipboardImages({
      files: [],
      items: [{ kind: 'file', type: file.type, getAsFile: () => file }],
      getData: () => '',
    }),
    [file],
  );
  assert.deepEqual(
    clipboardImages({
      files: [],
      items: [],
      getData: () => '<img src="https://private.example/photo.png">',
    }),
    [],
  );
});

test('drops recognize images without MIME and keep documents for their usual importer', () => {
  assert.equal(isImageFile(new File(['image'], 'PHOTO.JPG')), true);
  assert.equal(
    isImageFile(new File(['pdf'], 'paper.pdf', { type: 'application/pdf' })),
    false,
  );
});

test('a failed save never creates a card and does not discard successful images in the batch', async () => {
  const { images, errors } = await importImageBatch(
    [image('broken.png'), image('good.png')],
    async (file) => {
      if (file.name === 'broken.png') throw new Error('Storage full');
      return imported;
    },
  );
  assert.deepEqual(images, [imported]);
  assert.deepEqual(errors, ['broken.png: Storage full']);
});

test('asynchronous imports stay on the original board, preserve edits, and never resurrect a deleted board', () => {
  const original = {
    ...board('original'),
    cards: [{ id: 'existing', title: 'Edited while loading' }],
  };
  const current = board('current');
  let index = 0;
  const result = appendImportedImages(
    [original, current],
    'original',
    [imported, imported],
    { x: 600, y: 400 },
    () => `new-${++index}`,
  );
  assert.equal(result.boards[0].cards[0].title, 'Edited while loading');
  assert.equal(result.boards[0].cards.length, 3);
  assert.equal(result.boards[1], current);
  assert.deepEqual(
    result.cards.map((card) => [card.id, card.x, card.y]),
    [
      ['new-1', 156, 240],
      ['new-2', 616, 240],
    ],
  );
  assert.equal(
    appendImportedImages(
      [current],
      'original',
      [imported],
      { x: 0, y: 0 },
      () => 'new',
    ),
    null,
  );
});
