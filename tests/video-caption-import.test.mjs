import test from 'node:test';
import assert from 'node:assert/strict';
import { canReplaceVideoCaptions, captionsToWebVtt, decodeCaptionFile, importVideoCaptionFile, maxCaptionFileBytes, maxCaptionTextCharacters } from '../app/video-caption-import.ts';
import { fetchVideoCues } from '../app/video-caption-loader.ts';
import { parseVideoCaptions } from '../app/video-transcript.ts';

const srt = '1\r\n00:00:01,200 --> 00:00:03,400\r\n第一句 <i>字幕</i>\r\n\r\n2\r\n01:02:03,045 --> 01:02:04,999\r\nSecond &amp; third\r\nNew line';

test('SRT import prepares permanent JSON and native-player VTT in one store operation', async () => {
  let calls = 0, stored;
  const result = await importVideoCaptionFile(new File([srt], 'Lesson.SRT'), async files => {
    calls++; stored = files;
    assert.equal(files.length, 2);
    assert.deepEqual(files.map(file => file.blob.type), ['application/json', 'text/vtt']);
    return ['/cues.json', '/captions.vtt'];
  });
  assert.equal(calls, 1);
  assert.equal(result.cueCount, 2);
  assert.equal(result.transcriptUrl, '/cues.json');
  assert.equal(result.subtitleUrl, '/captions.vtt');
  const cues = JSON.parse(await stored[0].blob.text());
  assert.deepEqual(cues, [
    { time: 1.2, end: 3.4, text: '第一句 字幕' },
    { time: 3723.045, end: 3724.999, text: 'Second & third\nNew line' },
  ]);
  assert.deepEqual(parseVideoCaptions(await stored[1].blob.text()), cues);
  const loaded = await fetchVideoCues(result, undefined, async url => new Response(stored[url === '/cues.json' ? 0 : 1].blob));
  assert.deepEqual(loaded, cues);
});

test('WebVTT text stays plain in native captions, including escaped markup', () => {
  const cues = [{ time: 7, end: 9, text: 'A <b>literal</b> & link' }];
  const vtt = captionsToWebVtt(cues);
  assert.match(vtt, /A &lt;b&gt;literal&lt;\/b&gt; &amp; link/);
  assert.deepEqual(parseVideoCaptions(vtt), cues);
});

test('UTF-8 BOM and UTF-16 BOM files are decoded without corrupting multilingual text', async () => {
  const utf8 = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(srt)]);
  assert.equal(decodeCaptionFile(utf8), srt);
  const source = 'WEBVTT\n\n00:01.000 --> 00:02.000\n你好 café';
  for (const littleEndian of [true, false]) {
    const bytes = new Uint8Array(2 + source.length * 2);
    const view = new DataView(bytes.buffer);
    bytes.set(littleEndian ? [0xff, 0xfe] : [0xfe, 0xff]);
    for (let index = 0; index < source.length; index++) view.setUint16(2 + index * 2, source.charCodeAt(index), littleEndian);
    let json;
    await importVideoCaptionFile(new File([bytes], 'utf16.vtt'), async files => { json = await files[0].blob.text(); return ['a', 'b']; });
    assert.equal(JSON.parse(json)[0].text, '你好 café');
  }
});

test('invalid files and oversized inputs never reach permanent storage', async () => {
  let writes = 0;
  const store = async () => { writes++; return ['a', 'b']; };
  await assert.rejects(importVideoCaptionFile(new File([srt], 'wrong.txt'), store), /SRT|VTT/);
  await assert.rejects(importVideoCaptionFile(new File(['plain text'], 'empty.srt'), store), /time|时间/);
  await assert.rejects(importVideoCaptionFile(new File(['00:01.000 --> 00:02.000\nHello'], 'missing-header.vtt'), store), /WEBVTT/);
  await assert.rejects(importVideoCaptionFile(new File([new Uint8Array([0xc3, 0x28])], 'bad.srt'), store), /UTF-8/);
  await assert.rejects(importVideoCaptionFile(new File([new Uint8Array([0, 1, 2])], 'binary.srt'), store), /UTF-8/);
  await assert.rejects(importVideoCaptionFile(new File([new Uint8Array(maxCaptionFileBytes + 1)], 'huge.srt'), store), /8 MB/);
  assert.equal(writes, 0);
});

test('failed atomic storage exposes no replacement URLs and leaves old caption metadata intact', async () => {
  const video = { localUrl: 'original-video', transcriptUrl: 'old-json', subtitleUrl: 'old-vtt' };
  const before = structuredClone(video);
  await assert.rejects(importVideoCaptionFile(new File([srt], 'lesson.srt'), async () => { throw new Error('Disk full'); }), /Disk full/);
  assert.deepEqual(video, before);
});

test('caption imports enforce the AI reader text limit before permanently saving', async () => {
  let writes = 0;
  const file = new File(['1\n00:00:00,000 --> 00:01:00,000\n', 'a'.repeat(maxCaptionTextCharacters + 1)], 'too-much-text.srt');
  assert.ok(file.size < maxCaptionFileBytes);
  await assert.rejects(importVideoCaptionFile(file, async () => { writes++; return ['a', 'b']; }), /2 million|200 万/);
  assert.equal(writes, 0);
});

test('source guards retain metadata edits but reject changed or deleted videos and newer captions', () => {
  const expected = { localUrl: 'video-a', url: '', poster: '', duration: 60, subtitleUrl: 'old-vtt', transcriptUrl: 'old-json' };
  assert.equal(canReplaceVideoCaptions({ ...expected, poster: 'new-poster', duration: 65 }, expected), true);
  assert.equal(canReplaceVideoCaptions({ ...expected, localUrl: 'video-b' }, expected), false);
  assert.equal(canReplaceVideoCaptions({ ...expected, url: 'other-source' }, expected), false);
  assert.equal(canReplaceVideoCaptions({ ...expected, subtitleUrl: 'new-vtt' }, expected), false);
  assert.equal(canReplaceVideoCaptions({ ...expected, transcriptUrl: 'new-json' }, expected), false);
  assert.equal(canReplaceVideoCaptions(undefined, expected), false);
  assert.equal(canReplaceVideoCaptions({ ...expected, localUrl: undefined }, expected), false);
});

test('closing or changing a card cancels imports before storing or returning a replacement', async () => {
  const early = new AbortController(); early.abort();
  let writes = 0;
  await assert.rejects(importVideoCaptionFile(new File([srt], 'lesson.srt'), async () => { writes++; return ['a', 'b']; }, early.signal), { name: 'AbortError' });
  assert.equal(writes, 0);
  const during = new AbortController();
  await assert.rejects(importVideoCaptionFile(new File([srt], 'lesson.srt'), async () => { during.abort(); return ['new-json', 'new-vtt']; }, during.signal), { name: 'AbortError' });
});
