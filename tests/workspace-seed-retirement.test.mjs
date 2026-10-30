import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createInitialWorkspace, dayMs, partitionPinnedBoards, readWorkspace, recycleBoard, setBoardPinned } from '../app/workspace-store.ts';
import { createWorkspaceBackup, mergeRestoredWorkspace, readWorkspaceBackup } from '../app/workspace-backup.ts';

const now = 1_800_000_000_000;
const seed = (id, title) => ({
  id, title, demoLayoutVersion: 2,
  cards: [{ id: id + '-note', kind: 'note', title: 'Edited note', body: 'Synthetic saved content', x: 20, y: 40, width: 360 }],
  edges: [],
});
const english = seed('game-research-en', 'Game Studies · Exploration & Player Experience');
const chinese = seed('game-research', '游戏研究生 · 探索与玩家体验');
const tiny = seed('tiny-world', 'Tiny Open World — First Prototype');
const own = seed('own-board', chinese.title);
const snapshot = (boards = [chinese, english, tiny, own], activeId = chinese.id) => ({
  version: 1, boards, deletedBoards: [], activeId, nextUntitledIndex: 8, pdfMarks: {},
});

void test('new workspaces start with an empty home and remain empty after saving and reloading', () => {
  const initial = createInitialWorkspace();
  assert.deepEqual(initial.boards, []);
  assert.deepEqual(initial.deletedBoards, []);
  assert.equal(initial.activeId, '');
  assert.equal(initial.nextUntitledIndex, 1);
  assert.deepEqual(initial.files.contents, []);
  assert.deepEqual(initial.files.entries, []);
  assert.deepEqual(initial.files.folders, []);
  assert.deepEqual(readWorkspace(JSON.stringify(initial), now), initial);
});

void test('existing example identities and custom boards all survive reload, regardless of the historical retirement marker', () => {
  const edited = setBoardPinned({ ...chinese, title: 'Edited original', cards: [...chinese.cards, { ...own.cards[0], id: 'added-note' }], edges: [{ id: 'added-edge', from: chinese.cards[0].id, to: 'added-note' }], sections: [{ id: 'added-section', title: 'Saved section', x: 0, y: 0, width: 500, height: 400, color: '#ffffff' }] }, true, now - 2);
  for (const marker of [undefined, 1]) {
    const current = { ...snapshot([edited, english, tiny, own]), ...(marker ? { seedRetirementVersion: marker } : {}) };
    const reloaded = readWorkspace(JSON.stringify(current), now);
    assert.deepEqual(reloaded.boards, current.boards);
    assert.deepEqual(reloaded.deletedBoards, []);
    assert.equal(reloaded.activeId, edited.id);
    assert.equal(reloaded.nextUntitledIndex, current.nextUntitledIndex);
    assert.deepEqual(partitionPinnedBoards(reloaded.boards).pinned, [edited]);
    assert.equal(reloaded.seedRetirementVersion, marker);
  }
});

void test('an existing empty workspace never recreates deleted examples', () => {
  const current = snapshot([], '');
  const reloaded = readWorkspace(JSON.stringify(current), now);
  assert.deepEqual(reloaded.boards, []);
  assert.equal(reloaded.activeId, '');
  assert.equal(reloaded.files.contents.length, 0);
});

void test('already recycled examples keep their retention deadline and are not restored by the empty default', () => {
  const entry = recycleBoard(tiny, now - dayMs);
  const current = { ...snapshot([english, own], own.id), deletedBoards: [entry] };
  const reloaded = readWorkspace(JSON.stringify(current), now);
  assert.deepEqual(reloaded.boards, current.boards);
  assert.deepEqual(reloaded.deletedBoards, [entry]);
  assert.equal(reloaded.activeId, own.id);
  assert.equal(reloaded.deletedBoards[0].expiresAt, entry.expiresAt);
});

void test('complete backup restores existing examples, edited content and pins into an empty workspace', async () => {
  const current = { ...snapshot([setBoardPinned(chinese, true, now), english, own], own.id), deletedBoards: [recycleBoard(tiny, now)], seedRetirementVersion: 1 };
  const source = { getFile: async () => undefined, fetch: async () => { throw new Error('Synthetic note boards must not fetch attachments.'); } };
  const prepared = await readWorkspaceBackup(await createWorkspaceBackup(current, source, () => {}), () => {});
  const identities = new Map();
  const restored = mergeRestoredWorkspace(createInitialWorkspace(), prepared.snapshot, identities);
  assert.equal(restored.boards.length, current.boards.length);
  assert.deepEqual(restored.boards.map(board => board.title), current.boards.map(board => board.title + ' · Restored'));
  assert.equal(restored.boards[0].pinnedAt, now);
  assert.equal(restored.deletedBoards[0].board.id, identities.get(tiny.id));
  assert.equal(restored.deletedBoards[0].expiresAt, current.deletedBoards[0].expiresAt);
  const reloaded = readWorkspace(JSON.stringify(restored), now);
  assert.deepEqual(reloaded.boards, JSON.parse(JSON.stringify(restored.boards)));
});

void test('retiring the first-board guide preserves saved practice edits, annotations and attachments', async () => {
  const boardId = 'saved-practice';
  const sourceId = `lumior-onboarding:${boardId}:pdf`;
  const pdf = {
    url: `/assets/onboarding/first-board.pdf?board=${boardId}`,
    name: 'Lumior-阅读与观点.pdf', size: 38125, pages: 1,
    thumbnail: '/assets/onboarding/first-board-cover.png',
  };
  const mark = {
    id: `lumior-onboarding:${boardId}:excerpt`,
    text: '读到重要内容时，先摘录依据，再写下自己的判断。',
    color: '#e6c85c', note: '我保存的批注',
    fragments: [{ page: 1, rects: [{ x: 9.407407, y: 34.408305, width: 54.092593, height: 1.900486 }] }],
  };
  const practice = {
    id: boardId, title: '我已改写的体验画板', pinnedAt: now,
    cards: [
      { id: sourceId, kind: 'pdf', title: '保留原文', body: '', x: 0, y: 0, width: 360, height: 510, pdf },
      { id: 'my-excerpt', kind: 'note', title: '我的观点', body: '之后补充的判断', x: 555, y: 45, width: 420, height: 300,
        pdfExcerpt: { sourceId, sourceTitle: '保留原文', pdf, mark } },
    ],
    edges: [{ id: 'my-edge', from: sourceId, to: 'my-excerpt', label: '我补充的关系' }],
  };
  const current = { ...snapshot([practice], practice.id), pdfMarks: { [pdf.url]: [mark] } };
  const reloaded = readWorkspace(JSON.stringify(current), now);
  assert.deepEqual(reloaded.boards, current.boards);
  assert.deepEqual(reloaded.pdfMarks, current.pdfMarks);
  const originalPdf = await readFile(new URL('../public/assets/onboarding/first-board.pdf', import.meta.url));
  const cover = await readFile(new URL('../public/assets/onboarding/first-board-cover.png', import.meta.url));
  assert.ok(originalPdf.subarray(0, 8).toString().startsWith('%PDF-'));
  assert.ok(cover.length > 0);
  const fetched = [];
  const source = {
    getFile: async () => undefined,
    fetch: async url => {
      fetched.push(url);
      if (url === pdf.url) return new Response(originalPdf, { headers: { 'Content-Type': 'application/pdf' } });
      if (url === pdf.thumbnail) return new Response(cover, { headers: { 'Content-Type': 'image/png' } });
      throw new Error(`Unexpected attachment: ${url}`);
    },
  };
  const backup = await readWorkspaceBackup(await createWorkspaceBackup(reloaded, source, () => {}), () => {});
  assert.deepEqual(new Set(fetched), new Set([pdf.url, pdf.thumbnail]));
  assert.equal(backup.files.length, 2);
  assert.deepEqual(new Uint8Array(await backup.files.find(file => file.type === 'application/pdf').blob.arrayBuffer()), new Uint8Array(originalPdf));
  const saved = backup.snapshot.boards[0];
  assert.equal(saved.cards[1].body, practice.cards[1].body);
  assert.equal(saved.cards[1].pdfExcerpt.pdf.url, saved.cards[0].pdf.url);
  assert.deepEqual(backup.snapshot.pdfMarks[saved.cards[0].pdf.url], [mark]);
  assert.deepEqual(saved.edges, practice.edges);
  assert.equal(saved.pinnedAt, practice.pinnedAt);
});
