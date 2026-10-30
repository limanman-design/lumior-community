import assert from 'node:assert/strict';
import test from 'node:test';
import { addWorkspaceContent, createWorkspaceFolder, deleteWorkspaceFolder, moveWorkspaceEntry, syncWorkspaceFiles, validWorkspaceFiles } from '../app/workspace-files.ts';
import { pruneRecycledContents, recycleWorkspaceContent, restoreWorkspaceContent } from '../app/workspace-file-recycle.ts';
import { dayMs, recycleRetentionDays, readWorkspace, recycleBoard } from '../app/workspace-store.ts';
import { createWorkspaceBackup, mergeRestoredWorkspace, readWorkspaceBackup } from '../app/workspace-backup.ts';
import { cleanupCandidates, managedFiles } from '../app/storage-management.ts';
import { contentLink } from '../app/content-links.ts';

const now = Date.now();
const note = (id, patch = {}) => ({ id, kind: 'note', contentRole: 'notePage', title: id, body: 'Preserved body', x: 20, y: 80, width: 360, tags: ['keep'], ...patch });
const snapshot = (files, boards = []) => ({ version: 1, boards, files, deletedBoards: [], activeId: boards[0]?.id || '', nextUntitledIndex: 1 });
const fixture = () => {
  const boards = [{ id: 'board', title: 'Project', cards: [note('instance-a', { sharedId: 'a' }), note('instance-b', { sharedId: 'b' })], edges: [{ id: 'connection', from: 'instance-a', to: 'instance-b', label: 'relationship' }] },
    { id: 'other', title: 'Other', cards: [note('second-a', { sharedId: 'a', body: 'Legacy variant', x: 900 })], edges: [] }];
  let files = createWorkspaceFolder(syncWorkspaceFiles(undefined, boards), 'Research', null, 'folder');
  files = moveWorkspaceEntry(files, 'content:a', 'folder');
  files.entries = files.entries.map(entry => entry.id === 'content:a' ? { ...entry, pinnedAt: 100, lastOpenedAt: 200 } : entry);
  files.navigation = { selectedFolderId: 'folder', selectedEntryId: 'content:a', expandedFolderIds: ['folder'], previewOpen: true };
  return { files, boards };
};

test('recycle and restore preserve content, variants, placement, metadata and connected references without mutating input', () => {
  const initial = fixture(), original = structuredClone(initial);
  const recycled = recycleWorkspaceContent(initial.files, initial.boards, 'a', now);
  assert.deepEqual(initial, original);
  assert.equal(recycled.files.contents.some(content => content.id === 'a'), false);
  assert.equal(recycled.files.entries.some(entry => entry.id === 'content:a'), false);
  assert.deepEqual(recycled.boards.map(board => board.cards.length), [1, 0]);
  assert.equal(recycled.boards[0].edges.length, 0);
  assert.equal(recycled.files.navigation.selectedEntryId, undefined);
  assert.equal(recycled.files.navigation.previewOpen, false);
  assert.equal(recycled.files.recycledContents[0].expiresAt, now + recycleRetentionDays * dayMs);
  assert.equal(validWorkspaceFiles(recycled.files), true);
  assert.equal(readWorkspace(JSON.stringify(snapshot(recycled.files, recycled.boards)), now).files.recycledContents.length, 1);
  const restored = restoreWorkspaceContent(recycled.files, recycled.boards, 'a', now);
  assert.deepEqual(restored.files.contents.find(content => content.id === 'a'), initial.files.contents.find(content => content.id === 'a'));
  assert.deepEqual(restored.files.entries.find(entry => entry.id === 'content:a'), initial.files.entries.find(entry => entry.id === 'content:a'));
  for (const board of restored.boards) {
    const old = initial.boards.find(item => item.id === board.id);
    assert.deepEqual([...board.cards].sort((a, b) => a.id.localeCompare(b.id)), [...old.cards].sort((a, b) => a.id.localeCompare(b.id)));
    assert.deepEqual(board.edges, old.edges);
  }
  assert.equal(restored.files.recycledContents.length, 0);
  assert.equal(restored.files.deletedContentIds.includes('a'), false);
  assert.equal(validWorkspaceFiles(restored.files), true);
});

test('separately recycled connected files recover their edge in either restore order', () => {
  for (const order of [['a', 'b'], ['b', 'a']]) {
    let state = fixture();
    state = recycleWorkspaceContent(state.files, state.boards, 'a', now);
    state = recycleWorkspaceContent(state.files, state.boards, 'b', now + 1);
    for (const id of order) state = restoreWorkspaceContent(state.files, state.boards, id, now + 2);
    assert.deepEqual(state.boards[0].edges, fixture().boards[0].edges);
  }
});

test('folder deletion keeps direct files, subfolders, content and pins; restoration falls back to root', () => {
  const initial = fixture();
  let files = createWorkspaceFolder(initial.files, 'Child', 'folder', 'child');
  files = createWorkspaceFolder(files, 'Nested', 'child', 'nested');
  files = moveWorkspaceEntry(files, 'content:b', 'nested');
  const deleted = deleteWorkspaceFolder(files, 'folder');
  assert.deepEqual(deleted.contents, files.contents);
  assert.equal(deleted.entries.find(entry => entry.id === 'content:a').folderId, null);
  assert.equal(deleted.entries.find(entry => entry.id === 'content:a').pinnedAt, 100);
  assert.equal(deleted.entries.find(entry => entry.id === 'content:b').folderId, 'nested');
  assert.deepEqual(deleted.folders.map(({ id, parentId }) => ({ id, parentId })), [{ id: 'child', parentId: null }, { id: 'nested', parentId: 'child' }]);
  assert.equal(deleted.navigation.selectedFolderId, null);
  assert.equal(validWorkspaceFiles(deleted), true);
  const recycled = recycleWorkspaceContent(files, initial.boards, 'a', now);
  const restored = restoreWorkspaceContent(deleteWorkspaceFolder(recycled.files, 'folder'), recycled.boards, 'a', now);
  assert.equal(restored.files.entries.find(entry => entry.id === 'content:a').folderId, null);
});

test('missing boards stay deleted while existing recycled boards recover file references', () => {
  const initial = fixture();
  const recycled = recycleWorkspaceContent(initial.files, initial.boards, 'a', now);
  const restored = restoreWorkspaceContent(recycled.files, [recycled.boards[1]], 'a', now);
  assert.equal(restored.boards.length, 1);
  assert.equal(restored.boards[0].id, 'other');
  assert.equal(restored.boards[0].cards[0].body, 'Legacy variant');
  const saved = snapshot(restored.files);
  saved.deletedBoards = [recycleBoard(restored.boards[0], now)];
  assert.equal(readWorkspace(JSON.stringify(saved), now).deletedBoards[0].board.cards.length, 1);
});

test('expiry is enforced when restoring and loading, while old workspaces remain readable', () => {
  const initial = fixture();
  const recycled = recycleWorkspaceContent(initial.files, initial.boards, 'a', now);
  const expiry = now + recycleRetentionDays * dayMs;
  assert.equal(pruneRecycledContents(recycled.files, expiry - 1), recycled.files);
  assert.throws(() => restoreWorkspaceContent(recycled.files, recycled.boards, 'a', expiry));
  const loaded = readWorkspace(JSON.stringify(snapshot(recycled.files, recycled.boards)), expiry);
  assert.equal(loaded.files.recycledContents.length, 0);
  assert.ok(loaded.files.deletedContentIds.includes('a'));
  assert.equal(loaded.files.contents.some(content => content.id === 'a'), false);
  assert.ok(readWorkspace(JSON.stringify(snapshot(initial.files, initial.boards)), now));
});

test('standalone notes, PDFs, images and videos restore their original payloads', () => {
  for (const [role, card] of [
    ['notePage', note('file')],
    ['literature', note('file', { kind: 'pdf', pdf: { url: 'lumior-file:pdf', name: 'paper.pdf', size: 5, pages: 1, thumbnail: '' } })],
    ['image', note('file', { kind: 'image', image: 'lumior-file:image' })],
    ['video', note('file', { kind: 'video', video: { url: 'lumior-file:video', poster: '', duration: 12, subtitleUrl: 'lumior-file:subtitles' } })],
  ]) {
    const files = addWorkspaceContent(syncWorkspaceFiles(undefined, []), card, null, role);
    const recycled = recycleWorkspaceContent(files, [], 'file', now);
    assert.equal(validWorkspaceFiles(recycled.files), true);
    const restored = restoreWorkspaceContent(recycled.files, [], 'file', now);
    assert.deepEqual(restored.files.contents, files.contents);
    assert.deepEqual(restored.files.entries, files.entries);
    assert.equal(validWorkspaceFiles(restored.files), true);
  }
});

test('retained PDF excerpts cannot recreate their recycled source during reconciliation', () => {
  const pdf = { url: 'lumior-file:source', name: 'source.pdf', size: 5, pages: 1, thumbnail: '' };
  const mark = { id: 'mark', text: 'Quotation', color: 'yellow', fragments: [{ page: 1, rects: [] }] };
  const source = note('source', { kind: 'pdf', contentRole: 'literature', pdf });
  const excerpt = note('excerpt', { contentRole: 'summary', sourceContentId: 'source', pdfExcerpt: { sourceId: 'source', sourceTitle: 'Source', pdf, mark } });
  const boards = [{ id: 'board', title: 'Board', cards: [source, excerpt], edges: [] }];
  const files = syncWorkspaceFiles(undefined, boards);
  const recycled = recycleWorkspaceContent(files, boards, 'source', now);
  const reconciled = syncWorkspaceFiles(recycled.files, recycled.boards);
  assert.equal(reconciled.contents.some(content => content.id === 'source'), false);
  assert.equal(reconciled.contents.find(content => content.id === 'excerpt').card.pdfExcerpt.pdf.url, pdf.url);
  const restored = restoreWorkspaceContent(reconciled, recycled.boards, 'source', now);
  assert.equal(syncWorkspaceFiles(restored.files, restored.boards).contents.filter(content => content.id === 'source').length, 1);
});

test('duplicate actions, corrupt records and occupied card identities cannot overwrite files', () => {
  const initial = fixture(), recycled = recycleWorkspaceContent(initial.files, initial.boards, 'a', now);
  assert.throws(() => recycleWorkspaceContent(recycled.files, recycled.boards, 'a', now));
  assert.throws(() => addWorkspaceContent(recycled.files, note('a')));
  const occupied = structuredClone(recycled.boards);
  occupied[0].cards.push(note('instance-a', { sharedId: 'unrelated' }));
  assert.throws(() => restoreWorkspaceContent(recycled.files, occupied, 'a', now));
  assert.equal(occupied[0].cards.at(-1).sharedId, 'unrelated');
  const restored = restoreWorkspaceContent(recycled.files, recycled.boards, 'a', now);
  assert.throws(() => restoreWorkspaceContent(restored.files, restored.boards, 'a', now));
  for (const corrupt of [
    item => { item.expiresAt = item.deletedAt; },
    item => { item.content.card.body = null; },
    item => { item.entry.contentId = 'wrong'; },
    item => { item.references[0].cards[0].sharedId = 'wrong'; },
    item => { item.tombstoneIds = []; },
  ]) {
    const files = structuredClone(recycled.files); corrupt(files.recycledContents[0]);
    assert.equal(validWorkspaceFiles(files), false);
    assert.equal(readWorkspace(JSON.stringify(snapshot(files, recycled.boards)), now), null);
  }
});

test('recycled PDF attachments stay protected and survive full backup, merge and restoration with remapped links', async () => {
  const attachmentId = crypto.randomUUID(), blob = new Blob(['synthetic PDF bytes'], { type: 'application/pdf' });
  const attachment = { id: attachmentId, name: 'paper.pdf', type: blob.type, size: blob.size, blob, createdAt: now - 2 * dayMs };
  const initial = fixture();
  initial.boards[0].cards[0] = note('instance-a', { sharedId: 'a', kind: 'pdf', contentRole: 'literature', pdf: { url: `lumior-file:${attachmentId}`, name: attachment.name, size: blob.size, pages: 1, thumbnail: '' } });
  initial.boards[1].cards[0] = { ...initial.boards[0].cards[0], id: 'second-a', x: 900 };
  initial.boards[0].cards[1].blocks = [{ id: 'paragraph', type: 'paragraph', content: [{ type: 'link', href: contentLink('a'), content: [{ type: 'text', text: 'Source', styles: {} }] }] }];
  initial.files = syncWorkspaceFiles(undefined, initial.boards);
  let state = recycleWorkspaceContent(initial.files, initial.boards, 'a', now);
  state = recycleWorkspaceContent(state.files, state.boards, 'b', now + 1);
  const saved = snapshot(state.files, state.boards);
  const usage = managedFiles([attachment], { snapshot: saved, history: [] }, now);
  assert.equal(usage[0].usage, 'recycle');
  assert.ok(usage[0].locations.every(location => location.deleted));
  assert.equal(cleanupCandidates(usage, [attachmentId]).length, 0);
  const backup = await createWorkspaceBackup(saved, { getFile: async id => id === attachmentId ? attachment : undefined, fetch: async () => { throw new Error('No network expected'); } }, () => {});
  const prepared = await readWorkspaceBackup(backup, () => {});
  assert.equal(prepared.files.length, 1);
  assert.equal(await prepared.files[0].blob.text(), await blob.text());
  const remap = new Map();
  const merged = mergeRestoredWorkspace(snapshot(syncWorkspaceFiles(undefined, [])), prepared.snapshot, remap);
  assert.equal(validWorkspaceFiles(merged.files), true);
  assert.notEqual(remap.get('a'), 'a');
  assert.notEqual(merged.files.recycledContents[0].references[0].boardId, 'board');
  let restored = restoreWorkspaceContent(merged.files, merged.boards, remap.get('b'), now + 2);
  restored = restoreWorkspaceContent(restored.files, restored.boards, remap.get('a'), now + 2);
  const board = restored.boards.find(board => board.id === remap.get('board'));
  assert.equal(board.edges.length, 1);
  assert.equal(board.edges[0].from, remap.get('instance-a'));
  assert.equal(board.edges[0].to, remap.get('instance-b'));
  assert.equal(restored.files.contents.find(content => content.id === remap.get('b')).card.blocks[0].content[0].href, contentLink(remap.get('a')));
  assert.equal(restored.files.contents.find(content => content.id === remap.get('a')).card.pdf.url, `lumior-file:${attachmentId}`);
  assert.equal(validWorkspaceFiles(restored.files), true);
});
