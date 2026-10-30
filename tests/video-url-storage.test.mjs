import assert from 'node:assert/strict';
import test from 'node:test';
import { importVideoUrl } from '../app/video-url.ts';
import { readWorkspace, recycleBoard } from '../app/workspace-store.ts';
import { createWorkspaceBackup, readWorkspaceBackup, mergeRestoredWorkspace } from '../app/workspace-backup.ts';
import { normalizeVideoBoard } from '../app/card-sizing.ts';

const card = (url, id) => ({ ...importVideoUrl(url), id, x: 20, y: 40, width: 560 });
const board = normalizeVideoBoard({ id: 'video-links', title: 'Links', cards: [card('https://www.bilibili.com/video/BV1B7411m7LV/?p=2&t=15', 'bili'), card('https://youtu.be/M7lc1UVf-VE?t=30s', 'yt')], edges: [] });
const snapshot = { version: 1, boards: [board], deletedBoards: [], activeId: board.id, nextUntitledIndex: 1 };

void test('linked video provider metadata survives active and recycled workspace storage', () => {
  assert.deepEqual(readWorkspace(JSON.stringify(snapshot)).boards[0].cards, board.cards);
  const now = Date.now();
  const stored = readWorkspace(JSON.stringify({ ...snapshot, boards: [], deletedBoards: [recycleBoard(board, now)] }), now);
  assert.deepEqual(stored.deletedBoards[0].board.cards, board.cards);
});

void test('linked videos back up and restore without fetching third-party videos or posters', async () => {
  const source = { getFile: async () => undefined, fetch: async () => { throw new Error('Remote sources must remain links'); } };
  const prepared = await readWorkspaceBackup(await createWorkspaceBackup(snapshot, source, () => {}), () => {});
  assert.equal(prepared.files.length, 0);
  assert.deepEqual(prepared.snapshot.boards[0].cards, board.cards);
  const restored = mergeRestoredWorkspace({ ...snapshot, boards: [], activeId: '' }, prepared.snapshot);
  assert.deepEqual(restored.boards[0].cards.map(item => item.video), board.cards.map(item => item.video));
  assert.notEqual(restored.boards[0].cards[0].id, board.cards[0].id);
});

void test('malformed new provider fields are rejected before loading an embedded player', () => {
  const broken = { ...snapshot, boards: [{ ...board, cards: [{ ...board.cards[0], video: { ...board.cards[0].video, url: 'https://127.0.0.1/private' } }] }] };
  assert.equal(readWorkspace(JSON.stringify(broken)), null);
});
