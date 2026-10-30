import test from 'node:test';
import assert from 'node:assert/strict';
import { awaitReadingTask, captionChunks, pageChunks, pdfPageText, relevantChunks } from '../app/document-reading.ts';
import { fetchVideoCues } from '../app/video-caption-loader.ts';
import { aiCorpus } from '../app/ai-context.ts';

const document = (chunks, kind = 'pdf') => ({ version: 1, key: 'file-version', kind, readAt: 1, total: 20, characters: chunks.reduce((sum, chunk) => sum + chunk.text.length, 0), emptyPages: [], chunks });
const card = (id, kind = 'pdf') => ({ id, title: `Document ${id}`, kind, body: '' });

test('PDF extraction preserves line breaks and Chinese text without inventing equations or empty-page text', () => {
  const items = [
    { str: 'First', transform: [1, 0, 0, 1, 0, 100] },
    { str: 'line', hasEOL: true, transform: [1, 0, 0, 1, 40, 100] },
    { str: '中', transform: [1, 0, 0, 1, 0, 88] },
    { str: '文。', transform: [1, 0, 0, 1, 10, 88] },
    { str: 'x\u0000²', transform: [1, 0, 0, 1, 0, 70] },
  ];
  assert.equal(pdfPageText(items), 'First line\n中文。\nx²');
  assert.equal(pdfPageText([{ type: 'beginMarkedContent' }]), '');
});

test('long PDF pages are covered completely by bounded overlapping passages with the original page number', () => {
  const original = 'A'.repeat(1550) + '\n' + 'B'.repeat(1900) + '\nLast sentence.';
  const chunks = pageChunks(original, 19);
  assert.ok(chunks.length > 2); assert.ok(chunks.every(chunk => chunk.page === 19 && chunk.text.length <= 1600));
  assert.ok(chunks[0].text.startsWith('A')); assert.ok(chunks.at(-1).text.endsWith('Last sentence.'));
  assert.ok(chunks[1].text.startsWith('A'.repeat(100))); // Boundary overlap retained.
  assert.deepEqual(pageChunks('', 1), []);
});

test('captions preserve timestamp zero, real gaps and bounds for exceptionally long cues', () => {
  const chunks = captionChunks([{ time: 0, end: 4, text: 'Opening' }, { time: 5, end: 10, text: 'Explanation' }, { time: 60, end: 65, text: 'After a pause' }, { time: 100, end: 110, text: 'x'.repeat(3500) }]);
  assert.deepEqual(chunks[0], { time: 0, end: 10, text: 'Opening Explanation' });
  assert.deepEqual(chunks[1], { time: 60, end: 65, text: 'After a pause' });
  assert.ok(chunks.slice(2).every(chunk => chunk.time === 100 && chunk.end === 110 && chunk.text.length <= 1600 && chunk.page === undefined));
});

test('local retrieval finds late PDF passages and Chinese text; broad queries spread across the document', () => {
  const input = document([{ text: 'Introduction', page: 1 }, { text: '设计空间中的探索循环', page: 7 }, { text: 'Visibility and affordances', page: 18 }, { text: 'Conclusion', page: 20 }]);
  assert.equal(relevantChunks(input, 'Explain affordances')[0].page, 18);
  assert.equal(relevantChunks(input, '探索循环是什么')[0].page, 7);
  assert.deepEqual(relevantChunks(input, '').map(chunk => chunk.page), [1, 18, 20]);
  assert.deepEqual(relevantChunks(document([]), 'anything'), []);
});

test('AI references include exact page and caption ranges while explicit selection excludes other files', () => {
  const cards = [card('pdf'), card('video', 'video'), card('unselected')];
  const readings = new Map([
    ['pdf', { status: 'ready', document: document([{ text: 'The key evidence appears late.', page: 18 }]) }],
    ['video', { status: 'ready', document: document([{ text: 'The key evidence is spoken.', time: 0, end: 25 }], 'video') }],
  ]);
  const context = aiCorpus(cards, ['video', 'pdf'], readings, 'key evidence');
  const original = context.sources.filter(source => source.fileKey);
  assert.equal(context.cardCount, 2); assert.deepEqual(original.map(source => source.id), ['video', 'pdf']);
  assert.equal(original[0].time, 0); assert.equal(original[0].end, 25);
  assert.equal(original[1].page, 18); assert.equal(original[1].fileKey, 'file-version');
  assert.ok(context.sources.every(source => !source.text.includes('Document unselected')));
});

test('research corpus preserves all cards and every document passage without per-card truncation', () => {
  const cards = Array.from({ length: 18 }, (_, index) => ({ ...card(`${index}`), body: 'd'.repeat(5900) }));
  const readings = new Map(cards.map(item => [item.id, { status: 'ready', document: document(Array.from({ length: 8 }, (_, index) => ({ text: 'Evidence '.repeat(300), page: index + 1 }))) }]));
  const context = aiCorpus(cards, [], readings);
  assert.equal(context.cardCount, 18);
  assert.equal(new Set(context.sources.map(source => source.id)).size, 18);
  assert.equal(context.sources.filter(source => source.fileKey).length, 18 * 8);
  for (const item of cards) assert.ok(context.sources.filter(source => source.id === item.id).reduce((sum, source) => sum + source.text.length, 0) > 20000);
  assert.ok(context.characters > 48000);
});

test('unreadable or missing documents keep honest statuses and no fabricated page citations', () => {
  const cards = [card('scan'), card('video', 'video')];
  const context = aiCorpus(cards, [], new Map([['scan', { status: 'empty', document: document([]) }], ['video', { status: 'error', message: '字幕文件无法读取' }]]));
  assert.match(context.readings[0].message, /没有可提取文字/);
  assert.equal(context.readings[1].status, 'error');
  assert.ok(context.sources.every(source => source.page === undefined && source.time === undefined && !source.fileKey));
});

test('video captions use existing JSON and fall back to SRT/VTT without uploading media', async () => {
  const calls = [];
  const fetcher = async url => { calls.push(url); return new Response(url === '/broken.json' ? '{}' : 'WEBVTT\n\n00:00:00.000 --> 00:00:04.000\nHello\n\n00:01:00.000 --> 00:01:05.000\nLater'); };
  const cues = await fetchVideoCues({ transcriptUrl: '/broken.json', subtitleUrl: '/captions.vtt' }, undefined, fetcher);
  assert.equal(cues[0].time, 0); assert.equal(cues[1].time, 60);
  assert.deepEqual(calls, ['/broken.json', '/captions.vtt']);
  assert.deepEqual(await fetchVideoCues({}, undefined, () => assert.fail('No caption URL must not fetch anything')), []);
});

test('caption cancellation does not silently fall back; oversized responses release their reader', async () => {
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  await assert.rejects(fetchVideoCues({ transcriptUrl: '/a', subtitleUrl: '/b' }, controller.signal, async () => { calls++; throw new DOMException('Aborted', 'AbortError'); }), { name: 'AbortError' });
  assert.equal(calls, 1);
  let cancelled = false;
  await assert.rejects(fetchVideoCues({ subtitleUrl: '/huge.vtt' }, undefined, async () => new Response(new ReadableStream({ start(stream) { stream.enqueue(new Uint8Array(8_000_001)); }, cancel() { cancelled = true; } }))), /8 MB/);
  assert.equal(cancelled, true);
});

test('local PDF waiting stops immediately even if the shared worker has not replied', async () => {
  const controller = new AbortController();
  const wait = awaitReadingTask(new Promise(() => {}), controller.signal);
  controller.abort(); await assert.rejects(wait, { name: 'AbortError' });
  assert.equal(await awaitReadingTask(Promise.resolve(42), new AbortController().signal), 42);
  await assert.rejects(awaitReadingTask(Promise.reject(new Error('Encrypted PDF')), new AbortController().signal), /Encrypted/);
});
