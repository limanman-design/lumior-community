import test from 'node:test';
import assert from 'node:assert/strict';
import { readStoredDocument, saveStoredDocument, flushStoredDocuments, registerStoredDocumentCards } from '../app/stored-document.ts';
import { validStoredDocument, validObsidianSource } from '../app/stored-document-schema.ts';
import { serializeWorkspace } from '../app/workspace-assets.ts';

const note = (label = crypto.randomUUID()) => ({ id: label, title: 'Note', kind: 'note', body: '', x: 0, y: 0, width: 360,
  obsidianSource: { libraryId: label, path: 'Note.md' }, storedDocument: { version: 1, libraryId: label, path: 'Note.md', source: `lumior-file:${label}-source` } });
function memory(card, text = '# Heading\n\n[[Later]]') {
  const records = new Map(), reads = [], parsed = [];
  const sourceId = card.storedDocument.source.slice('lumior-file:'.length);
  const blob = new Blob([text], { type: 'text/markdown' });
  records.set(sourceId, { id: sourceId, name: 'Note.md', blob, size: blob.size, type: blob.type });
  return { records, reads, parsed, dependencies: {
    getFile: async id => { reads.push(id); return records.get(id); },
    putFile: async file => { records.set(file.id, file); },
    parseMarkdown: markdown => { parsed.push(markdown); return [{ type: 'paragraph', content: markdown }]; },
  } };
}
const patch = text => ({ blocks: [{ type: 'paragraph', content: text }], body: text });

void test('legacy notes keep their exact object without reading or migrating files', async () => {
  const card = { ...note(), storedDocument: undefined, blocks: [{ type: 'paragraph', content: 'Old note' }], body: 'Old note' };
  const loaded = await readStoredDocument(card, { getFile: () => assert.fail('legacy file read'), parseMarkdown: () => assert.fail('legacy parse') });
  assert.equal(loaded, card);
});

void test('opening one lazy note reads only its original and resolves links to unopened notes', async () => {
  const card = note(), fixture = memory(card), target = { ...note(), id: 'later-target', obsidianSource: { libraryId: card.storedDocument.libraryId, path: 'Later.md' } };
  registerStoredDocumentCards([card, target]);
  assert.equal(fixture.reads.length, 0);
  const loaded = await readStoredDocument(card, fixture.dependencies);
  assert.match(fixture.parsed[0], /lumior-content=later-target/);
  assert.ok(fixture.reads.every(id => id === card.storedDocument.source.slice(12)));
  assert.equal(loaded.blocks.at(-1).type, 'file');
  assert.equal(serializeWorkspace(loaded.blocks.at(-1).props.url), card.storedDocument.source);
  assert.equal(card.body, '');
  assert.equal(card.blocks, undefined);
});

void test('saved edits write one immutable document before committing metadata and reload without parsing source', async () => {
  const card = note(), fixture = memory(card), events = [];
  registerStoredDocumentCards([card]);
  const next = await saveStoredDocument(card, patch('Edited text'), { ...fixture.dependencies,
    putFile: async file => { events.push('file'); await fixture.dependencies.putFile(file); },
    commit: metadata => { events.push('metadata'); assert.ok(fixture.records.has(metadata.storedDocument.document.slice(12))); },
  });
  assert.deepEqual(events, ['file', 'metadata']);
  assert.equal(next.body, ''); assert.equal(next.blocks, undefined);
  assert.equal(next.storedDocument.source, card.storedDocument.source);
  const loaded = await readStoredDocument({ ...card, ...next }, { ...fixture.dependencies, parseMarkdown: () => assert.fail('edited documents must not reparse original') });
  assert.equal(loaded.body, 'Edited text');
  assert.equal(loaded.blocks[0].content, 'Edited text');
  assert.equal(await fixture.records.get(card.storedDocument.source.slice(12)).blob.text(), '# Heading\n\n[[Later]]');
  await flushStoredDocuments();
});

void test('independent copies cannot take over original vault paths or change other notes links', async () => {
  const card = note(), fixture = memory(card), target = { ...note(), id: 'original-target', obsidianSource: { libraryId: card.storedDocument.libraryId, path: 'Later.md' } };
  const independent = { ...target, id: 'independent-copy', obsidianSource: undefined };
  const legacyCopy = { ...target, id: 'older-duplicate' };
  registerStoredDocumentCards([card, target, independent, legacyCopy]);
  await readStoredDocument(card, fixture.dependencies);
  assert.match(fixture.parsed[0], /lumior-content=original-target/);
  assert.doesNotMatch(fixture.parsed[0], /independent-copy|older-duplicate/);
});

void test('rapid writes from one editor remain ordered while a stale second editor cannot overwrite them', async () => {
  const card = note(), fixture = memory(card), writer = {}, commits = [];
  registerStoredDocumentCards([card]);
  const dependencies = { ...fixture.dependencies, writer, commit: next => commits.push(next) };
  const [first, last] = await Promise.all([saveStoredDocument(card, patch('First'), dependencies), saveStoredDocument(card, patch('Last'), dependencies)]);
  assert.equal(first.storedDocument.document, last.storedDocument.document, 'rapid keystrokes share one final immutable snapshot');
  assert.equal((await readStoredDocument({ ...card, ...last }, fixture.dependencies)).body, 'Last');
  await assert.rejects(saveStoredDocument(card, patch('Stale editor'), { ...fixture.dependencies, writer: {} }), /another view|另一视图/);
  await assert.rejects(flushStoredDocuments());
  await saveStoredDocument({ ...card, ...last }, patch('Recovered current version'), { ...fixture.dependencies, writer: {} });
  await flushStoredDocuments();
  assert.equal(commits.length, 1);
});

void test('failed writes retain their draft and prevent flush until the same note is successfully saved', async () => {
  const card = note(), fixture = memory(card);
  registerStoredDocumentCards([card]);
  let committed = false;
  await assert.rejects(saveStoredDocument(card, patch('Unsaved text'), { ...fixture.dependencies, putFile: async () => { throw new Error('disk full'); }, commit: () => { committed = true; } }), /disk full/);
  assert.equal(committed, false);
  assert.equal((await readStoredDocument(card, fixture.dependencies)).body, 'Unsaved text');
  await assert.rejects(flushStoredDocuments(), /disk full/);
  await saveStoredDocument(card, patch('Unsaved text'), fixture.dependencies);
  await flushStoredDocuments();
});

void test('flush waits for metadata commits, and edited attachment references remain protected', async () => {
  const card = note(), fixture = memory(card);
  registerStoredDocumentCards([card]);
  let release, commitStarted;
  const started = new Promise(resolve => { commitStarted = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const saving = saveStoredDocument(card, { blocks: [{ type: 'image', props: { url: 'lumior-file:new-picture' } }], body: '' }, { ...fixture.dependencies, commit: async () => { commitStarted(); await gate; } });
  await started;
  let flushed = false;
  const pending = flushStoredDocuments().then(() => { flushed = true; });
  await Promise.resolve(); assert.equal(flushed, false);
  release();
  const result = await saving; await pending;
  assert.deepEqual(result.storedDocument.references, ['lumior-file:new-picture']);
});

void test('explicit flush forces a queued typing batch without waiting for debounce and stores only its final text', async () => {
  const card = note(), fixture = memory(card), writer = {}, commits = [];
  registerStoredDocumentCards([card]);
  const pending = Array.from({ length: 100 }, (_, index) => saveStoredDocument(card, patch(`Text ${index}`), { ...fixture.dependencies, writer, commit: next => commits.push(next) }));
  assert.equal(fixture.records.size, 1);
  await flushStoredDocuments();
  const results = await Promise.all(pending);
  assert.equal(fixture.records.size, 2, 'one source and one final edit, not 100 snapshots');
  assert.equal(commits.length, 1);
  assert.equal(new Set(results.map(result => result.storedDocument.document)).size, 1);
  assert.equal((await readStoredDocument({ ...card, ...results.at(-1) }, fixture.dependencies)).body, 'Text 99');
});

void test('missing or corrupt documents and cancelled loads cannot turn into empty editable notes', async () => {
  const card = note(), fixture = memory(card);
  registerStoredDocumentCards([card]);
  await assert.rejects(readStoredDocument(card, { ...fixture.dependencies, getFile: async () => undefined }), /missing|缺失/);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(readStoredDocument(card, { ...fixture.dependencies, signal: abort.signal }), { name: 'AbortError' });
  const corrupt = { ...card, storedDocument: { ...card.storedDocument, document: card.storedDocument.source } };
  await assert.rejects(readStoredDocument(corrupt, fixture.dependencies), /cannot be read|无法读取/);
  await assert.rejects(saveStoredDocument(card, { body: '' }, fixture.dependencies), /finish loading|加载完成/);
});

void test('stored note metadata rejects unsafe file paths and nonlocal body references', () => {
  const card = note();
  assert.equal(validStoredDocument(card.storedDocument), true);
  assert.equal(validObsidianSource(card.obsidianSource), true);
  for (const path of ['../outside.md', '/absolute.md', 'C:/note.md', 'a\\note.md', 'a/./note.md']) assert.equal(validStoredDocument({ ...card.storedDocument, path }), false);
  assert.equal(validStoredDocument({ ...card.storedDocument, source: 'https://example.com/note' }), false);
  assert.equal(validStoredDocument({ ...card.storedDocument, references: ['blob:unregistered'] }), false);
});
