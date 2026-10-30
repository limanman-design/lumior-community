import test from 'node:test';
import assert from 'node:assert/strict';
import { createVideoStatusStore, videoStatusTone } from '../app/video-status.ts';

const notice = (status, message = status) => ({ status, message });

test('playback and caption errors remain red while other video work succeeds or loads', () => {
  assert.equal(videoStatusTone({ playback: notice('error'), captions: notice('ready'), 'caption-import': notice('ready') }, 'ready', true), 'error');
  assert.equal(videoStatusTone({ playback: notice('ready'), captions: notice('error'), 'caption-import': notice('loading') }, 'idle', true), 'error');
  assert.equal(videoStatusTone({ playback: notice('ready'), captions: notice('ready') }, 'error', true), 'error');
});

test('pending video or AI work precedes missing-caption and ready states', () => {
  assert.equal(videoStatusTone({ playback: notice('loading'), captions: notice('missing') }, 'idle', false), 'loading');
  assert.equal(videoStatusTone({ playback: notice('ready'), captions: notice('ready') }, 'reading', true), 'loading');
  assert.equal(videoStatusTone({ playback: notice('ready'), 'caption-import': notice('loading') }, 'idle', true), 'loading');
});

test('a playable video with no AI-readable captions remains a warning', () => {
  assert.equal(videoStatusTone({ playback: notice('ready'), captions: notice('missing') }, 'idle', false), 'warning');
  assert.equal(videoStatusTone({ playback: notice('ready') }, 'empty', true), 'warning');
  assert.equal(videoStatusTone({ playback: notice('ready'), captions: notice('ready') }, 'idle', true), 'ready');
  assert.equal(videoStatusTone({ playback: notice('ready'), captions: notice('ready') }, 'ready', true, true), 'warning');
  assert.equal(videoStatusTone({}, 'idle', true), 'idle');
});

test('releasing a player removes its retry action and rejects late callbacks', () => {
  const store = createVideoStatusStore();
  const player = store.bind('playback');
  const retry = () => {};
  player.report({ ...notice('error'), retry });
  assert.equal(store.getSnapshot().playback.retry, retry);
  player.release();
  assert.deepEqual(store.getSnapshot(), {});
  player.report({ ...notice('error', 'late network error'), retry });
  assert.deepEqual(store.getSnapshot(), {});
});

test('a replacing player owns the channel even if the previous player finishes or unmounts later', () => {
  const store = createVideoStatusStore();
  const oldPlayer = store.bind('playback');
  oldPlayer.report(notice('error', 'old source'));
  const newPlayer = store.bind('playback');
  assert.deepEqual(store.getSnapshot(), {});
  newPlayer.report(notice('ready', 'new source'));
  oldPlayer.report(notice('error', 'late old source error'));
  oldPlayer.release();
  assert.equal(store.getSnapshot().playback.message, 'new source');
  assert.equal(store.getSnapshot().playback.retry, undefined);
});

test('changing sources uses a fresh store and source callbacks cannot affect it', () => {
  const first = createVideoStatusStore(), second = createVideoStatusStore();
  const oldCaptions = first.bind('captions');
  oldCaptions.report(notice('error', 'old caption source'));
  first.bind('caption-import').report(notice('ready', 'old import'));
  second.bind('playback').report(notice('loading', 'new video'));
  oldCaptions.report(notice('ready', 'late captions'));
  assert.deepEqual(second.getSnapshot(), { playback: notice('loading', 'new video') });
});

test('channel changes notify subscribers while unsubscribed listeners remain detached', () => {
  const store = createVideoStatusStore();
  let calls = 0;
  const unsubscribe = store.subscribe(() => calls++);
  const captions = store.bind('captions');
  captions.report(notice('loading'));
  captions.report(notice('ready'));
  assert.equal(calls, 2);
  unsubscribe();
  captions.release();
  assert.equal(calls, 2);
  assert.deepEqual(store.getSnapshot(), {});
});
