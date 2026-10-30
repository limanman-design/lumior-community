import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoLinkService } from '../lib/video-link-service.ts';

const bv = 'BV1B7411m7LV';
const request = (url = 'https://b23.tv/abc', changes = {}) => new Request('http://127.0.0.1:5173/api/video-link', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:5173', Cookie: 'private=true', Authorization: 'secret' }, body: JSON.stringify({ url }), ...changes });

void test('short-link service returns canonical video metadata without fetching the destination or forwarding credentials', async () => {
  const calls = [];
  const service = createVideoLinkService(async (url, options) => {
    calls.push(url);
    assert.equal(options.redirect, 'manual');
    assert.equal(options.credentials, 'omit');
    assert.equal(new Headers(options.headers).has('cookie'), false);
    assert.equal(new Headers(options.headers).has('authorization'), false);
    assert.equal(options.signal instanceof AbortSignal, true);
    return new Response(null, { status: 302, headers: { Location: `https://www.bilibili.com/video/${bv}/?p=3&share_source=copy` } });
  });
  const response = await service(request('http://b23.tv/abc?tracking=discard'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { url: `https://www.bilibili.com/video/${bv}/?p=3` });
  assert.deepEqual(calls, ['https://b23.tv/abc']);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

void test('redirect resolver permits a bounded chain of short links and rejects loops', async () => {
  const calls = [];
  const service = createVideoLinkService(async url => {
    calls.push(url);
    const target = url.endsWith('abc') ? '/xyz' : `https://www.bilibili.com/video/${bv}/`;
    return new Response(null, { status: 307, headers: { Location: target } });
  });
  assert.equal((await service(request())).status, 200);
  assert.deepEqual(calls, ['https://b23.tv/abc', 'https://b23.tv/xyz']);
  let attempts = 0;
  const loop = createVideoLinkService(async () => { attempts++; return new Response(null, { status: 302, headers: { Location: '/abc' } }); });
  assert.equal((await loop(request())).status, 422);
  assert.equal(attempts, 1);
  attempts = 0;
  const long = createVideoLinkService(async () => new Response(null, { status: 302, headers: { Location: `/step${++attempts}` } }));
  assert.equal((await long(request())).status, 422);
  assert.equal(attempts, 3);
});

void test('redirect destinations cannot trigger private, unrelated, forged or unsafe network requests', async () => {
  for (const target of ['http://127.0.0.1:80/private', 'http://169.254.169.254/latest/meta-data', 'https://10.0.0.1/', 'https://b23.tv.evil.test/abc', 'https://www.bilibili.com.evil.test/video/' + bv, 'https://user@b23.tv/abc', 'https://www.bilibili.com/bangumi/play/ep1', 'javascript:alert(1)', 'https://youtu.be/M7lc1UVf-VE', 'https://b23.tv:444/abc']) {
    const calls = [];
    const service = createVideoLinkService(async url => { calls.push(url); return new Response(null, { status: 302, headers: { Location: target } }); });
    assert.equal((await service(request())).status, 422, target);
    assert.deepEqual(calls, ['https://b23.tv/abc'], target);
  }
});

void test('only small, local, same-origin JSON requests with exact b23 hosts may fetch', async () => {
  const service = createVideoLinkService(async () => { throw new Error('Should never fetch'); });
  assert.equal((await service(request('https://127.0.0.1/abc'))).status, 400);
  assert.equal((await service(request('https://b23.tv.evil.test/abc'))).status, 400);
  assert.equal((await service(request('https://b23.tv/abc', { headers: { 'Content-Type': 'application/json', Origin: 'https://evil.test' } }))).status, 403);
  assert.equal((await service(new Request('https://lumior.example/api/video-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"url":"https://b23.tv/abc"}' }))).status, 403);
  assert.equal((await service(request(undefined, { headers: { 'Content-Type': 'text/plain' } }))).status, 415);
  assert.equal((await service(request(undefined, { body: 'x'.repeat(4097) }))).status, 413);
  assert.equal((await service(request(undefined, { body: '{broken' }))).status, 400);
});

void test('network and missing redirects fail with a long-link fallback', async () => {
  for (const fetcher of [async () => { throw new Error('offline'); }, async () => new Response('html'), async () => new Response(null, { status: 302 })]) {
    const response = await createVideoLinkService(fetcher)(request());
    assert.equal(response.status, 422);
    assert.match((await response.json()).error, /完整视频地址/);
  }
});
