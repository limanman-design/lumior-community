import assert from 'node:assert/strict';
import test from 'node:test';
import { bilibiliEmbedUrl, bilibiliShortUrl, importVideoUrl, isBilibiliShortUrl, parseVideoUrl, resolveVideoUrl, validVideoProviderMetadata } from '../app/video-url.ts';
import { setLanguage } from '../app/i18n-core.ts';

const yt = 'M7lc1UVf-VE', bv = 'BV1B7411m7LV';

void test('YouTube formats normalize one complete URL and retain linked timestamps', () => {
  for (const url of [`https://www.youtube.com/watch?v=${yt}&feature=shared`, `https://youtu.be/${yt}`, `youtube.com/shorts/${yt}`, `https://m.youtube.com/live/${yt}`, `https://www.youtube-nocookie.com/embed/${yt}`]) {
    assert.deepEqual(parseVideoUrl(url), { provider: 'youtube', id: yt, url: `https://www.youtube.com/watch?v=${yt}` });
  }
  assert.equal(parseVideoUrl(`https://youtu.be/${yt}?t=1h2m3s`).startTime, 3723);
  assert.equal(parseVideoUrl(`https://www.youtube.com/watch?v=${yt}#t=45`).startTime, 45);
  assert.equal(parseVideoUrl(`https://www.youtube.com/embed/${yt}?start=90`).url, `https://www.youtube.com/watch?v=${yt}&t=90s`);
});

void test('Bilibili BV, av and selection links strip tracking and use the official embed parameters', () => {
  const parsed = parseVideoUrl(`http://m.bilibili.com/video/${bv}/?p=2&t=31&spm_id_from=example`);
  assert.deepEqual(parsed, { provider: 'bilibili', id: bv, url: `https://www.bilibili.com/video/${bv}/?p=2&t=31`, page: 2, startTime: 31 });
  const card = importVideoUrl(parsed.url);
  const embed = new URL(bilibiliEmbedUrl(card.video));
  assert.equal(embed.origin, 'https://player.bilibili.com');
  assert.equal(embed.searchParams.get('bvid'), bv);
  assert.equal(embed.searchParams.get('p'), '2');
  assert.equal(embed.searchParams.get('autoplay'), '0');
  assert.equal(embed.searchParams.get('t'), '31');
  assert.equal(card.kind, 'video');
  assert.equal(card.video.duration, 0);
  assert.equal(card.video.poster, '');
  assert.equal(card.title.endsWith('P2'), true);
  assert.equal(validVideoProviderMetadata(card.video), true);
  const av = importVideoUrl('https://www.bilibili.com/video/av170001');
  assert.equal(new URL(bilibiliEmbedUrl(av.video, true)).searchParams.get('aid'), '170001');
  assert.equal(new URL(bilibiliEmbedUrl(av.video, true)).searchParams.get('autoplay'), '1');
});

void test('URL recognition rejects dangerous schemes, spoofed hosts, credentials, unrelated paths and malformed IDs', () => {
  for (const url of [
    `javascript:alert(1)`, `data:text/html,https://youtu.be/${yt}`, `file:///tmp/${yt}`, `https://youtube.com.evil.test/watch?v=${yt}`,
    `https://www.bilibili.com.evil.test/video/${bv}`, `https://evil.test/@youtube.com/watch?v=${yt}`, `https://youtube.com@evil.test/watch?v=${yt}`,
    `https://user:pass@youtube.com/watch?v=${yt}`, `https://youtu.be:444/${yt}`, `https://www.youtube.com/watch?v=short`,
    `https://www.bilibili.com/video/BVinvalid`, 'https://www.bilibili.com/video/av0', `https://www.bilibili.com/video/${bv}?p=0`,
    `https://www.bilibili.com/video/${bv}?p=1.5`, `https://www.bilibili.com/video/${bv}?p=9007199254740992`,
    `https://www.youtube.com/playlist?list=${yt}`, `https://www.bilibili.com/bangumi/play/ep123`,
    `Watch this https://youtu.be/${yt}`, `https://youtu.be/${yt}\nhttps://youtu.be/${yt}`, `https://youtu.be/\\${yt}`,
  ]) assert.equal(parseVideoUrl(url), null, url);
});

void test('short links are identified separately and direct imports perform no network requests', async () => {
  assert.equal(isBilibiliShortUrl('https://b23.tv/abCD12?share_source=copy'), true);
  assert.equal(bilibiliShortUrl('http://www.b23.tv/abCD12/'), 'https://b23.tv/abCD12');
  for (const url of ['https://b23.tv.evil.test/abCD12', 'https://b23.tv/@target', 'https://b23.tv/a/b', 'https://user@b23.tv/abc', 'https://b23.tv/']) assert.equal(isBilibiliShortUrl(url), false);
  assert.equal(importVideoUrl('https://b23.tv/abc'), null);
  const result = await resolveVideoUrl(`https://youtu.be/${yt}`, undefined, async () => { throw new Error('Should not fetch'); });
  assert.equal(result.video.youtubeId, yt);
  assert.equal(await resolveVideoUrl('https://example.com/'), null);
});

void test('short-link client accepts only a checked Bilibili video result and gives actionable failure text', async () => {
  const result = await resolveVideoUrl('https://b23.tv/abc', undefined, async (url, options) => {
    assert.equal(url, '/api/video-link');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), { url: 'https://b23.tv/abc' });
    return Response.json({ url: `https://www.bilibili.com/video/${bv}/?p=2` });
  });
  assert.equal(result.video.bilibiliPage, 2);
  setLanguage('zh', false);
  try {
    for (const response of [Response.json({ url: 'https://evil.test/' }), Response.json({ url: `https://youtu.be/${yt}` }), new Response('', { status: 422 })]) {
      await assert.rejects(resolveVideoUrl('https://b23.tv/abc', undefined, async () => response), /复制完整/);
    }
  } finally { setLanguage('en', false); }
});

void test('new provider metadata validation preserves legacy videos while rejecting inconsistent embeds', () => {
  assert.equal(validVideoProviderMetadata({ url: '/video.mp4', localUrl: 'lumior-file:local', poster: '', duration: 12 }), true);
  assert.equal(validVideoProviderMetadata({ url: `https://youtu.be/${yt}`, youtubeId: yt, poster: '', duration: 0 }), true);
  const video = importVideoUrl(`https://www.bilibili.com/video/${bv}/?p=2`).video;
  for (const changed of [{ ...video, bilibiliId: 'bad' }, { ...video, bilibiliPage: 3 }, { ...video, startTime: -1 }, { ...video, url: 'https://evil.test/' }, { ...video, provider: 'other' }, { ...video, youtubeId: yt }, { ...video, localUrl: '/local.mp4' }]) {
    assert.equal(validVideoProviderMetadata(changed), false);
    assert.equal(bilibiliEmbedUrl(changed), null);
  }
});
