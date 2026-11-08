import assert from 'node:assert/strict';
import test from 'node:test';
import { dailyBoardIds, dailyClues, dailyContents, dismissDailyClue, markDailyCapture } from '../app/daily-model.ts';
import { addWorkspaceContent, patchWorkspaceContent, syncWorkspaceFiles, validWorkspaceFiles } from '../app/workspace-files.ts';
import { addDesktopQuickNote } from '../app/desktop-quick-note.ts';
import { readWorkspace } from '../app/workspace-store.ts';

const note = (id, title = '知识管理：碎片灵感', body = '') => ({ id, kind: 'note', title, body, x: 0, y: 0, width: 360 });
const board = { id: 'board-a', title: '知识管理与碎片灵感', cards: [note('source', '碎片灵感如何形成知识管理的输入')], edges: [] };
const empty = () => syncWorkspaceFiles(undefined, []);
const capture = (files, id = 'new', at = 100) => markDailyCapture(addWorkspaceContent(files, note(id), null, 'notePage', at), id, 'daily', at);

test('Daily is opt-in: legacy loose notes and existing boards never flood the home', () => {
  const files = capture(addWorkspaceContent(syncWorkspaceFiles(undefined, [board]), note('legacy')));
  assert.deepEqual(dailyContents(files).map(content => content.id), ['new']);
  assert.equal(files.contents.find(content => content.id === 'legacy').daily, undefined);
  assert.equal(files.contents.find(content => content.id === 'source').daily, undefined);
});

test('new pet captures join Daily without making retries re-add edited or deleted notes', () => {
  const request = { id: '11111111-1111-4111-8111-111111111111', title: '灵感', body: '记录' };
  const files = addDesktopQuickNote(empty(), request, 100);
  assert.equal(dailyContents(files)[0].daily.source, 'pet');
  const legacy = { ...files, contents: files.contents.map(({ daily, ...content }) => content) };
  assert.strictEqual(addDesktopQuickNote(legacy, request, 200), legacy);
  assert.deepEqual(dailyContents(legacy), []);
  const deleted = { ...empty(), deletedContentIds: ['pet-' + request.id] };
  assert.strictEqual(addDesktopQuickNote(deleted, request, 300), deleted);
});

test('linking uses canonical identity, survives edits/reload, and removes the corresponding clue', () => {
  let files = capture(syncWorkspaceFiles(undefined, [board]));
  assert.equal(dailyClues(dailyContents(files), [board])[0].boardId, board.id);
  const linked = { ...board, cards: [...board.cards, { ...files.contents.find(content => content.id === 'new').card, id: 'instance', sharedId: 'new' }] };
  files = syncWorkspaceFiles(files, [linked]);
  const patched = patchWorkspaceContent(files, [linked], 'new', { body: 'Edited on the board' });
  const restored = readWorkspace(JSON.stringify({ version: 1, boards: patched.boards, files: patched.files, deletedBoards: [], activeId: board.id, nextUntitledIndex: 1 }));
  assert.ok(restored);
  assert.equal(dailyContents(restored.files).length, 1);
  assert.equal(dailyContents(restored.files)[0].card.body, 'Edited on the board');
  assert.deepEqual(dailyBoardIds('new', restored.boards), [board.id]);
  assert.deepEqual(dailyClues(dailyContents(restored.files), restored.boards), []);
});

test('clues expose literal evidence and dismissals persist without hiding the content', () => {
  const files = capture(empty());
  const clues = dailyClues(dailyContents(files), [board]);
  assert.equal(clues.length, 1);
  assert.equal(clues[0].sourceId, 'source', 'matching source remains available even when board title has the same words');
  assert.ok(clues[0].terms.length >= 2);
  for (const word of clues[0].terms) assert.ok(board.title.includes(word) || board.cards[0].title.includes(word));
  const dismissed = JSON.parse(JSON.stringify(dismissDailyClue(files, 'new', board.id)));
  assert.ok(validWorkspaceFiles(dismissed));
  assert.equal(dailyContents(dismissed).length, 1);
  assert.deepEqual(dailyClues(dailyContents(dismissed), [board]), []);
  const unrelated = { ...board, title: '旅行计划', cards: [note('trip', '山间徒步的装备')] };
  assert.deepEqual(dailyClues(dailyContents(files), [unrelated]), []);
});

test('malformed capture metadata is rejected and captures keep their order after edits', () => {
  const files = capture(capture(empty(), 'older', 100), 'newer', 200);
  assert.deepEqual(dailyContents(files).map(content => content.id), ['newer', 'older']);
  for (const daily of [{ source: 'unknown', at: 1 }, { source: 'pet', at: -1 }, { source: 'daily', at: 1.5 }, { source: 'daily', at: 1, dismissedBoards: [null] }]) {
    assert.equal(validWorkspaceFiles({ ...files, contents: [{ ...files.contents[0], daily }] }), false);
  }
});

test('Daily positions survive board synchronization and reload without moving board cards', async () => {
  const { positionDailyCapture } = await import('../app/daily-model.ts');
  let files = capture(syncWorkspaceFiles(undefined, [board]));
  const canonical = files.contents.find(content => content.id === 'new').card;
  const linked = { ...board, cards: [...board.cards, { ...canonical, id: 'instance', sharedId: 'new', x: 900, y: 800 }] };
  files = positionDailyCapture(files, 'new', { x: -325.5, y: 170 });
  files = syncWorkspaceFiles(files, [linked]);
  const restored = readWorkspace(JSON.stringify({ version: 1, boards: [linked], files, deletedBoards: [], activeId: board.id, nextUntitledIndex: 1 }));
  assert.ok(restored);
  assert.deepEqual(restored.files.contents.find(content => content.id === 'new').daily.position, { x: -325.5, y: 170 });
  assert.equal(restored.boards[0].cards[1].x, 900);
  assert.equal(restored.boards[0].cards[1].y, 800);
  for (const position of [{ x: NaN, y: 0 }, { x: Infinity, y: 0 }, { x: 1000001, y: 0 }, { x: '3', y: 0 }, null]) {
    assert.strictEqual(positionDailyCapture(files, 'new', position), files);
    const invalid = { ...files, contents: files.contents.map(content => content.id === 'new' ? { ...content, daily: { ...content.daily, position } } : content) };
    assert.equal(validWorkspaceFiles(invalid), false);
  }
});

test('development preview fills a small Daily without overwriting existing notes or duplicating samples', async () => {
  const { seedDailyPreview } = await import('../app/daily-preview.ts');
  const original = capture(empty(), 'my-note', 100);
  const next = seedDailyPreview(original, 1000000);
  assert.equal(dailyContents(next).length, 15);
  assert.deepEqual(next.contents.find(content => content.id === 'my-note'), original.contents[0]);
  assert.equal(next.contents.filter(content => content.card.image).length, 4);
  assert.ok(validWorkspaceFiles(next));
  const videos = next.contents.filter(content => content.card.kind === 'video');
  assert.equal(videos.length, 2);
  assert.ok(videos.every(content => content.card.video.youtubeId && !content.card.video.localUrl && content.card.video.url.startsWith('https://')));
  assert.strictEqual(seedDailyPreview(next, 2000000), next);
  const deleted = { ...empty(), deletedContentIds: ['daily-preview-v1-0'] };
  const seeded = seedDailyPreview(deleted, 1000000);
  assert.ok(!seeded.contents.some(content => content.id === 'daily-preview-v1-0'));
});

test('daily streak counts local calendar dates, deduplicates days and excludes preview data', async () => {
  const { dailyRecordStreak } = await import('../app/daily-model.ts');
  const at = (day, hour = 12) => new Date(2026, 10, day, hour).getTime();
  let files = capture(capture(capture(empty(), 'today-a', at(6)), 'today-b', at(6, 20)), 'yesterday', at(5));
  files = capture(files, 'two-days-ago', at(4));
  files = capture(files, 'future', at(7));
  assert.equal(dailyRecordStreak(dailyContents(files), at(6, 23)), 3);
  assert.equal(dailyRecordStreak(dailyContents(files).filter(c => c.id !== 'future'), at(7, 0)), 3, 'today is still available to continue yesterday’s streak');
  assert.equal(dailyRecordStreak(dailyContents(files).filter(c => c.id !== 'future'), at(8)), 0);
  const preview = dailyContents(files).map(content => ({ ...content, card: { ...content.card, tags: ['daily-preview'] } }));
  assert.equal(dailyRecordStreak(preview, at(6)), 0);
  assert.equal(dailyRecordStreak([], at(6)), 0);
});

test('English public-domain PDF replaces only the old default PDF, retaining manual position', async () => {
  const { seedDailyPreview } = await import('../app/daily-preview.ts');
  const original = seedDailyPreview(empty(), 1000000);
  const files = { ...original, contents: original.contents.map(content => content.id === 'daily-preview-media-reading' ? {
    ...content, daily: { ...content.daily, position: { x: 45, y: -72 } },
    card: { ...content.card, pdf: { ...content.card.pdf, url: '/assets/onboarding/first-board.pdf' } },
  } : content) };
  const result = seedDailyPreview(files, 2000000);
  const pdf = result.contents.find(content => content.id === 'daily-preview-media-reading');
  assert.equal(pdf.card.pdf.url, '/daily-media/our-mission-to-planet-earth.pdf');
  assert.equal(pdf.card.pdf.pages, 44);
  assert.deepEqual(pdf.daily.position, { x: 45, y: -72 });
  assert.equal(pdf.daily.at, files.contents.find(content => content.id === pdf.id).daily.at);
  assert.strictEqual(seedDailyPreview(result), result);
  const userVersion = { ...files, contents: files.contents.map(content => ({ ...content, card: { ...content.card, tags: [] } })) };
  assert.strictEqual(seedDailyPreview(userVersion), userVersion);
});

test('recycling and restoring a Daily note preserves its capture date and manual position', async () => {
  const { positionDailyCapture } = await import('../app/daily-model.ts');
  const { recycleWorkspaceContents, restoreWorkspaceContent } = await import('../app/workspace-file-recycle.ts');
  const files = positionDailyCapture(capture(empty()), 'new', { x: 20, y: -30 });
  const recycled = recycleWorkspaceContents(files, [], ['new'], 1000);
  assert.equal(dailyContents(recycled.files).length, 0);
  const restored = restoreWorkspaceContent(recycled.files, [], 'new', 1001);
  assert.deepEqual(dailyContents(restored.files)[0].daily, dailyContents(files)[0].daily);
});


test('Daily imports retain PDF/video identity, assets and reader kind through save/restore', async () => {
  const { dailyDisplayCard } = await import('../app/daily-model.ts');
  let files = empty();
  const media = [
    { ...note('pdf'), kind: 'pdf', pdf: { url: '/paper.pdf', thumbnail: '/cover.png', name: 'paper.pdf', size: 100 }, contentRole: 'literature' },
    { ...note('video'), kind: 'video', video: { url: '/film.mp4', poster: '/poster.jpg', duration: 12 }, contentRole: 'video' },
    { ...note('image'), kind: 'image', image: '/photo.jpg', contentRole: 'image' },
  ];
  for (const card of media) files = markDailyCapture(addWorkspaceContent(files, card, null, card.contentRole), card.id, 'daily', 100);
  const restored = readWorkspace(JSON.stringify({ version: 1, boards: [], files, deletedBoards: [], activeId: '', nextUntitledIndex: 1 }));
  assert.ok(restored);
  for (const card of media) {
    const content = dailyContents(restored.files).find(item => item.id === card.id);
    assert.ok(content);
    const display = dailyDisplayCard(content.card);
    assert.equal(display.kind, card.kind);
    assert.deepEqual(display.pdf, card.pdf);
    assert.deepEqual(display.video, card.video);
    assert.equal(display.image, card.image);
    assert.deepEqual(dailyBoardIds(card.id, []), []);
  }
});

test('organizing a daily capture clears the inbox but preserves its source, position and streak after reload', async () => {
  const { organizeDailyCapture, positionDailyCaptures, dailyRecordStreak } = await import('../app/daily-model.ts');
  const at = new Date(2026, 10, 6, 12).getTime();
  const files = positionDailyCaptures(capture(empty(), 'kept-source', at), { 'kept-source': { x: 120, y: -40 } });
  const organized = organizeDailyCapture(files, 'kept-source', at + 100);
  assert.equal(dailyContents(organized).length, 0);
  assert.deepEqual(organized.contents[0].card, files.contents[0].card);
  assert.equal(dailyRecordStreak(organized.contents, at), 1);
  assert.deepEqual(organized.contents[0].daily.position, { x: 120, y: -40 });
  const restored = readWorkspace(JSON.stringify({ version: 1, boards: [], files: organized, deletedBoards: [], activeId: '', nextUntitledIndex: 1 }));
  assert.ok(restored);
  assert.equal(dailyContents(restored.files).length, 0);
  assert.equal(restored.files.contents[0].daily.organizedAt, at + 100);
  assert.equal(validWorkspaceFiles({ ...organized, contents: [{ ...organized.contents[0], daily: { ...organized.contents[0].daily, organizedAt: -1 } }] }), false);
});

test('Daily image presentation is bounded without mutating the stored image', async () => {
  const { dailyDisplayCard } = await import('../app/daily-model.ts');
  const source = { ...note('large-image'), kind: 'image', image: '/large.png', width: 2200, height: 8000 };
  const preview = dailyDisplayCard(source);
  assert.ok(preview.width <= 360 && preview.height <= 420);
  assert.equal(preview.image, source.image);
  assert.equal(source.width, 2200);
  assert.equal(source.height, 8000);
});

test('portrait and landscape images fit both limits with their original ratio and no side padding', async () => {
  const { dailyImageSize } = await import('../app/daily-model.ts');
  for (const [w, h] of [[2200, 8000], [8000, 2200], [240, 180]]) {
    const size = dailyImageSize(w, h);
    assert.ok(size.width <= 360 && size.height <= 420);
    assert.ok(Math.abs((size.width - 2) / (size.height - 2) - w / h) < .00001);
  }
});

void test('Daily quiets unused captures after one week without hiding them or changing layout', async () => {
  const { dailyCardOpacity } = await import('../app/daily-model.ts');
  const day = 86400000, at = Date.UTC(2026, 0, 1);
  const files = capture(empty(), 'quiet', at);
  const content = files.contents[0];
  content.daily.position = { x: -240, y: 100 };
  const before = JSON.stringify(files);
  assert.equal(dailyCardOpacity(content, at + 7 * day), 1);
  assert.equal(dailyCardOpacity(content, at + 14 * day), .8);
  assert.equal(dailyCardOpacity(content, at + 28 * day), .4);
  assert.equal(dailyCardOpacity(content, at + 365 * day), .4);
  assert.equal(dailyCardOpacity(content, at - day), 1);
  assert.equal(dailyCardOpacity(content, NaN), 1);
  assert.equal(dailyContents(files).length, 1);
  assert.equal(JSON.stringify(files), before);
});

void test('using a capture renews opacity and survives save, backup and board synchronization', async () => {
  const { dailyCardOpacity, touchDailyCaptures } = await import('../app/daily-model.ts');
  const { createWorkspaceBackup, readWorkspaceBackup } = await import('../app/workspace-backup.ts');
  const at = Date.UTC(2026, 0, 1), now = at + 40 * 86400000;
  const original = capture(capture(empty(), 'quiet', at), 'other', at + 1);
  const touched = touchDailyCaptures(original, ['quiet'], now);
  assert.equal(dailyCardOpacity(touched.contents.find(c => c.id === 'quiet'), now), 1);
  assert.equal(touched.contents.find(c => c.id === 'quiet').daily.at, at);
  assert.equal(touched.contents.find(c => c.id === 'other'), original.contents.find(c => c.id === 'other'));
  assert.deepEqual(dailyContents(touched).map(c => c.id), dailyContents(original).map(c => c.id));
  assert.strictEqual(touchDailyCaptures(touched, ['missing'], now), touched);
  assert.strictEqual(touchDailyCaptures(touched, ['quiet'], now - 1), touched);
  assert.strictEqual(touchDailyCaptures(touched, ['quiet'], NaN), touched);
  const snapshot = { version: 1, boards: [], deletedBoards: [], activeId: '', nextUntitledIndex: 1, files: syncWorkspaceFiles(touched, []) };
  const restored = readWorkspace(JSON.stringify(snapshot));
  assert.ok(restored);
  assert.equal(restored.files.contents.find(c => c.id === 'quiet').daily.lastUsedAt, now);
  const backup = await createWorkspaceBackup(snapshot, { getFile: async () => undefined }, () => {});
  const prepared = await readWorkspaceBackup(backup, () => {});
  assert.equal(prepared.snapshot.files.contents.find(c => c.id === 'quiet').daily.lastUsedAt, now);
  for (const lastUsedAt of [-1, NaN, 1.5, '2026', null]) {
    assert.equal(validWorkspaceFiles({ ...touched, contents: [{ ...touched.contents[0], daily: { ...touched.contents[0].daily, lastUsedAt } }] }), false);
  }
});

void test('editing a legacy capture renews it even without new activity metadata', async () => {
  const { dailyCardOpacity } = await import('../app/daily-model.ts');
  const at = Date.UTC(2026, 0, 1), now = at + 40 * 86400000;
  const content = capture(empty(), 'legacy', at).contents[0];
  assert.equal(dailyCardOpacity(content, now), .4);
  content.card.updatedAt = new Date(now).toISOString();
  assert.equal(dailyCardOpacity(content, now), 1);
  content.card.updatedAt = 'invalid';
  assert.equal(dailyCardOpacity(content, now), .4);
});
