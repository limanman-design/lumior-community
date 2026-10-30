import test from 'node:test';
import assert from 'node:assert/strict';
import {
  managedFiles,
  cleanupCandidates,
  duplicateFileGroups,
  newFileProtectionMs,
  formatBytes,
} from '../app/storage-management.ts';
import {
  fileUrl,
  fileReferencePrefix,
  releaseFileUrls,
} from '../app/workspace-assets.ts';
import { StorageAccess } from '../app/storage-access.ts';
import { setLanguage } from '../app/i18n-core.ts';

// Keep the original diagnostic assertion explicit about its UI language.
test.beforeEach(() => setLanguage('zh', false));
test.afterEach(() => setLanguage('en', false));

const now = 10 * newFileProtectionMs;
const file = (id, extra = {}) => ({
  id,
  name: `${id}.png`,
  type: 'image/png',
  size: 32,
  ...extra,
});
const reference = (id) => fileReferencePrefix + id;
const card = (id, image) => ({
  id,
  kind: 'image',
  title: id,
  image,
  body: '',
  x: 0,
  y: 0,
  width: 300,
});
const board = (id, cards) => ({ id, title: id, cards, edges: [] });
const snapshot = (boards = []) => ({
  version: 1,
  boards,
  deletedBoards: [],
  activeId: boards[0]?.id || '',
  nextUntitledIndex: 1,
});

test('classification protects active, nested, recycled, undo/redo, annotations and new files separately', () => {
  const state = snapshot([
    board('a', [
      card('one', reference('active')),
      {
        ...card('two'),
        blocks: [{ type: 'image', props: { url: reference('nested') } }],
      },
    ]),
    board('b', [card('three', reference('active'))]),
  ]);
  state.deletedBoards = [
    {
      board: board('deleted', [card('four', reference('recycle'))]),
      deletedAt: 0,
      expiresAt: now + 100,
    },
  ];
  state.pdfMarks = {
    [reference('annotated')]: [{ id: 'mark' }],
    [reference('empty-marks')]: [],
  };
  const ids = [
    'active',
    'nested',
    'recycle',
    'undo',
    'redo',
    'annotated',
    'empty-marks',
    'recent',
    'old',
    'unused',
  ];
  const result = managedFiles(
    ids.map((id) =>
      file(
        id,
        id === 'recent'
          ? { createdAt: now - 1 }
          : id === 'old'
            ? { createdAt: now - newFileProtectionMs }
            : {},
      ),
    ),
    {
      snapshot: state,
      history: [
        card('undo', reference('undo')),
        card('redo', reference('redo')),
      ],
    },
    now,
  );
  assert.deepEqual(
    Object.fromEntries(result.map((item) => [item.id, item.usage])),
    {
      active: 'active',
      nested: 'active',
      recycle: 'recycle',
      undo: 'history',
      redo: 'history',
      annotated: 'history',
      'empty-marks': 'unused',
      recent: 'recent',
      old: 'unused',
      unused: 'unused',
    },
  );
  assert.deepEqual(
    result[0].locations.map((location) => location.boardId),
    ['a', 'b'],
  );
  assert.equal(
    result.find((item) => item.id === 'recycle').locations[0].deleted,
    true,
  );
  assert.deepEqual(
    cleanupCandidates(result, ids.concat('unused')).map((item) => item.id),
    ['empty-marks', 'old', 'unused'],
  );
});

test('a file referenced after cleanup preview or still referenced in persisted data cannot be collected', () => {
  const old = file('old');
  const preview = managedFiles(
    [old],
    { snapshot: snapshot(), history: [] },
    now,
  );
  assert.equal(cleanupCandidates(preview, ['old']).length, 1);
  const updated = snapshot([
    board('edited', [card('added', reference('old'))]),
  ]);
  assert.equal(
    cleanupCandidates(
      managedFiles([old], { snapshot: updated, history: [] }, now),
      ['old'],
    ).length,
    0,
  );
  assert.equal(
    cleanupCandidates(
      managedFiles([old], { snapshot: snapshot(), history: [] }, now, updated),
      ['old'],
    ).length,
    0,
  );
});

test('registered blob URLs and annotation keys resolve to the same protected stored file', () => {
  const stored = { ...file('blob-test'), blob: new Blob(['image']) };
  const url = fileUrl(stored);
  const state = snapshot([board('a', [card('c', url)])]);
  const result = managedFiles([stored], { snapshot: state, history: [] }, now);
  assert.equal(result[0].usage, 'active');
  assert.equal(result[0].locations[0].cardId, 'c');
  releaseFileUrls();
});

test('duplicate detection compares bytes, not filenames or equal sizes', async () => {
  const blobs = new Map([
    ['a', new Blob(['abc'])],
    ['b', new Blob(['abc'])],
    ['c', new Blob(['xyz'])],
    ['d', new Blob(['longer'])],
  ]);
  const entries = [
    file('a', { name: 'first.png', size: 3 }),
    file('b', { name: 'renamed.jpg', size: 3 }),
    file('c', { name: 'first.png', size: 3 }),
    file('d', { size: 6 }),
  ];
  const read = [],
    progress = [];
  const groups = await duplicateFileGroups(
    entries,
    async (id) => {
      read.push(id);
      return blobs.get(id);
    },
    (done, total) => progress.push([done, total]),
  );
  assert.deepEqual(groups, [['a', 'b']]);
  assert.deepEqual(read, ['a', 'b', 'c']);
  assert.deepEqual(progress.at(-1), [3, 3]);
  await assert.rejects(
    duplicateFileGroups(
      entries,
      async () => undefined,
      () => {},
    ),
    /刷新/,
  );
});

test('byte totals format empty, invalid and large values correctly', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1024 ** 3), '1 GB');
  assert.equal(formatBytes(-1), '—');
  assert.equal(formatBytes(NaN), '—');
});

test('cleanup refuses other windows and unsupported locks, then restores its own shared lease', async () => {
  const events = [],
    stops = [];
  const locks = {
    request: async (_name, options, callback) => {
      events.push(options.mode);
      if (options.mode === 'shared') {
        await callback({ mode: 'shared' });
        events.push('released');
      } else return callback(null);
    },
  };
  const access = new StorageAccess(locks);
  await access.hold();
  await assert.rejects(
    access.exclusive(async () => {
      stops.push('deleted');
    }),
    /关闭其他/,
  );
  assert.deepEqual(stops, []);
  assert.deepEqual(events, ['shared', 'released', 'exclusive', 'shared']);
  await access.release();
  await assert.rejects(
    new StorageAccess().exclusive(async () => {}),
    /不支持/,
  );
});

test('exclusive cleanup restores the workspace lease on transaction failure as well as success', async () => {
  let calls = 0;
  const locks = {
    request: async (_name, options, callback) => {
      calls++;
      return callback({ mode: options.mode });
    },
  };
  const access = new StorageAccess(locks);
  await access.hold();
  await assert.rejects(
    access.exclusive(async () => {
      throw new Error('Transaction failed');
    }),
    /Transaction failed/,
  );
  assert.equal(calls, 3);
  assert.equal(await access.exclusive(async () => 'complete'), 'complete');
  assert.equal(calls, 5);
  await access.release();
});
