import assert from 'node:assert/strict';
import test from 'node:test';
import { patchCanvasCard } from '../app/canvas-card-update.ts';
import { libraryInstance, reconcileShared } from '../app/shared-cards.ts';
import { ensureWorkspaceFiles, patchWorkspaceContent } from '../app/workspace-files.ts';
import { createInitialWorkspace, readWorkspace } from '../app/workspace-store.ts';
import { fileReferencePrefix, fileReferences, fileUrl, releaseFileUrls, resolveWorkspace, serializeWorkspace } from '../app/workspace-assets.ts';

const media = [
  ['image', 'figure.png', 'image/png'],
  ['video', 'clip.mp4', 'video/mp4'],
  ['audio', 'recording.mp3', 'audio/mpeg'],
  ['file', 'appendix.pdf', 'application/pdf'],
];
const paragraph = () => ({ id: 'paragraph', type: 'paragraph', content: 'Original text', children: [] });
const geometry = ({ id, sharedId, x, y, width, height }) => ({ id, sharedId, x, y, width, height });
const references = snapshot => snapshot.boards.flatMap(board => board.cards).filter(card => card.sharedId === 'shared-media-note');
const canonical = snapshot => snapshot.files.contents.find(content => content.id === 'shared-media-note');

function fixture() {
  const note = {
    id: 'source-instance', sharedId: 'shared-media-note', kind: 'note', contentRole: 'notePage',
    title: 'Synthetic media note', body: 'Original text', blocks: [paragraph()],
    x: 10, y: 20, width: 420, height: 600,
  };
  const reference = { ...libraryInstance(note, { x: 900, y: 800 }, true, 'other-board-instance'), width: 700, height: 900 };
  const independent = JSON.parse(JSON.stringify(libraryInstance(note, { x: 1700, y: 1500 }, false, 'independent-copy')));
  const snapshot = ensureWorkspaceFiles({
    ...createInitialWorkspace(), activeId: 'first',
    boards: [
      { id: 'first', title: 'First synthetic board', cards: [note], edges: [] },
      { id: 'second', title: 'Second synthetic board', cards: [reference, independent], edges: [] },
    ],
  });
  const files = ['original', 'replacement'].map(version => media.map(([kind, name, type]) => {
    const blob = new Blob([`Synthetic ${version} ${kind} bytes`], { type });
    return { id: crypto.randomUUID(), name: `${version}-${name}`, type, size: blob.size, blob };
  }));
  return { snapshot, files, independent, geometries: references(snapshot).map(geometry) };
}

function blocksWith(files) {
  const blocks = media.map(([type], index) => ({
    id: `block-${type}`, type,
    props: { name: files[index].name, url: fileUrl(files[index]), ...(type === 'file' ? {} : { showPreview: true }) },
  }));
  // Include nested media: syncing and persistence must carry the full document.
  return [{ ...paragraph(), children: blocks.slice(0, 2) }, ...blocks.slice(2)];
}

const paths = [
  ['canvas card editor', (snapshot, patch) => {
    const changed = patchCanvasCard(snapshot.boards[0], 'source-instance', patch, snapshot.boards);
    return ensureWorkspaceFiles({ ...snapshot, boards: changed.boards });
  }],
  ['board reconciliation', (snapshot, patch) => {
    const before = snapshot.boards[0];
    const after = { ...before, cards: [{ ...before.cards[0], ...patch }] };
    return ensureWorkspaceFiles({ ...snapshot, boards: reconcileShared(before, after, snapshot.boards) });
  }],
  ['standalone NotePage editor', (snapshot, patch) => ({
    ...snapshot, ...patchWorkspaceContent(snapshot.files, snapshot.boards, 'shared-media-note', patch),
  })],
];

test.afterEach(() => releaseFileUrls());

for (const [name, update] of paths) {
  void test(`${name}: four media kinds add, replace and delete across boards, survive reload, and leave independent copies local`, async () => {
    const { snapshot: original, files, independent, geometries } = fixture();
    let current = original;
    for (const [stage, activeFiles] of [['add', files[0]], ['replace', files[1]], ['delete', []]]) {
      const before = serializeWorkspace(current);
      const blocks = activeFiles.length ? blocksWith(activeFiles) : [paragraph()];
      const updated = update(current, { blocks });
      assert.deepEqual(serializeWorkspace(current), before, `${stage}: previous undo snapshot stays immutable`);
      for (const card of references(updated)) {
        assert.deepEqual(card.blocks, blocks, `${stage}: media document reaches each shared instance`);
        assert.equal(card.body, 'Original text');
      }
      assert.deepEqual(references(updated).map(geometry), geometries, `${stage}: card IDs and geometry stay local`);
      assert.deepEqual(updated.boards[1].cards[1], independent, `${stage}: independent copy is not synchronized`);
      assert.deepEqual(canonical(updated).card.blocks, blocks, `${stage}: standalone NotePage receives board edits`);
      assert.ok(canonical(updated).variants.every(variant => JSON.stringify(variant.card.blocks) === JSON.stringify(blocks)));

      const serialized = serializeWorkspace(updated);
      const expectedBlocks = serializeWorkspace(blocks);
      assert.equal(JSON.stringify(serialized).includes('blob:'), false);
      assert.deepEqual(fileReferences(serialized).sort(), activeFiles.map(file => fileReferencePrefix + file.id).sort());
      releaseFileUrls();
      const reopened = readWorkspace(JSON.stringify(serialized));
      assert.ok(reopened, `${stage}: persisted workspace is readable`);
      // The app recreates URLs from its stored file bytes after reopening.
      const freshUrls = activeFiles.map(fileUrl);
      current = resolveWorkspace(reopened);
      assert.deepEqual(references(current).map(geometry), geometries);
      assert.deepEqual(current.boards[1].cards[1], independent);
      for (const card of [canonical(current).card, ...references(current)]) {
        assert.deepEqual(serializeWorkspace(card.blocks), expectedBlocks, `${stage}: media document survives reload`);
        assert.deepEqual(fileReferences(card.blocks).sort(), freshUrls.slice().sort());
      }
      for (const [index, url] of freshUrls.entries()) {
        const response = await fetch(url);
        assert.equal(response.headers.get('content-type'), activeFiles[index].type);
        assert.equal(await response.text(), await activeFiles[index].blob.text());
      }
    }
    assert.deepEqual(original.boards[0].cards[0].blocks, [paragraph()]);
  });
}
