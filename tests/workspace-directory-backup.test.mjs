import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceDirectoryBackup, readWorkspaceDirectoryBackup, createStoredDocumentFileRemapper, directoryBackupChunkBytes } from '../app/workspace-directory-backup.ts';
import { mergeRestoredWorkspace } from '../app/workspace-backup.ts';
import { fileReferencePrefix } from '../app/workspace-assets.ts';
import { contentLink } from '../app/content-links.ts';
import { createInitialWorkspace } from '../app/workspace-store.ts';

const missing = () => new DOMException('Not found', 'NotFoundError');
// File System Access fixture writes only inside its in-memory selected tree.
// Large zero-filled files are virtual so the test can detect unbounded reads.
class Directory {
  constructor(name = 'selected') { this.name = name; this.dirs = new Map(); this.files = new Map(); this.writes = []; this.failWrite = false; }
  async getDirectoryHandle(name, { create = false } = {}) {
    if (!this.dirs.has(name)) { if (!create) throw missing(); this.dirs.set(name, new Directory(name)); }
    return this.dirs.get(name);
  }
  async getFileHandle(name, { create = false } = {}) {
    if (!this.files.has(name)) { if (!create) throw missing(); this.files.set(name, new File([], name)); }
    return {
      getFile: async () => this.files.get(name),
      createWritable: async () => {
        let pieces = [], size = 0, finished = false;
        return {
          write: async value => {
            if (finished || this.failWrite) throw new Error('disk full');
            const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
            this.writes.push(bytes.length); size += bytes.length;
            if (size <= 16 * 1024 * 1024) pieces.push(bytes.slice()); else pieces = [];
          },
          close: async () => { finished = true; this.files.set(name, size > 16 * 1024 * 1024 ? zeros(size) : new File(pieces, name)); },
          abort: async () => { finished = true; },
        };
      },
    };
  }
}
let largestRead = 0;
const zeros = size => ({ size,
  arrayBuffer() { throw new Error('must not read an entire large file'); },
  slice(start, end) { const length = Math.min(size, end) - start; largestRead = Math.max(largestRead, length); return { arrayBuffer: async () => new ArrayBuffer(length) }; },
});
const record = (body = 'original') => { const blob = new Blob([body]); return { id: crypto.randomUUID(), name: 'note.md', type: 'text/markdown', size: blob.size, blob }; };
function fixture(records = [record()]) {
  const current = createInitialWorkspace();
  current.boards = [{ id: 'board', title: 'Board', edges: [], cards: records.map((file, index) => ({ id: 'c' + index, title: file.name, body: '', kind: 'note', x: 0, y: 0, width: 360, blocks: [{ type: 'file', props: { url: fileReferencePrefix + file.id } }] })) }];
  current.activeId = 'board';
  return { snapshot: current, source: { getFile: async id => records.find(file => file.id === id), fetch: async () => { throw new Error('unexpected network'); } } };
}
async function exported(records, portable) {
  const parent = new Directory(), source = fixture(records);
  const result = await createWorkspaceDirectoryBackup(source.snapshot, source.source, parent, { portable });
  const directory = parent.dirs.get(result.directoryName);
  return { ...source, result, directory, parent };
}
async function rewriteManifest(directory, update) {
  const original = JSON.parse(await directory.files.get('manifest.json').text());
  update(original);
  directory.files.set('manifest.json', new File([JSON.stringify(original)], 'manifest.json'));
}

void test('folder backup round-trips legacy content and portable preferences without changing originals', async () => {
  const files = [record('one'), record('two')];
  const portable = { version: 1, aiHistories: [], preferences: { language: 'zh' }, apiKey: 'never-back-up-this' };
  const prepared = await exported(files, portable);
  const raw = await prepared.directory.files.get('manifest.json').text();
  assert.equal(raw.includes('never-back-up-this'), false);
  const read = await readWorkspaceDirectoryBackup(prepared.directory);
  assert.equal(read.fileCount, 2); assert.equal(read.totalBytes, 6);
  assert.deepEqual(read.fileIds, files.map(file => file.id));
  const restored = [];
  for await (const file of read.files()) restored.push(await file.blob.text());
  assert.deepEqual(restored, ['one', 'two']);
  assert.equal(read.portable.preferences.language, 'zh');
  assert.equal(read.snapshot.boards[0].cards[0].blocks[0].props.url, fileReferencePrefix + files[0].id);
  assert.equal(prepared.parent.files.size, 0, 'only a newly created child directory receives data');
});

void test('missing or corrupt content and malformed references fail before preparation succeeds', async () => {
  for (const corrupt of ['missing', 'bytes', 'path', 'hash', 'reference', 'duplicate', 'geometry']) {
    const file = record('abc'), prepared = await exported([file]);
    const data = prepared.directory.dirs.get('files');
    if (corrupt === 'missing') data.files.delete(file.id);
    if (corrupt === 'bytes') data.files.set(file.id, new File(['xyz'], file.id));
    if (corrupt === 'path') await rewriteManifest(prepared.directory, value => { value.files[0].id = '../outside'; });
    if (corrupt === 'hash') await rewriteManifest(prepared.directory, value => { value.files[0].chunks = ['z'.repeat(64)]; });
    if (corrupt === 'reference') await rewriteManifest(prepared.directory, value => { value.workspace.boards[0].cards[0].blocks[0].props.url = fileReferencePrefix + crypto.randomUUID(); });
    if (corrupt === 'duplicate') await rewriteManifest(prepared.directory, value => { value.files.push(value.files[0]); });
    if (corrupt === 'geometry') await rewriteManifest(prepared.directory, value => { value.workspace.boards[0].cards[0].width = null; });
    await assert.rejects(readWorkspaceDirectoryBackup(prepared.directory), undefined, corrupt);
  }
});

void test('cancellation and failed writes leave no completed manifest', async () => {
  const controller = new AbortController(), { snapshot, source } = fixture();
  const parent = new Directory();
  await assert.rejects(createWorkspaceDirectoryBackup(snapshot, source, parent, { signal: controller.signal, progress: () => controller.abort() }), { name: 'AbortError' });
  const directory = [...parent.dirs.values()][0];
  assert.equal(directory.files.has('manifest.json'), false);
  await assert.rejects(readWorkspaceDirectoryBackup(directory));
  const failed = new Directory();
  const getDirectory = failed.getDirectoryHandle.bind(failed);
  failed.getDirectoryHandle = async (...args) => {
    const child = await getDirectory(...args);
    const childGet = child.getDirectoryHandle.bind(child);
    child.getDirectoryHandle = async (...next) => { const data = await childGet(...next); data.failWrite = true; return data; };
    return child;
  };
  await assert.rejects(createWorkspaceDirectoryBackup(snapshot, source, failed), /disk full/);
  assert.equal([...failed.dirs.values()][0].files.has('manifest.json'), false);
});

void test('restore rechecks files changed after the user previews a backup', async () => {
  const file = record('original'), prepared = await exported([file]);
  const read = await readWorkspaceDirectoryBackup(prepared.directory);
  prepared.directory.dirs.get('files').files.set(file.id, new File(['tampered'], file.id));
  await assert.rejects(async () => { for await (const _file of read.files()) { /* verification must fail first */ } });
});

void test('directory backups support more than 2000 separate files without ZIP limits', async () => {
  const files = Array.from({ length: 2100 }, () => record(''));
  const prepared = await exported(files);
  const restored = await readWorkspaceDirectoryBackup(prepared.directory);
  assert.equal(restored.fileCount, 2100);
  assert.equal(restored.totalBytes, 0);
  assert.equal(restored.fileIds.length, 2100);
});

void test('a synthetic 3 GiB library copies and verifies using at most 4 MiB reads', async () => {
  largestRead = 0;
  const bytes = 3 * 1024 * 1024 * 1024;
  const file = { id: crypto.randomUUID(), name: 'synthetic-large-resource', type: 'application/octet-stream', size: bytes, blob: zeros(bytes) };
  const prepared = await exported([file]);
  assert.equal(prepared.result.totalBytes, bytes);
  const data = prepared.directory.dirs.get('files');
  assert.equal(Math.max(...data.writes), directoryBackupChunkBytes);
  assert.equal(data.writes.reduce((total, size) => total + size, 0), bytes);
  const read = await readWorkspaceDirectoryBackup(prepared.directory);
  assert.equal(read.totalBytes, bytes);
  assert.equal(largestRead, directoryBackupChunkBytes);
});

void test('restore remaps edited JSON and library identities while keeping raw Markdown byte exact', async () => {
  const original = record('[[B]]\n<!-- untouched -->');
  const edited = record(JSON.stringify({ version: 1, body: 'Edited', blocks: [{ type: 'paragraph', content: [{ type: 'link', href: contentLink('other'), content: [{ type: 'text', text: 'B' }] }] }, { type: 'file', props: { url: fileReferencePrefix + original.id } }] }));
  const { snapshot } = fixture([original]);
  const card = snapshot.boards[0].cards[0];
  card.storedDocument = { version: 1, libraryId: 'library', path: 'A.md', source: fileReferencePrefix + original.id, document: fileReferencePrefix + edited.id };
  card.obsidianSource = { libraryId: 'library', path: 'A.md' };
  const identities = new Map([['other', 'new-other']]), references = new Map([[fileReferencePrefix + original.id, fileReferencePrefix + crypto.randomUUID()]]);
  const remap = createStoredDocumentFileRemapper(snapshot, identities, references);
  assert.equal(await remap(original), original);
  const result = await remap(edited), body = JSON.parse(await result.blob.text());
  assert.equal(body.blocks[0].content[0].href, contentLink('new-other'));
  assert.equal(body.blocks[1].props.url, references.get(fileReferencePrefix + original.id));
  const current = createInitialWorkspace();
  const merged = mergeRestoredWorkspace(current, snapshot);
  const restored = merged.boards[0].cards[0];
  assert.notEqual(restored.storedDocument.libraryId, 'library');
  assert.equal(restored.storedDocument.libraryId, restored.obsidianSource.libraryId);
  assert.equal(snapshot.boards[0].cards[0].storedDocument.libraryId, 'library');
});

void test('restore identity allocation can be reused when merging the latest workspace after a long copy', () => {
  const { snapshot: backup } = fixture([record('backup')]);
  const ids = new Map();
  const allocation = mergeRestoredWorkspace(createInitialWorkspace(), backup, ids);
  const allocatedBoardId = allocation.boards[0].id;
  const allocatedCardId = allocation.boards[0].cards[0].id;
  const current = createInitialWorkspace();
  current.boards = [{ id: 'existing', title: 'Edited while copying', cards: [
    { id: 'existing-note', kind: 'note', title: 'Existing note', body: 'Latest edit must survive', x: 0, y: 0, width: 360 },
    { id: 'new-note', kind: 'note', title: 'Created while copying', body: 'New content must survive', x: 400, y: 0, width: 360 },
  ], edges: [] }];
  current.activeId = 'existing';
  const before = structuredClone(current.boards[0]);
  const merged = mergeRestoredWorkspace(current, backup, ids);
  assert.deepEqual(merged.boards[0], before);
  assert.equal(merged.boards[1].id, allocatedBoardId);
  assert.equal(merged.boards[1].cards[0].id, allocatedCardId);
  assert.equal(ids.get('c0'), allocatedCardId);
  assert.deepEqual(current.boards[0], before, 'the latest existing workspace was never mutated');
});
