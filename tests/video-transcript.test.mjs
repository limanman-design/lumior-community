import test from 'node:test';
import assert from 'node:assert/strict';
import { activeVideoCue, normalizeVideoCues, parseVideoCaptions, videoTimestamp } from '../app/video-transcript.ts';

test('caption files preserve hours, milliseconds, multiline text and cue settings', () => {
  const cues = parseVideoCaptions('WEBVTT\r\n\r\nfirst\r\n01:02:03.450 --> 01:02:05.700 align:start\r\n<v Speaker>First line</v>\r\nSecond &amp; third\r\n\r\n00:07.000 --> 00:09.000\r\nNext');
  assert.deepEqual(cues, [
    { time: 7, end: 9, text: 'Next' },
    { time: 3723.45, end: 3725.7, text: 'First line\nSecond & third' },
  ]);
});

test('malformed cues and subtitle metadata do not become clickable timestamps', () => {
  assert.deepEqual(parseVideoCaptions('WEBVTT\n\nNOTE\n00:00 --> 00:01\nmetadata\n\n00:04 --> 00:02\nbackwards\n\n00:05 --> 00:06\n<c>Valid</c>'), [{ time: 5, end: 6, text: 'Valid' }]);
  assert.deepEqual(normalizeVideoCues([{ time: '1', end: 2, text: 'wrong' }, null, { time: 0, end: Infinity, text: 'wrong' }]), []);
});

test('active highlight stops during silence and resumes at the next actual cue', () => {
  const cues = [{ time: 1, end: 2, text: 'First' }, { time: 5, end: 7, text: 'Second' }];
  assert.equal(activeVideoCue(cues, 1), 0);
  assert.equal(activeVideoCue(cues, 2), -1);
  assert.equal(activeVideoCue(cues, 4), -1);
  assert.equal(activeVideoCue(cues, 5), 1);
  assert.equal(videoTimestamp(65.9), '01:05');
});
