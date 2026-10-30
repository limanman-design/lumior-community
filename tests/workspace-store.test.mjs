import assert from 'node:assert/strict';
import test from 'node:test';
import { dayMs, nextUntitled, partitionPinnedBoards, pruneDeletedBoards, readWorkspace, recycleBoard, setBoardPinned } from '../app/workspace-store.ts';

const now = 1_800_000_000_000;
const board = { id: 'research', title: 'Untitled', cards: [{ id: 'note', kind: 'note', title: 'Evidence', body: 'Keep this text', x: 24, y: 80, width: 420 }], edges: [], sections: [{ id: 'group', title: 'Topic', x: 0, y: 0, width: 500, height: 500, color: '#b1f017' }] };
const snapshot = entries => JSON.stringify({ version: 1, boards: [], deletedBoards: entries, activeId: '', nextUntitledIndex: 3 });

test('deleted board keeps all content for exactly 30 days', () => {
  const entry = recycleBoard(board, now);
  assert.equal(entry.expiresAt, now + 30 * dayMs);
  assert.deepEqual(pruneDeletedBoards([entry], entry.expiresAt - 1), [entry]);
  assert.deepEqual(pruneDeletedBoards([entry], entry.expiresAt), []);
});
test('reload preserves recoverable cards and sections', () => {
  const entry = recycleBoard(board, now);
  assert.deepEqual(readWorkspace(snapshot([entry]), now + dayMs).deletedBoards[0].board, board);
});
test('returning after the deadline removes expired boards without restoring them', () => {
  const stored = readWorkspace(snapshot([recycleBoard(board, now)]), now + 31 * dayMs);
  assert.deepEqual(stored.deletedBoards, []);
  assert.deepEqual(stored.boards, []);
});
test('unnamed boards count forward after rename, deletion and reload', () => {
  assert.deepEqual(nextUntitled([]), { title: 'Untitled', index: 1 });
  assert.deepEqual(nextUntitled([{ title: 'Untitled' }, { title: 'Untitled 4' }]), { title: 'Untitled 5', index: 5 });
  const stored = readWorkspace(snapshot([]), now);
  assert.deepEqual(nextUntitled(stored.boards, stored.nextUntitledIndex), { title: 'Untitled 3', index: 3 });
});
test('restored board survives reload in the active list', () => {
  const stored = readWorkspace(JSON.stringify({ version: 1, boards: [board], deletedBoards: [], activeId: board.id, nextUntitledIndex: 2 }), now);
  assert.equal(stored.activeId, board.id);
  assert.deepEqual(stored.boards, [board]);
});
test('invalid stored data falls back safely', () => {
  for (const raw of [null, '{broken', 'null', '{"version":2}', '{"version":1,"boards":[null],"deletedBoards":[]}']) assert.equal(readWorkspace(raw, now), null);
});

void test('pins survive reload and unpinning preserves board contents without mutating the source', () => {
  const pinned = setBoardPinned(board, true, now);
  assert.equal(pinned.pinnedAt, now);
  assert.equal(Object.hasOwn(board, 'pinnedAt'), false);
  assert.equal(setBoardPinned(pinned, true, now + 1), pinned);
  const stored = readWorkspace(JSON.stringify({ version: 1, boards: [pinned], deletedBoards: [], activeId: board.id, nextUntitledIndex: 2 }), now);
  assert.deepEqual(stored.boards[0], pinned);
  assert.deepEqual(setBoardPinned(stored.boards[0], false), board);
  assert.equal(pinned.pinnedAt, now);
  assert.equal(setBoardPinned(board, false), board);
  for (const timestamp of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => setBoardPinned(board, true, timestamp), RangeError);
});

void test('pin partition sorts most recently pinned first and retains stable recent and tied pin order', () => {
  const older = { ...board, id: 'older', pinnedAt: now };
  const latest = { ...board, id: 'latest', pinnedAt: now + 1 };
  const tied = { ...board, id: 'tied', pinnedAt: now };
  const recent = { ...board, id: 'recent' };
  const invalid = { ...board, id: 'invalid', pinnedAt: -1 };
  const original = [board, older, recent, latest, invalid, tied];
  const grouped = partitionPinnedBoards(Object.freeze([...original]));
  assert.deepEqual(grouped.pinned, [latest, older, tied]);
  assert.deepEqual(grouped.recent, [board, recent, invalid]);
  assert.deepEqual(original, [board, older, recent, latest, invalid, tied]);
});

void test('recycling removes pins from the active list and restoring retains their saved pin', () => {
  const pinned = setBoardPinned(board, true, now);
  const entry = recycleBoard(pinned, now);
  const stored = readWorkspace(JSON.stringify({ version: 1, boards: [pinned], deletedBoards: [entry], activeId: board.id, nextUntitledIndex: 2 }), now);
  assert.deepEqual(partitionPinnedBoards(stored.boards).pinned, []);
  assert.equal(stored.deletedBoards[0].board.pinnedAt, now);
  const restored = readWorkspace(JSON.stringify({ ...stored, boards: [stored.deletedBoards[0].board], deletedBoards: [] }), now + 1);
  assert.equal(partitionPinnedBoards(restored.boards).pinned[0].pinnedAt, now);
  const expired = readWorkspace(JSON.stringify(stored), entry.expiresAt);
  assert.deepEqual(expired.boards, []);
  assert.deepEqual(expired.deletedBoards, []);
});

void test('legacy boards stay unpinned and invalid pin metadata is removed without discarding content', () => {
  for (const pinnedAt of [null, false, '123', -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const invalid = { ...board, pinnedAt };
    const stored = readWorkspace(JSON.stringify({ version: 1, boards: [invalid], deletedBoards: [recycleBoard({ ...invalid, id: 'deleted' }, now)], activeId: board.id, nextUntitledIndex: 2 }), now);
    assert.deepEqual(stored.boards[0], board);
    assert.deepEqual(stored.deletedBoards[0].board, { ...board, id: 'deleted' });
  }
  const legacy = readWorkspace(JSON.stringify({ version: 1, boards: [board], deletedBoards: [], activeId: board.id, nextUntitledIndex: 2 }), now);
  assert.deepEqual(partitionPinnedBoards(legacy.boards), { pinned: [], recent: [board] });
});

test('bundled Hike lecture uses YouTube after reload without changing shared content or uploaded replacements', () => {
  const video = { url: 'https://www.youtube.com/watch?v=ZW8gWgpptI8', youtubeId: 'ZW8gWgpptI8', localUrl: '/game-research/short-hike-talk.mp4', transcriptUrl: '/open-world/gdc.en.json', subtitleUrl: '/game-research/short-hike-talk.en-orig.vtt' };
  const lecture = { ...board.cards[0], id: 'game-video-hike', sharedId: 'game-video-hike', kind: 'video', sourceName: 'GDC Festival of Gaming', video };
  const zh = { ...board, cards: [lecture] };
  const en = { ...zh, id: 'english', cards: [{ ...lecture, id: 'game-video-hike-en', title: 'Edited title', body: 'Edited notes', x: 80 }] };
  const custom = { ...zh, id: 'custom', cards: [{ ...lecture, video: { ...video, localUrl: 'lumior-file:uploaded-video' } }] };
  const raw = JSON.stringify({ version: 1, boards: [zh, en, custom], deletedBoards: [recycleBoard({ ...zh, id: 'recycled' }, now)], activeId: 'english', nextUntitledIndex: 7 });
  const stored = readWorkspace(raw, now);
  assert.equal(stored.activeId, 'english');
  assert.equal(stored.nextUntitledIndex, 7);
  for (const migrated of [stored.boards[0], stored.boards[1], stored.deletedBoards[0].board]) {
    const card = migrated.cards[0];
    assert.equal(card.video.localUrl, undefined);
    assert.equal(card.video.youtubeId, video.youtubeId);
    assert.equal(card.video.transcriptUrl, video.transcriptUrl);
    assert.equal(card.video.subtitleUrl, video.subtitleUrl);
    assert.equal(card.sharedId, lecture.sharedId);
    assert.deepEqual(migrated.edges, board.edges);
    assert.deepEqual(migrated.sections, board.sections);
  }
  assert.equal(stored.boards[1].cards[0].body, 'Edited notes');
  assert.equal(stored.boards[1].cards[0].title, 'Edited title');
  assert.equal(stored.boards[1].cards[0].x, 80);
  assert.deepEqual(stored.boards[2], { ...custom, cards: [{ ...custom.cards[0], width: 562, height: 377 }] });
  assert.deepEqual(readWorkspace(JSON.stringify(stored), now), stored);
});
