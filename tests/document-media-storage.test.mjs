import assert from 'node:assert/strict';
import test from 'node:test';
import { addWorkspaceContent, ensureWorkspaceFiles } from '../app/workspace-files.ts';
import { createInitialWorkspace, readWorkspace } from '../app/workspace-store.ts';
import { createWorkspaceBackup, mergeRestoredWorkspace, readWorkspaceBackup } from '../app/workspace-backup.ts';
import { cleanupCandidates, managedFiles, newFileProtectionMs } from '../app/storage-management.ts';
import { fileReferencePrefix, fileReferences, fileUrl, releaseFileUrls, resolveWorkspace, serializeWorkspace } from '../app/workspace-assets.ts';

const media = [
  ['image', 'figure.png', 'image/png'],
  ['video', 'clip.mp4', 'video/mp4'],
  ['audio', 'recording.mp3', 'audio/mpeg'],
  ['file', 'appendix.pdf', 'application/pdf'],
];

function fixture() {
  const stored = media.map(([kind, name, type]) => {
    const blob = new Blob([`Synthetic ${kind} bytes`], { type });
    return { id: crypto.randomUUID(), name, type, size: blob.size, blob, createdAt: 0 };
  });
  const blocks = media.map(([type], index) => ({
    id: `block-${type}`,
    type,
    props: { name: stored[index].name, url: fileUrl(stored[index]), ...(type !== 'file' ? { showPreview: true } : {}) },
  }));
  const note = {
    id: 'synthetic-note', kind: 'note', contentRole: 'notePage', title: 'Media note', body: 'Original text',
    x: 10, y: 20, width: 420,
    blocks: [
      { id: 'paragraph', type: 'paragraph', content: 'Original text', children: blocks.slice(0, 2) },
      ...blocks.slice(2),
      // A copied figure reuses its stored file without duplicating its bytes.
      { ...structuredClone(blocks[0]), id: 'copied-figure' },
    ],
  };
  const snapshot = createInitialWorkspace();
  snapshot.files = addWorkspaceContent(snapshot.files, note);
  return { note, snapshot, stored };
}

function mediaBlocks(note) {
  return [...note.blocks[0].children, ...note.blocks.slice(1)];
}

function noteFrom(snapshot) {
  return snapshot.files.contents.find(content => content.card.title === 'Media note').card;
}

test.afterEach(() => releaseFileUrls());

void test('nested Note media serialize to stable references and reopen with fresh file URLs', () => {
  const { snapshot, stored } = fixture();
  const serialized = serializeWorkspace(snapshot);
  assert.equal(JSON.stringify(serialized).includes('blob:'), false);
  assert.deepEqual(fileReferences(serialized).sort(), stored.map(file => fileReferencePrefix + file.id).sort());
  const savedBlocks = mediaBlocks(noteFrom(serialized));
  assert.deepEqual(savedBlocks.map(block => block.type), ['image', 'video', 'audio', 'file', 'image']);
  assert.deepEqual(savedBlocks.slice(0, 4).map(block => block.props.url), stored.map(file => fileReferencePrefix + file.id));
  const oldUrls = mediaBlocks(noteFrom(snapshot)).map(block => block.props.url);

  releaseFileUrls();
  const reopened = readWorkspace(JSON.stringify(serialized));
  assert.ok(reopened);
  const newUrls = stored.map(fileUrl);
  assert.notEqual(newUrls[0], oldUrls[0]);
  const restored = resolveWorkspace(reopened);
  assert.deepEqual(mediaBlocks(noteFrom(restored)).map(block => block.props.url), [...newUrls, newUrls[0]]);
  assert.equal(noteFrom(restored).blocks[0].content, 'Original text');
  assert.deepEqual(serializeWorkspace(restored), reopened);
});

void test('Note media backup restores every file byte and keeps copied file references shared', async () => {
  const { snapshot, stored } = fixture();
  const files = new Map(stored.map(file => [file.id, file]));
  const reads = [];
  const archive = await createWorkspaceBackup(snapshot, {
    getFile: async id => { reads.push(id); return files.get(id); },
    fetch: async () => { throw new Error('Synthetic stored files must not fetch external content.'); },
  }, () => {});
  assert.equal(reads.length, media.length);
  assert.equal(new Set(reads).size, media.length);
  const prepared = await readWorkspaceBackup(archive, () => {});
  assert.equal(prepared.files.length, media.length);
  for (const actual of prepared.files) {
    const expected = files.get(actual.id);
    assert.ok(expected);
    assert.equal(actual.name, expected.name);
    assert.equal(actual.type, expected.type);
    assert.equal(actual.size, expected.size);
    assert.deepEqual(new Uint8Array(await actual.blob.arrayBuffer()), new Uint8Array(await expected.blob.arrayBuffer()));
  }

  const merged = mergeRestoredWorkspace(createInitialWorkspace(), prepared.snapshot);
  assert.equal(merged.boards.length, 0);
  assert.notEqual(noteFrom(merged).id, 'synthetic-note');
  assert.deepEqual(noteFrom(merged).blocks, noteFrom(prepared.snapshot).blocks);
  releaseFileUrls();
  const restoredUrls = prepared.files.map(fileUrl);
  assert.deepEqual(mediaBlocks(noteFrom(resolveWorkspace(merged))).map(block => block.props.url), [...restoredUrls, restoredUrls[0]]);
});

void test('nested Note media remain protected from cleanup while active or retained by undo history', () => {
  const { snapshot, stored, note } = fixture();
  const now = 10 * newFileProtectionMs;
  const active = managedFiles(stored, { snapshot, history: [] }, now);
  assert.deepEqual(active.map(file => file.usage), ['active', 'active', 'active', 'active']);
  assert.deepEqual(active.map(file => file.kind), ['image', 'video', 'audio', 'pdf']);
  assert.ok(active.every(file => file.locations.some(location => location.cardId === note.id)));
  assert.equal(cleanupCandidates(active, stored.map(file => file.id)).length, 0);

  const withoutNote = createInitialWorkspace();
  const history = managedFiles(stored, { snapshot: withoutNote, history: [note] }, now);
  assert.ok(history.every(file => file.usage === 'history'));
  assert.equal(cleanupCandidates(history, stored.map(file => file.id)).length, 0);
  const unused = managedFiles(stored, { snapshot: withoutNote, history: [] }, now);
  assert.ok(unused.every(file => file.usage === 'unused'));
  assert.equal(cleanupCandidates(unused, stored.map(file => file.id)).length, media.length);

  const boardSnapshot = ensureWorkspaceFiles({
    ...withoutNote,
    boards: [{ id: 'synthetic-board', title: 'Synthetic board', cards: [note], edges: [] }],
    activeId: 'synthetic-board',
  });
  const onBoard = managedFiles(stored, { snapshot: boardSnapshot, history: [] }, now);
  assert.ok(onBoard.every(file => file.usage === 'active'));
  assert.ok(onBoard.every(file => file.locations.some(location => location.boardId === 'synthetic-board')));
});
