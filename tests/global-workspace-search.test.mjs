import test from 'node:test';
import assert from 'node:assert/strict';
import { createGlobalWorkspaceSearchIndex } from '../app/global-workspace-search-model.ts';
import { searchGlobalCardIndex } from '../app/global-card-search-model.ts';

const card = (id, patch = {}) => ({ id, title: id, body: '', kind: 'note', x: 0, y: 0, width: 300, ...patch });
const board = (id, cards = [], title = id) => ({ id, title, cards, edges: [] });
const files = patch => ({ version: 1, contents: [], entries: [], folders: [], ...patch });
const search = (boards, registry, query) => searchGlobalCardIndex(createGlobalWorkspaceSearchIndex(boards, registry), query);

test('all-content search finds board names, folders and standalone imported files without changing scope', () => {
  const registry = files({
    folders: [{ id: 'research', title: 'Research', parentId: null }, { id: 'papers', title: 'Papers', parentId: 'research' }],
    contents: [{ id: 'pdf', role: 'literature', authors: ['Ada Lovelace'], year: 2026, card: card('pdf', { kind: 'pdf', title: 'Imported evidence', body: 'Interview design' }) }],
    entries: [{ id: 'content:pdf', kind: 'content', contentId: 'pdf', folderId: 'papers' }, { id: 'board:mba', kind: 'board', boardId: 'mba', folderId: null }],
    navigation: { selectedFolderId: 'research', expandedFolderIds: ['papers'], search: 'existing query', scrollTop: 125 },
  });
  const before = structuredClone(registry), boards = [board('mba', [], 'MBA decisions')];
  assert.equal(search(boards, registry, 'MBA').results[0].entryId, 'board:mba');
  assert.equal(search(boards, registry, 'Papers').results[0].folderId, 'papers');
  const imported = search(boards, registry, 'Ada 2026');
  assert.equal(imported.results[0].entryId, 'content:pdf');
  assert.equal(imported.results[0].location, 'Research / Papers');
  assert.equal(search(boards, registry, 'interview').results[0].card.id, 'pdf');
  assert.deepEqual(registry, before);
});

test('shared content appears once, while unregistered cards retain a location and nested blocks are searchable', () => {
  const shared = card('canonical', { title: 'Shared note', blocks: [{ type: 'heading', content: 'Method', children: [{ type: 'paragraph', content: 'Deep evidence' }] }], body: 'obsolete' });
  const registry = files({ contents: [{ id: 'canonical', role: 'note', card: shared }] });
  const boards = [board('a', [card('copy-a', { sharedId: 'canonical', body: 'Shared note' }), card('legacy', { body: 'Legacy evidence' })]), board('b', [card('copy-b', { sharedId: 'canonical', body: 'Shared note' })])];
  assert.equal(search(boards, registry, 'Shared note').total, 1);
  assert.equal(search(boards, registry, 'Deep').results[0].entryId, 'content:canonical');
  assert.equal(search(boards, registry, 'obsolete').total, 0);
  const legacy = search(boards, registry, 'Legacy evidence').results[0];
  assert.equal(legacy.kind, 'card');
  assert.equal(legacy.boardId, 'a');
  assert.equal(legacy.card.id, 'legacy');
});

test('recycled and tombstoned content stays excluded even if a stale board reference remains', () => {
  const registry = files({ deletedContentIds: ['deleted'], recycledContents: [{ content: { id: 'recycled' } }],
    contents: [{ id: 'keep', role: 'notePage', card: card('keep', { body: 'visible evidence' }) }] });
  const boards = [board('normal', [card('deleted', { body: 'secret evidence' }), card('recycled', { body: 'secret evidence' })])];
  assert.equal(search(boards, registry, 'secret').total, 0);
  assert.equal(search(boards, registry, 'visible').results[0].entryId, 'content:keep');
});

test('PDF and video search stays local and bounded', () => {
  const contents = Array.from({ length: 75 }, (_, i) => ({ id: `pdf-${i}`, role: 'literature', card: card(`pdf-${i}`, { kind: 'pdf', title: `Report ${i}`, pdf: { name: 'report.pdf', url: 'lumior-file:document', translation: { text: 'unloaded phrase' } } }) }));
  const registry = files({ contents });
  const results = search([], registry, 'Report');
  assert.equal(results.total, 75);
  assert.equal(results.results.length, 60);
  assert.equal(search([], registry, 'unloaded phrase').total, 0);
});
