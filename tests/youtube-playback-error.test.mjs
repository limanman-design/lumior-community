import assert from 'node:assert/strict';
import test from 'node:test';
import { youtubePlaybackErrorForCode, youtubePlaybackErrorMessage } from '../app/youtube-playback-error.ts';

void test('YouTube errors preserve the SDK reason instead of blaming every rejection on connectivity', () => {
  for (const [code, reason] of [[2, 'invalid-video'], [5, 'playback'], [100, 'unavailable'], [101, 'embed-disabled'], [150, 'embed-disabled'], [153, 'client-identity']]) {
    const error = youtubePlaybackErrorForCode(code);
    assert.deepEqual(error, { reason, code });
    const message = youtubePlaybackErrorMessage(error);
    assert.ok(message.en);
    assert.ok(message.zh);
    assert.doesNotMatch(message.en, /connection|network/i);
    assert.doesNotMatch(message.zh, /网络/);
  }
});

void test('permanent embedding, link, access and identity failures offer the original without ineffective retries', () => {
  for (const code of [2, 100, 101, 150, 153]) {
    assert.equal(youtubePlaybackErrorMessage(youtubePlaybackErrorForCode(code)).retryable, false);
  }
  for (const reason of ['playback', 'network', 'initialization-timeout', 'unknown']) {
    assert.equal(youtubePlaybackErrorMessage({ reason }).retryable, true);
  }
  assert.match(youtubePlaybackErrorMessage(youtubePlaybackErrorForCode(101)).en, /video owner/);
  assert.match(youtubePlaybackErrorMessage(youtubePlaybackErrorForCode(153)).en, /verify this app/);
});

void test('unknown SDK values remain playback failures and retain only finite integer diagnostics', () => {
  assert.deepEqual(youtubePlaybackErrorForCode(999), { reason: 'unknown', code: 999 });
  for (const value of [undefined, null, '101', NaN, Infinity, 5.5, {}, { data: 101 }]) {
    assert.deepEqual(youtubePlaybackErrorForCode(value), { reason: 'unknown' });
  }
  assert.doesNotMatch(youtubePlaybackErrorMessage(youtubePlaybackErrorForCode(999)).en, /connection/i);
});

void test('only script loading failure describes connectivity; slow initialization stays distinct', () => {
  assert.match(youtubePlaybackErrorMessage({ reason: 'network' }).en, /connection/);
  assert.match(youtubePlaybackErrorMessage({ reason: 'initialization-timeout' }).en, /too long to respond/);
  assert.notEqual(youtubePlaybackErrorMessage({ reason: 'network' }).zh, youtubePlaybackErrorMessage({ reason: 'initialization-timeout' }).zh);
});
