import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {
  readStoredObsidianFolder, readStoredObsidianZip,
  prepareStoredObsidianImport, mergeObsidianImport, obsidianImportPlanMatches,
  createVaultTargetIndex, resolveVaultTarget,
} from '../app/obsidian-import.ts';
import { validWorkspaceFiles, appendWorkspaceContentBatch, syncWorkspaceFiles } from '../app/workspace-files.ts';
import { fileReferences, fileUrl, serializeWorkspace, releaseFileUrls } from '../app/workspace-assets.ts';

const file = (path, body = 'original') => {
  const result = new File([body], path.split('/').at(-1), { lastModified: 1234 });
  Object.defineProperty(result, 'webkitRelativePath', { value: path });
  return result;
};
const empty = () => ({ version: 1, contents: [], entries: [], folders: [] });
const storage = () => {
  const stored = new Map();
  return { stored, storeFile: async (blob, name) => {
    const id = crypto.randomUUID();
    const record = { id, blob, name, type: blob.type, size: blob.size };
    stored.set(id, record);
    return fileUrl(record);
  } };
};

void test('new folder import counts supported notes and attachments after ignoring plugin files', () => {
  const source = readStoredObsidianFolder([
    ...Array.from({ length: 2001 }, (_, index) => file(`Vault/${index}.md`)),
    ...Array.from({ length: 2001 }, (_, index) => file(`Vault/.obsidian/plugins/${index}.json`)),
  ]);
  assert.equal(source.files.length, 2001);
  assert.equal(source.skipped, 2001);
  assert.equal(source.name, 'Vault');
  assert.throws(() => readStoredObsidianFolder([file('V/a.md'), file('V/a.md')]));
  const oversized = file('V/huge.md');
  Object.defineProperty(oversized, 'size', { value: 26 * 1024 * 1024 });
  assert.throws(() => readStoredObsidianFolder([oversized]), /size|大小/);
});

void test('a logical 3 GiB folder prepares only per-note references and preserves existing records', async () => {
  // File objects share a 1 MiB fixture Blob. This verifies 3 GiB of logical
  // input and metadata behavior, not a 3 GiB disk-write benchmark.
  const chunk = new Blob([new Uint8Array(1024 * 1024)]);
  const files = Array.from({ length: 3072 }, (_, index) => file(`Vault/Notes/${index}.md`, chunk));
  const source = readStoredObsidianFolder(files);
  assert.equal(source.files.reduce((sum, entry) => sum + entry.file.size, 0), 3 * 1024 ** 3);
  let writes = 0, checkpoints = 0;
  const prepared = await prepareStoredObsidianImport(source, { storeFile: async (_blob, name) => {
    writes++;
    return `lumior-file:fixture-${name.match(/\d+/)[0]}`;
  } }, { onCheckpoint: async () => { checkpoints++; } });
  assert.equal(writes, 3072); assert.equal(checkpoints, 3072);
  assert.ok(prepared.cards.every(({ card }) => card.body === '' && card.blocks === undefined && card.storedDocument?.source));
  assert.ok(JSON.stringify(prepared).length < 3 * 1024 * 1024);
  const originalCard = { id: 'existing', title: 'Old note', body: 'Unchanged old content', kind: 'note', x: 0, y: 0, width: 360 };
  const old = appendWorkspaceContentBatch(empty(), [{ card: originalCard, folderId: null }]);
  const before = JSON.stringify(old);
  const merged = mergeObsidianImport(old, prepared);
  assert.equal(JSON.stringify(old), before);
  assert.equal(merged.files.contents[0], old.contents[0]);
  assert.equal(merged.files.contents.length, 3073);
  assert.ok(validWorkspaceFiles(merged.files));
  assert.equal(fileReferences(merged.files).length, 3072);
  assert.deepEqual(syncWorkspaceFiles(merged.files, []), merged.files);
});

void test('new import stores originals and all attachments without decoding markdown or media', async () => {
  const memory = storage();
  const source = readStoredObsidianFolder([
    file('V/a.md', '[[b]] ![[pic.png]]'), file('V/b.md', ''), file('V/pic.png'),
    file('V/paper.pdf'), file('V/clip.mp4'), file('V/audio.mp3'), file('V/raw.txt'),
  ]);
  try {
    const prepared = await prepareStoredObsidianImport(source, memory);
    const [a, b, picture, pdf, video, audio, text] = prepared.cards.map(entry => entry.card);
    assert.equal(a.storedDocument.libraryId, b.storedDocument.libraryId);
    assert.equal(a.obsidianSource.libraryId, picture.obsidianSource.libraryId);
    assert.equal(picture.kind, 'image'); assert.equal(pdf.kind, 'pdf'); assert.equal(video.kind, 'video');
    assert.equal(audio.blocks[0].type, 'audio'); assert.equal(text.blocks[0].type, 'file');
    assert.equal(await memory.stored.get(a.storedDocument.source.slice('lumior-file:'.length)).blob.text(), '[[b]] ![[pic.png]]');
    const merged = mergeObsidianImport(empty(), prepared).files;
    assert.ok(validWorkspaceFiles(merged));
    assert.equal(fileReferences(serializeWorkspace(merged)).length, source.files.length);
    const broken = structuredClone(merged);
    broken.contents[0].card.body = 'Should never enter the metadata snapshot';
    assert.equal(validWorkspaceFiles(broken), false);
  } finally { releaseFileUrls(); }
});

void test('cancellation checkpoints the finished copy and restarting reuses identities and originals', async () => {
  const source = readStoredObsidianFolder([file('V/a.md'), file('V/b.md'), file('V/c.md')]);
  const controller = new AbortController(), completed = [];
  let plan, copies = 0;
  const dependencies = { storeFile: async () => { copies++; return `lumior-file:copy-${copies}`; } };
  await assert.rejects(prepareStoredObsidianImport(source, dependencies, {
    signal: controller.signal, onPlan: async value => { plan = value; },
    onCheckpoint: async entry => { completed.push(entry); controller.abort(); },
  }), { name: 'AbortError' });
  assert.equal(copies, 1); assert.equal(completed.length, 1);
  const prepared = await prepareStoredObsidianImport(source, dependencies, { resume: { plan, completed } });
  assert.equal(copies, 3);
  assert.equal(prepared.cards[0].card.id, completed[0].card.id);
  assert.equal(prepared.cards[0].card.storedDocument.source, completed[0].card.storedDocument.source);
  assert.deepEqual(prepared.cards.map(entry => entry.card.id), plan.files.map(entry => entry.id));
  assert.ok(obsidianImportPlanMatches({ ...source, files: [...source.files].reverse() }, plan));
  const changed = readStoredObsidianFolder([file('V/a.md', 'changed'), file('V/b.md'), file('V/c.md')]);
  await assert.rejects(prepareStoredObsidianImport(changed, dependencies, { resume: { plan, completed } }), /match|不一致/);
  assert.equal(copies, 3);
});

void test('checkpoint failures stop before any workspace merge and cannot masquerade as completion', async () => {
  const source = readStoredObsidianFolder([file('V/a.md'), file('V/b.md')]);
  let copies = 0;
  await assert.rejects(prepareStoredObsidianImport(source, { storeFile: async () => { copies++; return 'lumior-file:stored'; } }, {
    onCheckpoint: async () => { throw new Error('Disk full'); },
  }), /Disk full/);
  assert.equal(copies, 1);
  await assert.rejects(prepareStoredObsidianImport(source, { storeFile: async () => 'blob:unregistered' }), /permanent|持久/);
});

void test('new ZIP entry permits over 2000 tiny notes while retaining byte and traversal bounds', async () => {
  const zip = new JSZip();
  for (let index = 0; index < 2001; index++) zip.file(`V/${index}.md`, '');
  zip.file('V/.obsidian/config.json', '{}');
  const source = await readStoredObsidianZip(new File([await zip.generateAsync({ type: 'uint8array' })], 'V.zip'));
  assert.equal(source.files.length, 2001); assert.equal(source.skipped, 1);
  const oversized = file('big.zip');
  Object.defineProperty(oversized, 'size', { value: 251 * 1024 * 1024 });
  await assert.rejects(readStoredObsidianZip(oversized), /unzip|解压/);
  const bad = new JSZip(); bad.file('../escape.md', 'bad');
  await assert.rejects(readStoredObsidianZip(new File([await bad.generateAsync({ type: 'uint8array' })], 'bad.zip')));
});

void test('batch append rejects duplicate content and cyclic or missing folders without mutation', () => {
  const card = { id: 'same', title: 'Note', body: '', kind: 'note', x: 0, y: 0, width: 360 };
  const original = empty(), before = JSON.stringify(original);
  assert.throws(() => appendWorkspaceContentBatch(original, [{ card, folderId: null }, { card, folderId: null }]));
  assert.throws(() => appendWorkspaceContentBatch(original, [], [{ id: 'a', title: 'A', parentId: 'b' }, { id: 'b', title: 'B', parentId: 'a' }]));
  assert.equal(JSON.stringify(original), before);
});

void test('the immutable link index resolves full and unique names and preserves ambiguity', () => {
  const targets = createVaultTargetIndex(new Map([
    ['a/Shared.md', { path: 'a/Shared.md', id: 'a' }],
    ['b/Shared.md', { path: 'b/Shared.md', id: 'b' }],
    ['notes/Unique.md', { path: 'notes/Unique.md', id: 'unique' }],
  ]));
  assert.equal(resolveVaultTarget('Unique', 'root.md', targets).id, 'unique');
  assert.equal(resolveVaultTarget('Shared', 'root.md', targets), undefined);
  assert.equal(resolveVaultTarget('a/Shared', 'root.md', targets).id, 'a');
  assert.equal(resolveVaultTarget('Shared', 'b/Other.md', targets).id, 'b');
});
