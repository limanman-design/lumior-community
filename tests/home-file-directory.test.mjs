import assert from 'node:assert/strict';
import test from 'node:test';
import { directoryBreadcrumbs, directoryFolderIds, homeFileSortFromNavigation, projectHomeDirectoryRows } from '../app/home-file-directory-model.ts';

const folders = [
  { id: 'research', title: 'Research', parentId: null },
  { id: 'reading', title: 'Reading', parentId: 'research' },
  { id: 'methods', title: 'Methods', parentId: 'reading' },
  { id: 'empty', title: 'Empty', parentId: 'research' },
  { id: 'archive', title: 'Archive', parentId: null },
  { id: 'other-reading', title: 'Reading', parentId: 'archive' },
];
const items = [
  { id: 'a', title: 'Zulu', kind: 'notePage', folderId: 'research', lastOpenedAt: 5 },
  { id: 'b', title: 'Alpha', kind: 'literature', folderId: 'research', authors: ['研究者'], year: 2024, lastOpenedAt: 2 },
  { id: 'c', title: 'Deep methods', kind: 'literature', folderId: 'methods', tags: ['Causal'], lastOpenedAt: 8 },
  { id: 'd', title: 'Outside', kind: 'image', folderId: 'other-reading' },
  { id: 'summary', title: 'Deep methods', kind: 'summary', folderId: 'methods' },
];
const project = patch => projectHomeDirectoryRows({ items, folders, currentFolderId: 'research', expandedFolderIds: [], query: '', sort: { key: 'title', direction: 'asc' }, locale: 'en', ...patch });

test('Home defaults to newest modifications and retains an explicit sort preference', () => {
  assert.deepEqual(homeFileSortFromNavigation(), { key: 'updatedAt', direction: 'desc' });
  for (const key of ['updatedAt', 'lastOpenedAt', 'title', 'type'])
    for (const direction of ['asc', 'desc'])
      assert.deepEqual(homeFileSortFromNavigation(`${key}:${direction}`), { key, direction });
});

test('an unopened import sorts ahead of previously opened files, in root and nested directories', () => {
  const files = [
    { id: 'opened', title: 'Previously opened', kind: 'literature', folderId: 'reading', updatedAt: 1000, lastOpenedAt: 5000 },
    { id: 'imported', title: 'Unopened import', kind: 'literature', folderId: 'reading', updatedAt: 6000 },
    { id: 'unknown', title: 'Unknown date', kind: 'notePage', folderId: 'reading' },
  ];
  for (const direction of ['asc', 'desc']) {
    const rows = project({ items: files, expandedFolderIds: ['reading'], sort: { key: 'updatedAt', direction } });
    assert.deepEqual(rows.filter(row => row.kind === 'file').map(row => row.id), direction === 'desc' ? ['imported', 'opened', 'unknown'] : ['opened', 'imported', 'unknown']);
  }
});

test('collapsed directories show folders then direct five-type files, excluding summaries and other scopes', () => {
  const rows = project();
  assert.deepEqual(rows.map(row => row.id), ['folder:empty', 'folder:reading', 'b', 'a']);
  assert.equal(rows.find(row => row.id === 'folder:empty').hasChildren, false);
  assert.equal(rows.find(row => row.id === 'folder:reading').itemCount, 1);
  assert.equal(rows.find(row => row.id === 'folder:reading').expanded, false);
});

test('true multi-level expansion keeps every sibling group sorted without flattening hierarchy', () => {
  const rows = project({ expandedFolderIds: ['reading', 'methods'], sort: { key: 'lastOpenedAt', direction: 'desc' } });
  assert.deepEqual(rows.map(row => [row.id, row.depth]), [['folder:empty', 0], ['folder:reading', 0], ['folder:methods', 1], ['c', 2], ['a', 0], ['b', 0]]);
  assert.equal(rows.find(row => row.id === 'c').parentId, 'methods');
});

test('directory search covers collapsed descendants and temporarily reveals only matching paths', () => {
  const expanded = [];
  const rows = project({ query: 'ＣＡＵＳＡＬ', expandedFolderIds: expanded });
  assert.deepEqual(rows.map(row => row.id), ['folder:reading', 'folder:methods', 'c']);
  assert.ok(rows.filter(row => row.kind === 'folder').every(row => row.expanded));
  assert.deepEqual(expanded, []);
  assert.deepEqual(project({ query: '研究者 2024' }).map(row => row.id), ['b']);
  assert.deepEqual(project({ query: 'Outside' }), []);
  assert.deepEqual(project({ query: 'Reading' }).map(row => row.id), ['folder:reading', 'folder:methods', 'c']);
});

test('paths and scoped sets distinguish identically named folders by stable identity', () => {
  assert.deepEqual(directoryBreadcrumbs(folders, 'methods').map(folder => folder.title), ['Research', 'Reading', 'Methods']);
  assert.deepEqual(directoryBreadcrumbs(folders, 'other-reading').map(folder => folder.title), ['Archive', 'Reading']);
  assert.deepEqual([...directoryFolderIds(folders, 'research')], ['research', 'reading', 'methods', 'empty']);
});

test('100 documents remain unique, unknown dates stay last, and input data is immutable', () => {
  const papers = Array.from({ length: 100 }, (_, index) => ({ id: `p${index}`, title: `Paper ${index}`, kind: 'literature', folderId: 'methods', lastOpenedAt: index < 99 ? index : undefined }));
  const before = structuredClone(papers);
  const rows = project({ items: [...papers, papers[0], ...items.filter(item => item.kind === 'summary')], expandedFolderIds: ['reading', 'methods'], sort: { key: 'lastOpenedAt', direction: 'desc' } });
  const files = rows.filter(row => row.kind === 'file');
  assert.equal(files.length, 100);
  assert.equal(files.at(-1).id, 'p99');
  assert.equal(rows.find(row => row.id === 'folder:reading').itemCount, 100);
  assert.deepEqual(papers, before);
});

test('malformed cycles cannot make ancestry or projection recurse forever', () => {
  const cycle = [{ id: 'a', title: 'A', parentId: 'b' }, { id: 'b', title: 'B', parentId: 'a' }];
  assert.equal(directoryBreadcrumbs(cycle, 'a').length, 2);
  assert.equal(directoryFolderIds(cycle, 'a').size, 2);
  assert.equal(project({ folders: cycle, currentFolderId: 'a', items: [], expandedFolderIds: ['a', 'b'] }).length, 1);
});
