import assert from 'node:assert/strict';
import test from 'node:test';
import { addWorkspaceContent, boardEntryId, contentEntryId, createWorkspaceFolder, deleteWorkspaceContent, deleteWorkspaceFolder, ensureWorkspaceFiles, markWorkspaceEntryOpened, moveWorkspaceEntry, moveWorkspaceFolder, patchWorkspaceContent, projectWorkspaceFiles, removeWorkspaceContentReference, setWorkspaceEntryPinned, syncWorkspaceFiles, validWorkspaceFiles } from '../app/workspace-files.ts';
import { readWorkspace, recycleBoard } from '../app/workspace-store.ts';
import { createWorkspaceBackup, mergeRestoredWorkspace, readWorkspaceBackup } from '../app/workspace-backup.ts';
import { managedFiles } from '../app/storage-management.ts';

const note = (id, extra = {}) => ({ id, kind: 'note', title: 'An ordinary note', body: 'Original body', x: 10, y: 20, width: 420, ...extra });
const board = (id, cards) => ({ id, title: id, cards, edges: [] });
const snapshot = boards => ({ version: 1, boards, deletedBoards: [], activeId: boards[0]?.id || '', nextUntitledIndex: 1 });
const pdf = { url: 'lumior-file:pdf-file', name: 'source.pdf', size: 20, pages: 1, thumbnail: '' };
const mark = { id: 'mark', text: 'Quotation', color: 'yellow', fragments: [{ page: 1, rects: [{ x: 0, y: 0, width: 0.2, height: 0.1 }] }] };

test('unopened imports enter recents and modified sorting at their Lumior import time, surviving reload', () => {
  const importedAt = Date.UTC(2026, 9, 27, 9);
  const sourceDate = '2020-01-01T00:00:00.000Z';
  const files = addWorkspaceContent(syncWorkspaceFiles(undefined, []), note('new-file', { kind: 'pdf', pdf, createdAt: sourceDate, updatedAt: sourceDate }), null, 'literature', importedAt);
  assert.equal(files.entries[0].lastOpenedAt, undefined);
  const restored = readWorkspace(JSON.stringify({ ...snapshot([]), files }));
  const item = projectWorkspaceFiles(restored.files, [])[0];
  assert.equal(item.lastOpenedAt, importedAt);
  assert.equal(item.updatedAt, importedAt);
  assert.equal(item.content.card.createdAt, sourceDate);
  assert.equal(item.entry.addedAt, importedAt);
  const opened = projectWorkspaceFiles(markWorkspaceEntryOpened(restored.files, item.id, importedAt + 1000), [])[0];
  assert.equal(opened.lastOpenedAt, importedAt + 1000);
  assert.equal(opened.updatedAt, importedAt, 'reading alone must not change the modification date');
  const edited = patchWorkspaceContent(files, [], 'new-file', { title: 'Edited', updatedAt: new Date(importedAt + 2000).toISOString() });
  assert.equal(projectWorkspaceFiles(edited.files, [])[0].updatedAt, importedAt + 2000);
});

test('legacy real creation dates recover unopened files without manufacturing history on load', () => {
  const createdAt = '2026-10-26T10:00:00.000Z';
  const boards = [board('legacy', [
    note('real', { contentRole: 'notePage', createdAt, creationDateSource: 'actual' }),
    note('simulated', { contentRole: 'notePage', createdAt, creationDateSource: 'simulated' }),
    note('unknown', { contentRole: 'notePage' }),
  ])];
  const files = syncWorkspaceFiles(undefined, boards);
  const items = projectWorkspaceFiles(files, boards);
  assert.equal(items.find(item => item.id === contentEntryId('real')).lastOpenedAt, Date.parse(createdAt));
  for (const id of ['simulated', 'unknown']) {
    const item = items.find(item => item.id === contentEntryId(id));
    assert.equal(item.lastOpenedAt, undefined);
    assert.equal(item.updatedAt, undefined);
  }
  assert.equal(syncWorkspaceFiles(files, boards), files);
  assert.ok(files.entries.every(entry => entry.addedAt === undefined));
});

test('new empty boards enter recents and retain creation and modification dates after reload', () => {
  const createdAt = '2026-10-27T10:00:00.000Z', updatedAt = '2026-10-27T11:00:00.000Z';
  const saved = readWorkspace(JSON.stringify(snapshot([{ ...board('new-board', []), createdAt, updatedAt }])));
  const item = projectWorkspaceFiles(saved.files, saved.boards)[0];
  assert.equal(item.lastOpenedAt, Date.parse(createdAt));
  assert.equal(item.updatedAt, Date.parse(updatedAt));
});

test('invalid import timestamps are rejected without changing existing files', () => {
  const files = syncWorkspaceFiles(undefined, []);
  for (const now of [NaN, Infinity, -1, 1.5]) {
    assert.throws(() => addWorkspaceContent(files, note('bad'), null, 'notePage', now), RangeError);
    assert.equal(validWorkspaceFiles({ ...files, contents: [{ id: 'bad', role: 'notePage', card: note('bad') }], entries: [{ id: 'content:bad', kind: 'content', contentId: 'bad', folderId: null, addedAt: now }] }), false);
  }
  assert.equal(files.contents.length, 0);
});

test('incremental migration is idempotent and preserves conflicting shared bodies, canvas geometry and edges', () => {
  const first = board('a', [note('a-note', { sharedId: 'shared', title: 'English', body: 'English body' })]);
  const second = board('b', [note('b-note', { sharedId: 'shared', title: '中文', body: '中文正文', x: 800, y: 900, width: 600 })]);
  second.edges.push({ id: 'edge', from: 'b-note', to: 'b-note' });
  const input = snapshot([first, second]), original = structuredClone(input);
  const migrated = ensureWorkspaceFiles(input);
  assert.deepEqual(input, original);
  assert.deepEqual(migrated.boards, original.boards);
  assert.equal(migrated.files.contents.length, 1);
  assert.deepEqual(migrated.files.contents[0].variants.map(value => value.card.body), ['English body', '中文正文']);
  assert.equal(ensureWorkspaceFiles(migrated), migrated);
  assert.equal(syncWorkspaceFiles(migrated.files, migrated.boards), migrated.files);
  const changed = [{ ...first, cards: [{ ...first.cards[0], title: 'New title' }] }, second];
  const synced = syncWorkspaceFiles(migrated.files, changed);
  assert.equal(synced.contents[0].card.title, 'New title');
  assert.equal(synced.contents[0].card.body, 'English body');
  assert.equal(synced.contents[0].variants[1].card.body, '中文正文');
  assert.equal(validWorkspaceFiles(synced), true);
});

test('Home excludes explicit summaries, plain text and uncertain legacy notes before counts; never guesses metadata', () => {
  const source = note('source', { kind: 'pdf', title: 'Study', pdf });
  const excerpt = note('excerpt', { pdfExcerpt: { sourceId: 'source', sourceTitle: 'Study', pdf, mark } });
  const all = [source, excerpt, note('legacy'), note('text', { kind: 'text' }), note('page', { contentRole: 'notePage' }), note('image', { kind: 'image', image: 'image.png' }), note('video', { kind: 'video', video: { url: 'video.mp4', poster: '', duration: 5 } })];
  const saved = ensureWorkspaceFiles(snapshot([board('b', all)]));
  const items = projectWorkspaceFiles(saved.files, saved.boards);
  assert.deepEqual(items.map(item => item.kind).sort(), ['board', 'image', 'literature', 'notePage', 'video']);
  assert.equal(items.find(item => item.kind === 'literature').authors, undefined);
  assert.equal(items.find(item => item.kind === 'literature').year, undefined);
  assert.equal(saved.files.contents.find(content => content.id === 'excerpt').sourceContentId, 'source');
  assert.equal(saved.files.contents.find(content => content.id === 'legacy').role, 'note');
  assert.ok(saved.files.entries.every(entry => entry.folderId === null));
  assert.equal(readWorkspace(JSON.stringify(saved)).files.contents.find(content => content.id === 'excerpt').role, 'summary');
});

void test('explicit summaries retain their source metadata without modifying saved canvas instances', () => {
  const summary = note('synthetic-summary', { contentRole: 'summary', sourceContentId: 'synthetic-source' });
  const input = snapshot([board('synthetic-board', [summary])]);
  const original = structuredClone(input);
  const saved = ensureWorkspaceFiles(input);
  assert.deepEqual(input, original);
  assert.equal(saved.files.contents[0].role, 'summary');
  assert.equal(saved.files.contents[0].sourceContentId, 'synthetic-source');
  assert.equal(saved.files.contents[0].card.contentRole, 'summary');
  assert.equal(saved.files.contents[0].card.sourceContentId, 'synthetic-source');
  assert.deepEqual(saved.files.contents[0].variants[0].card, summary);
  assert.deepEqual(saved.boards[0].cards[0], summary);
  assert.equal(projectWorkspaceFiles(saved.files, saved.boards).length, 1);
  assert.equal(syncWorkspaceFiles(saved.files, saved.boards), saved.files);
});

void test('explicit summary source links normalize to shared identities and survive save/reload', () => {
  const source = note('source-instance', { sharedId: 'canonical-source', kind: 'pdf', pdf });
  const summary = note('summary-instance', { sharedId: 'canonical-summary', contentRole: 'summary', sourceContentId: 'source-instance' });
  const saved = ensureWorkspaceFiles(snapshot([board('synthetic-board', [source, summary])]));
  const canonical = saved.files.contents.find(content => content.id === 'canonical-summary');
  assert.equal(canonical.card.contentRole, 'summary');
  assert.equal(canonical.card.sourceContentId, 'canonical-source');
  assert.equal(canonical.sourceContentId, 'canonical-source');
  assert.deepEqual(saved.boards[0].cards, [source, summary]);
  assert.equal(projectWorkspaceFiles(saved.files, saved.boards).filter(item => item.kind === 'notePage').length, 0);
  assert.equal(syncWorkspaceFiles(saved.files, saved.boards), saved.files);
  const restored = readWorkspace(JSON.stringify(saved));
  assert.equal(restored.files.contents.find(content => content.id === 'canonical-summary').sourceContentId, 'canonical-source');
});

test('nested folder moves reject self and descendants, persist navigation, and folder deletion moves files to root', () => {
  let files = syncWorkspaceFiles(undefined, [board('board', [])]);
  files = createWorkspaceFolder(files, 'Parent', null, 'parent');
  files = createWorkspaceFolder(files, 'Child', 'parent', 'child');
  files = createWorkspaceFolder(files, 'Grandchild', 'child', 'grandchild');
  assert.throws(() => moveWorkspaceFolder(files, 'parent', 'parent'));
  assert.throws(() => moveWorkspaceFolder(files, 'parent', 'grandchild'));
  files = moveWorkspaceEntry(files, boardEntryId('board'), 'grandchild');
  files = setWorkspaceEntryPinned(files, boardEntryId('board'), true, 100);
  files = markWorkspaceEntryOpened(files, boardEntryId('board'), 200);
  files.navigation = { selectedFolderId: 'grandchild', selectedEntryId: boardEntryId('board'), expandedFolderIds: ['parent', 'child', 'grandchild'], search: 'test', scrollTop: 300, previewOpen: true };
  const loaded = readWorkspace(JSON.stringify({ ...snapshot([board('board', [])]), files }));
  assert.deepEqual(loaded.files, files);
  const deleted = deleteWorkspaceFolder(files, 'parent');
  assert.deepEqual(deleted.folders, [{ id: 'child', title: 'Child', parentId: null }, { id: 'grandchild', title: 'Grandchild', parentId: 'child' }]);
  assert.equal(deleted.entries[0].folderId, 'grandchild');
  assert.equal(deleted.entries[0].pinnedAt, 100);
  assert.equal(deleted.entries[0].lastOpenedAt, 200);
  assert.equal(deleted.navigation.selectedFolderId, 'grandchild');
  assert.deepEqual(deleted.navigation.expandedFolderIds, ['child', 'grandchild']);
  assert.equal(validWorkspaceFiles(deleted), true);
});

test('new canvas knowledge inherits its archived board folder without moving existing canonical files', () => {
  const original = board('b', [note('old', { contentRole: 'notePage' })]);
  let files = syncWorkspaceFiles(undefined, [original]);
  files = createWorkspaceFolder(files, 'Project', null, 'project');
  files = moveWorkspaceEntry(files, boardEntryId('b'), 'project');
  const updated = { ...original, cards: [...original.cards, note('new', { contentRole: 'notePage' })] };
  const synced = syncWorkspaceFiles(files, [updated]);
  assert.equal(synced.entries.find(entry => entry.id === contentEntryId('old')).folderId, null);
  assert.equal(synced.entries.find(entry => entry.id === contentEntryId('new')).folderId, 'project');
});

test('standalone NotePage survives final canvas reference removal and edited fields sync without moving instances', () => {
  let files = syncWorkspaceFiles(undefined, []);
  files = addWorkspaceContent(files, note('standalone', { contentRole: 'notePage' }));
  const boards = [board('a', [note('instance-a', { sharedId: 'standalone', x: 99 })]), board('b', [note('instance-b', { sharedId: 'standalone', x: 999, width: 700 })])];
  files = syncWorkspaceFiles(files, boards);
  const patched = patchWorkspaceContent(files, boards, 'standalone', { body: 'Edited once', x: 0, width: 1 });
  assert.deepEqual(patched.boards.map(value => value.cards[0].body), ['Edited once', 'Edited once']);
  assert.deepEqual(patched.boards.map(value => value.cards[0].x), [99, 999]);
  assert.deepEqual(patched.boards.map(value => value.cards[0].width), [420, 700]);
  const noA = removeWorkspaceContentReference(patched.boards, 'a', 'instance-a');
  const removed = removeWorkspaceContentReference(noA, 'b', 'instance-b');
  const after = syncWorkspaceFiles(patched.files, removed);
  assert.equal(after.contents[0].card.body, 'Edited once');
  assert.equal(after.contents[0].variants.length, 0);
  assert.equal(projectWorkspaceFiles(after, removed).filter(item => item.kind === 'notePage').length, 1);
  const realDeleted = deleteWorkspaceContent(after, removed, 'standalone');
  assert.equal(realDeleted.files.contents.length, 0);
  assert.equal(realDeleted.files.entries.filter(entry => entry.kind === 'content').length, 0);
});

test('literature metadata edits survive shared sync, reload and complete backup restore with identity and navigation intact', async () => {
  const original = board('a', [note('source', { kind: 'pdf', sharedId: 'paper', pdf: { ...pdf, url: '/test-paper.pdf' }, authors: ['Original author'], year: 2020 })]);
  const reference = board('b', [{ ...original.cards[0], id: 'copy', x: 900 }]);
  let saved = ensureWorkspaceFiles(snapshot([original, reference]));
  saved.files = createWorkspaceFolder(saved.files, 'Reading', null, 'reading');
  saved.files = moveWorkspaceEntry(saved.files, contentEntryId('paper'), 'reading');
  saved.files = markWorkspaceEntryOpened(saved.files, contentEntryId('paper'), 123456);
  saved.files.navigation = { selectedFolderId: 'reading', selectedEntryId: contentEntryId('paper'), expandedFolderIds: ['reading'], search: 'Edited author 2025', scrollTop: 120, previewOpen: true };
  const edited = patchWorkspaceContent(saved.files, saved.boards, 'paper', { authors: ['Edited author'], year: 2025, tags: ['Methods', 'Review'] });
  saved = readWorkspace(JSON.stringify({ ...saved, ...edited }));
  assert.equal(saved.boards[1].cards[0].x, 900);
  for (const entry of saved.boards) {
    assert.deepEqual(entry.cards[0].authors, ['Edited author']);
    assert.equal(entry.cards[0].year, 2025);
  }
  const archive = await createWorkspaceBackup(saved, { getFile: async () => undefined, fetch: async () => new Response('test PDF', { headers: { 'content-type': 'application/pdf' } }) }, () => {});
  const restored = (await readWorkspaceBackup(archive, () => {})).snapshot;
  assert.deepEqual(restored.files.navigation, saved.files.navigation);
  assert.deepEqual(restored.files.entries, saved.files.entries);
  const paper = projectWorkspaceFiles(restored.files, restored.boards).find(item => item.id === contentEntryId('paper'));
  assert.deepEqual(paper.authors, ['Edited author']);
  assert.equal(paper.year, 2025);
  assert.deepEqual(paper.tags, ['Methods', 'Review']);
  assert.equal(paper.entry.folderId, 'reading');
  assert.equal(paper.lastOpenedAt, 123456);
});

test('true content deletion removes every reference and its incident edges, but leaves unrelated contents', () => {
  const a = board('a', [note('one', { sharedId: 'shared' }), note('other')]); a.edges = [{ id: 'edge', from: 'one', to: 'other' }];
  const b = board('b', [note('two', { sharedId: 'shared' })]);
  const files = syncWorkspaceFiles(undefined, [a, b]);
  const deleted = deleteWorkspaceContent(files, [a, b], 'shared');
  assert.deepEqual(deleted.boards[0].cards.map(card => card.id), ['other']);
  assert.deepEqual(deleted.boards[0].edges, []);
  assert.deepEqual(deleted.boards[1].cards, []);
  assert.deepEqual(deleted.files.contents.map(content => content.id), ['other']);
});

test('true source deletion does not resurrect a literature entry from a surviving summary', () => {
  const source = note('source', { kind: 'pdf', pdf });
  const summary = note('summary', { pdfExcerpt: { sourceId: 'source', sourceTitle: 'Study', pdf, mark } });
  const boards = [board('b', [source, summary])];
  const removed = deleteWorkspaceContent(syncWorkspaceFiles(undefined, boards), boards, 'source');
  const synced = syncWorkspaceFiles(removed.files, removed.boards);
  assert.deepEqual(synced.contents.map(content => content.id), ['summary']);
  assert.equal(synced.contents[0].sourceContentId, 'source');
  assert.equal(projectWorkspaceFiles(synced, removed.boards).filter(item => item.kind === 'literature').length, 0);
  assert.equal(validWorkspaceFiles(synced), true);
});

test('true deletion across active and recycled boards cannot resurrect content when a board is restored', () => {
  const active = board('active', [note('active-instance', { sharedId: 'shared', contentRole: 'notePage' }), note('kept')]);
  const recycled = board('recycled', [note('recycled-instance', { sharedId: 'shared', contentRole: 'notePage' }), note('trash-kept')]);
  recycled.edges = [{ id: 'trash-edge', from: 'recycled-instance', to: 'trash-kept' }];
  const before = structuredClone(recycled);
  const files = syncWorkspaceFiles(undefined, [active]);
  const result = deleteWorkspaceContent(files, [active, recycled], 'shared');
  const nextActive = result.boards[0], nextRecycled = result.boards[1];
  assert.deepEqual(recycled, before);
  assert.deepEqual(nextRecycled.cards.map(card => card.id), ['trash-kept']);
  assert.deepEqual(nextRecycled.edges, []);
  const saved = readWorkspace(JSON.stringify({ ...snapshot([nextActive]), deletedBoards: [recycleBoard(nextRecycled)], files: result.files }));
  assert.equal(saved.files.contents.some(content => content.id === 'shared'), false);
  const restored = syncWorkspaceFiles(saved.files, [...saved.boards, saved.deletedBoards[0].board]);
  assert.equal(restored.contents.some(content => content.id === 'shared'), false);
  assert.deepEqual(restored.deletedContentIds, ['shared']);
});

test('removing a selected board entry clears obsolete selection without breaking saved navigation', () => {
  const boards = [board('b', [])];
  const files = syncWorkspaceFiles(undefined, boards);
  files.navigation = { selectedEntryId: boardEntryId('b'), expandedFolderIds: [] };
  const synced = syncWorkspaceFiles(files, []);
  assert.equal(synced.navigation.selectedEntryId, undefined);
  assert.equal(validWorkspaceFiles(synced), true);
});

test('backup restore remaps standalone IDs, nested folder parents, shared references and summary provenance together', () => {
  const source = note('source-instance', { sharedId: 'source', kind: 'pdf', pdf });
  const excerpt = note('summary-instance', { sharedId: 'summary', contentRole: 'summary', sourceContentId: 'source', pdfExcerpt: { sourceId: 'source-instance', sourceTitle: 'Study', pdf, mark } });
  const a = board('a', [source, excerpt]); const b = board('b', [note('summary-copy', { ...excerpt, id: 'summary-copy', x: 999 })]);
  let backup = ensureWorkspaceFiles(snapshot([a, b]));
  backup.files = addWorkspaceContent(backup.files, note('standalone', { contentRole: 'notePage' }));
  backup.files = createWorkspaceFolder(backup.files, 'Parent', null, 'parent');
  backup.files = createWorkspaceFolder(backup.files, 'Child', 'parent', 'child');
  backup.files = moveWorkspaceEntry(backup.files, contentEntryId('standalone'), 'child');
  backup.files.navigation = { expandedFolderIds: ['parent', 'child'] };
  const current = ensureWorkspaceFiles(snapshot([board('existing', [note('kept')])]));
  const remap = new Map(), restored = mergeRestoredWorkspace(current, backup, remap);
  assert.deepEqual(restored.boards[0], current.boards[0]);
  assert.equal(restored.boards[1].cards[1].sharedId, restored.boards[2].cards[0].sharedId);
  const summary = restored.files.contents.find(content => content.id === remap.get('summary'));
  assert.equal(summary.sourceContentId, remap.get('source'));
  assert.equal(summary.card.sourceContentId, remap.get('source'));
  assert.equal(summary.card.pdfExcerpt.sourceId, remap.get('source-instance'));
  assert.equal(summary.variants[0].boardId, remap.get('a'));
  const parent = restored.files.folders.find(folder => folder.title === 'Parent'), child = restored.files.folders.find(folder => folder.title === 'Child');
  assert.equal(child.parentId, parent.id);
  assert.equal(restored.files.entries.find(entry => entry.contentId === remap.get('standalone')).folderId, child.id);
  assert.equal(restored.files.navigation.expandedFolderIds.includes(child.id), true);
  assert.equal(validWorkspaceFiles(restored.files), true);
});

test('standalone registry attachments stay active without a hidden hosting board', () => {
  const files = addWorkspaceContent(syncWorkspaceFiles(undefined, []), note('page', { contentRole: 'notePage', blocks: [{ id: 'image', type: 'image', props: { url: 'lumior-file:only-file' } }] }));
  const saved = { ...snapshot([]), files };
  const usage = managedFiles([{ id: 'only-file', name: 'image.png', type: 'image/png', size: 100, createdAt: 0 }], { snapshot: saved, history: [] }, 9_000_000);
  assert.equal(usage[0].usage, 'active');
  assert.equal(saved.boards.length, 0);
  assert.equal(usage[0].locations[0].cardId, 'page');
});

test('complete backup includes standalone NotePage attachments without any canvas', async () => {
  const id = '11111111-1111-4111-8111-111111111111', blob = new Blob(['standalone image'], { type: 'image/png' });
  const files = addWorkspaceContent(syncWorkspaceFiles(undefined, []), note('page', { contentRole: 'notePage', blocks: [{ id: 'image', type: 'image', props: { url: `lumior-file:${id}` } }] }));
  const saved = { ...snapshot([]), files };
  const archive = await createWorkspaceBackup(saved, { getFile: async key => key === id ? { id, name: 'standalone.png', type: 'image/png', size: blob.size, blob } : undefined, fetch: async () => { throw new Error('Unexpected fetch'); } }, () => {});
  const prepared = await readWorkspaceBackup(archive, () => {});
  assert.equal(prepared.snapshot.boards.length, 0);
  assert.equal(prepared.snapshot.files.contents[0].card.blocks[0].props.url, `lumior-file:${id}`);
  assert.equal(await prepared.files[0].blob.text(), 'standalone image');
});

test('100 literature entries count once across boards; summaries never add list rows', () => {
  const papers = Array.from({ length: 100 }, (_, index) => note(`paper-${index}`, { kind: 'pdf', pdf, authors: [`Author ${index}`], year: 2020 + index % 6 }));
  const summaries = papers.map((paper, index) => note(`summary-${index}`, { contentRole: 'summary', sourceContentId: paper.id }));
  const boards = [board('collection', [...papers, ...summaries]), board('references', papers.map(paper => ({ ...paper, sharedId: paper.id, id: paper.id + '-copy' })))];
  const files = syncWorkspaceFiles(undefined, boards);
  const items = projectWorkspaceFiles(files, boards);
  assert.equal(items.filter(item => item.kind === 'literature').length, 100);
  assert.equal(items.length, 102);
  assert.equal(files.contents.filter(content => content.role === 'summary').length, 100);
  assert.equal(syncWorkspaceFiles(files, boards), files);
});

test('invalid files are rejected rather than silently dropped on load', () => {
  const files = syncWorkspaceFiles(undefined, []);
  for (const invalid of [{ ...files, version: 2 }, { ...files, folders: [{ id: 'self', title: 'Self', parentId: 'self' }] }, { ...files, contents: [{ id: 'broken', role: 'notePage', card: {} }] }]) {
    assert.equal(validWorkspaceFiles(invalid), false);
    assert.equal(readWorkspace(JSON.stringify({ ...snapshot([]), files: invalid })), null);
  }
});
