import assert from 'node:assert/strict';
import test from 'node:test';
import { navigateWorkspaceFileScope, patchWorkspaceFileNavigation, validWorkspaceFileNavigation } from '../app/workspace-file-navigation.ts';
import { addWorkspaceContent, createWorkspaceFolder, deleteWorkspaceContent, deleteWorkspaceFolder, ensureWorkspaceFiles, moveWorkspaceEntry, moveWorkspaceFolder, validWorkspaceFiles } from '../app/workspace-files.ts';
import { createWorkspaceBackup, mergeRestoredWorkspace, readWorkspaceBackup } from '../app/workspace-backup.ts';
import { readWorkspace } from '../app/workspace-store.ts';

const state = patch => ({ expandedFolderIds: [], ...patch });
const snapshot = () => ({ version: 1, boards: [], deletedBoards: [], activeId: '', nextUntitledIndex: 1 });
const note = id => ({ id, kind: 'note', title: id, body: 'Preserved shared body', contentRole: 'notePage', x: 0, y: 0, width: 360 });
const fixture = () => {
  let files = ensureWorkspaceFiles(snapshot()).files;
  files = createWorkspaceFolder(files, 'Research', null, 'research');
  files = createWorkspaceFolder(files, 'Reading', 'research', 'reading');
  files = createWorkspaceFolder(files, 'Archive', null, 'archive');
  return addWorkspaceContent(files, note('note'), 'reading', 'notePage');
};

test('legacy active state is adopted only by its scope and each scope restores independently', () => {
  const legacy = state({ selectedFolderId: 'reading', search: '中文', sort: 'title:asc', selectedEntryId: 'content:note', scrollTop: 320, previewOpen: true, typeFilter: 'literature', expandedFolderIds: ['reading'] });
  const original = structuredClone(legacy);
  let nav = navigateWorkspaceFileScope(legacy, null);
  assert.equal(nav.search, undefined);
  assert.equal(nav.scrollTop, undefined);
  nav = patchWorkspaceFileNavigation(nav, { search: 'home', scrollTop: 80, previewOpen: false });
  nav = navigateWorkspaceFileScope(nav, 'archive');
  nav = patchWorkspaceFileNavigation(nav, { search: 'archive', selectedFolderRowId: undefined, scrollTop: 15 });
  nav = navigateWorkspaceFileScope(nav, 'reading');
  for (const key of ['search', 'sort', 'selectedEntryId', 'scrollTop', 'previewOpen', 'typeFilter']) assert.equal(nav[key], legacy[key]);
  assert.deepEqual(nav.expandedFolderIds, ['reading']);
  assert.equal(navigateWorkspaceFileScope(nav, 'reading'), nav);
  nav = navigateWorkspaceFileScope(nav, null);
  assert.equal(nav.search, 'home');
  assert.equal(nav.scrollTop, 80);
  assert.equal(navigateWorkspaceFileScope(nav, 'archive').search, 'archive');
  assert.deepEqual(legacy, original);
});

test('folder row IDs remain separate and malformed scope state is rejected', () => {
  const folders = new Set(['research', 'reading']), entries = new Set(['content:note']);
  const valid = patchWorkspaceFileNavigation(state({ selectedFolderId: 'research' }), { selectedFolderRowId: 'reading', search: 'x', scrollTop: 10 });
  assert.equal(validWorkspaceFileNavigation(valid, folders, entries), true);
  for (const patch of [
    { selectedEntryId: 'folder:reading' }, { selectedFolderRowId: 'missing' },
    { scrollTop: -1 }, { scrollTop: NaN }, { scopes: 'invalid' },
    { scopes: [{ folderId: 'missing', expandedFolderIds: [] }] },
    { scopes: [{ folderId: 'research', expandedFolderIds: [] }, { folderId: 'research', expandedFolderIds: [] }] },
  ]) assert.equal(validWorkspaceFileNavigation({ ...valid, ...patch }, folders, entries), false);
});

test('moving a file out of a directory clears only that scope selection, retaining Home and content', () => {
  let files = fixture();
  files.navigation = patchWorkspaceFileNavigation(undefined, { selectedEntryId: 'content:note', scrollTop: 45, previewOpen: true });
  files.navigation = navigateWorkspaceFileScope(files.navigation, 'research');
  files.navigation = patchWorkspaceFileNavigation(files.navigation, { selectedEntryId: 'content:note', previewOpen: true, scrollTop: 75 });
  const before = structuredClone(files.contents);
  files = moveWorkspaceEntry(files, 'content:note', 'archive');
  assert.equal(files.navigation.selectedEntryId, undefined);
  assert.equal(files.navigation.previewOpen, false);
  assert.equal(files.navigation.scrollTop, 75);
  assert.equal(navigateWorkspaceFileScope(files.navigation, null).selectedEntryId, 'content:note');
  assert.deepEqual(files.contents, before);
  assert.equal(validWorkspaceFiles(files), true);
});

test('folder moves preserve nested scope state but clear selection outside the old ancestor', () => {
  let files = fixture();
  files.navigation = patchWorkspaceFileNavigation(state({ selectedFolderId: 'reading' }), { search: 'nested', selectedEntryId: 'content:note', scrollTop: 90 });
  files.navigation = navigateWorkspaceFileScope(files.navigation, 'research');
  files.navigation = patchWorkspaceFileNavigation(files.navigation, { selectedFolderRowId: 'reading', previewOpen: true });
  assert.throws(() => moveWorkspaceFolder(files, 'research', 'reading'));
  files = moveWorkspaceFolder(files, 'reading', 'archive');
  assert.equal(files.navigation.selectedFolderRowId, undefined);
  assert.equal(navigateWorkspaceFileScope(files.navigation, 'reading').search, 'nested');
  assert.equal(navigateWorkspaceFileScope(files.navigation, 'reading').scrollTop, 90);
  assert.equal(files.entries.find(entry => entry.id === 'content:note').folderId, 'reading');
});

test('deleting the active folder restores Home state without deleting content or child folders', () => {
  let files = fixture();
  files.navigation = patchWorkspaceFileNavigation(undefined, { search: 'home', selectedEntryId: 'content:note', scrollTop: 44 });
  files.navigation = navigateWorkspaceFileScope(files.navigation, 'research');
  files.navigation = patchWorkspaceFileNavigation(files.navigation, { search: 'local', expandedFolderIds: ['reading'], selectedEntryId: 'content:note' });
  files = deleteWorkspaceFolder(files, 'research');
  assert.equal(files.contents.length, 1);
  assert.equal(files.entries[0].folderId, 'reading');
  assert.equal(files.folders.find(folder => folder.id === 'reading').parentId, null);
  assert.equal(files.navigation.selectedFolderId, null);
  assert.equal(files.navigation.search, 'home');
  assert.equal(files.navigation.scrollTop, 44);
  assert.deepEqual(files.navigation.scopes.map(scope => scope.folderId), [null]);
  assert.equal(validWorkspaceFiles(files), true);
});

test('true content deletion clears selections in all saved scopes without corrupting other settings', () => {
  let files = fixture();
  files.navigation = patchWorkspaceFileNavigation(undefined, { selectedEntryId: 'content:note', search: 'home', scrollTop: 12 });
  files.navigation = navigateWorkspaceFileScope(files.navigation, 'reading');
  files.navigation = patchWorkspaceFileNavigation(files.navigation, { selectedEntryId: 'content:note', search: 'reading', previewOpen: true });
  files = deleteWorkspaceContent(files, [], 'note').files;
  assert.equal(files.navigation.selectedEntryId, undefined);
  assert.equal(files.navigation.scopes.some(scope => scope.selectedEntryId === 'content:note'), false);
  assert.equal(navigateWorkspaceFileScope(files.navigation, null).search, 'home');
  assert.equal(validWorkspaceFiles(files), true);
});

test('full backup and merge remap each scope and selection while retaining current Home state', async () => {
  const saved = { ...snapshot(), files: fixture() };
  saved.files.navigation = patchWorkspaceFileNavigation(state({ selectedFolderId: 'research' }), { selectedFolderRowId: 'reading', search: 'project', expandedFolderIds: ['reading'], scrollTop: 150, previewOpen: true });
  saved.files.navigation = navigateWorkspaceFileScope(saved.files.navigation, 'reading');
  saved.files.navigation = patchWorkspaceFileNavigation(saved.files.navigation, { selectedEntryId: 'content:note', search: 'inside', scrollTop: 220 });
  const backup = await createWorkspaceBackup(saved, { getFile: async () => undefined, fetch: async () => { throw new Error('No files expected'); } }, () => {});
  const restored = await readWorkspaceBackup(backup, () => {});
  assert.deepEqual(restored.snapshot.files.navigation, JSON.parse(JSON.stringify(saved.files.navigation)));
  const current = ensureWorkspaceFiles(snapshot());
  current.files.navigation = patchWorkspaceFileNavigation(undefined, { search: 'keep Home', scrollTop: 71 });
  const remap = new Map();
  const merged = mergeRestoredWorkspace(current, restored.snapshot, remap);
  const importedResearch = merged.files.folders.find(folder => folder.title === 'Research');
  const importedReading = merged.files.folders.find(folder => folder.title === 'Reading');
  assert.notEqual(importedReading.id, 'reading');
  assert.equal(merged.files.navigation.search, 'keep Home');
  const research = navigateWorkspaceFileScope(merged.files.navigation, importedResearch.id);
  assert.equal(research.selectedFolderRowId, importedReading.id);
  assert.equal(research.scrollTop, 150);
  assert.deepEqual(research.expandedFolderIds, [importedReading.id]);
  const reading = navigateWorkspaceFileScope(research, importedReading.id);
  assert.equal(reading.search, 'inside');
  assert.equal(reading.selectedEntryId, `content:${remap.get('note')}`);
  assert.equal(reading.scrollTop, 220);
  assert.equal(validWorkspaceFiles(merged.files), true);
  assert.ok(readWorkspace(JSON.stringify(merged)));
});
