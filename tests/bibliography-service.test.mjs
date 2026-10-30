import test from 'node:test';
import assert from 'node:assert/strict';
import { createBibliographyService } from '../lib/bibliography-service.ts';

const doi = '10.1371/journal.pcbi.1003149';
const work = (patch = {}) => ({ DOI: doi, title: ['Ten Simple Rules for Writing a Literature Review'],
  author: [{ given: 'Marco', family: 'Pautasso' }], 'container-title': ['PLOS Computational Biology'],
  'published-print': { 'date-parts': [[2013, 7, 18]] }, type: 'journal-article', volume: '9', issue: '7', page: 'e1003149', ...patch,
});
const providerResponse = (patch = {}, options) => Response.json({ status: 'ok', 'message-type': 'work', message: work(patch) }, options);
const request = (body = { doi }, options = {}) => new Request('http://127.0.0.1:43825/api/bibliography', {
  method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:43825' },
  body: JSON.stringify(body), ...options,
});

void test('DOI-only lookup uses fixed encoded HTTPS endpoint and canonical DOI URL', async () => {
  const calls = [];
  const service = createBibliographyService(async (url, options) => {
    calls.push({ url, options });
    return providerResponse();
  });
  const response = await service.POST(request({ doi: `https://doi.org/${doi.toUpperCase()}`, title: 'PRIVATE_TITLE', pdf: 'PRIVATE_PDF' }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { bibliography: { doi, title: 'Ten Simple Rules for Writing a Literature Review',
    authors: ['Marco Pautasso'], year: 2013, journal: 'PLOS Computational Biology', type: 'journal-article',
    volume: '9', issue: '7', pages: 'e1003149', url: `https://doi.org/${doi}`,
  } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://api.crossref.org/works/${encodeURIComponent(doi)}`);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.redirect, 'manual');
  assert.equal(calls[0].options.body, undefined);
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.ok(!JSON.stringify(calls).includes('PRIVATE_'));
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

void test('rejects non-loopback hosts and cross-origin callers before any external call', async () => {
  let calls = 0;
  const service = createBibliographyService(async () => { calls++; return providerResponse(); });
  for (const url of ['https://lumior.work/api/bibliography', 'http://127.0.0.1.attacker.test/api/bibliography', 'http://192.168.1.1/api/bibliography']) {
    assert.equal((await service.POST(new Request(url, { method: 'POST', body: '{}' }))).status, 403);
  }
  for (const origin of ['https://attacker.test', 'http://localhost:43825', 'null']) {
    assert.equal((await service.POST(request({ doi }, { headers: { 'content-type': 'application/json', origin } }))).status, 403);
  }
  assert.equal(calls, 0);
});

void test('accepts localhost and IPv6 loopback with matching or absent origin', async () => {
  for (const host of ['localhost', '[::1]']) {
    const service = createBibliographyService(async () => providerResponse());
    const response = await service.POST(new Request(`http://${host}:43825/api/bibliography`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ doi }),
    }));
    assert.equal(response.status, 200);
  }
});

void test('invalid DOI and malformed JSON never contact a provider', async () => {
  let calls = 0;
  const service = createBibliographyService(async () => { calls++; return providerResponse(); });
  for (const value of [undefined, null, '', 1, true, [], {}, 'https://attacker.test/file', '10.1234/a\nInjected', '10.1234/<script>', '10.1234/a b', `10.1234/${'a'.repeat(260)}`]) {
    const response = await service.POST(request({ doi: value }));
    assert.equal(response.status, 400, JSON.stringify(value));
  }
  for (const value of [null, [], 42, 'text']) assert.equal((await service.POST(request(value))).status, 400);
  assert.equal((await service.POST(request(undefined, { body: '{bad json' }))).status, 400);
  assert.equal((await service.POST(request({ doi }, { headers: { 'content-type': 'text/plain' } }))).status, 415);
  assert.equal(calls, 0);
});

void test('request length is bounded even without a content-length header', async () => {
  let calls = 0;
  const service = createBibliographyService(async () => { calls++; return providerResponse(); });
  assert.equal((await service.POST(request({ doi, pdf: 'a'.repeat(3000) }))).status, 413);
  assert.equal((await service.POST(request({ doi }, { headers: { 'content-type': 'application/json', 'content-length': '3000' } }))).status, 413);
  assert.equal(calls, 0);
});

void test('returns honest Crossref-only not-found message without chasing arbitrary links', async () => {
  let calls = 0;
  const service = createBibliographyService(async () => { calls++; return new Response('not found', { status: 404 }); });
  for (let i = 0; i < 2; i++) {
    const response = await service.POST(request());
    assert.equal(response.status, 404);
    assert.match((await response.json()).error, /Crossref 未找到.*手动填写/);
  }
  assert.equal(calls, 2, 'failed lookups are not cached');
});

void test('rejects mismatched DOI, collection envelopes and malformed provider JSON', async () => {
  const responses = [providerResponse({ DOI: '10.1000/different' }), providerResponse({ DOI: undefined }),
    Response.json({ status: 'ok', 'message-type': 'work-list', message: work() }),
    new Response('{broken', { headers: { 'content-type': 'application/json' } }),
    new Response('<html>Login required</html>', { headers: { 'content-type': 'text/html' } }),
  ];
  for (const item of responses) {
    const response = await createBibliographyService(async () => item).POST(request());
    assert.equal(response.status, 502);
    assert.equal(typeof (await response.json()).error, 'string');
  }
});

void test('publication year prioritizes print, published, issued, online and never created', async () => {
  const date = year => ({ 'date-parts': [[year]] });
  const cases = [
    [{ 'published-print': date(2015), published: date(2014), issued: date(2013), 'published-online': date(2012) }, 2015],
    [{ 'published-print': undefined, published: date(2014), issued: date(2013), 'published-online': date(2012) }, 2014],
    [{ 'published-print': undefined, published: undefined, issued: date(2013), 'published-online': date(2012) }, 2013],
    [{ 'published-print': undefined, published: undefined, issued: undefined, 'published-online': date(2012) }, 2012],
    [{ 'published-print': undefined, created: date(2026), deposited: date(2026), indexed: date(2026) }, undefined],
    [{ 'published-print': date('2013'), published: date(2014) }, 2014],
    [{ 'published-print': date(2013.5) }, undefined],
  ];
  for (const [patch, expected] of cases) {
    const response = await createBibliographyService(async () => providerResponse(patch)).POST(request());
    const bibliography = (await response.json()).bibliography;
    assert.equal(bibliography.year, expected);
  }
});

void test('authors retain source order and use given-family order with organization names', async () => {
  const response = await createBibliographyService(async () => providerResponse({ author: [
    { given: 'Hannah', family: 'Snyder' }, { name: 'Research Working Group' }, { family: 'Wang' },
    { given: ' Andy ', family: ' Tay ' }, null, 'bad', { name: 42 },
  ] })).POST(request());
  assert.deepEqual((await response.json()).bibliography.authors,
    ['Hannah Snyder', 'Research Working Group', 'Wang', 'Andy Tay']);
});

void test('all strings are bounded plain text and unsafe provider destination is ignored', async () => {
  const response = await createBibliographyService(async () => providerResponse({
    title: ['A <jats:italic>review</jats:italic> &amp; evidence &lt;b&gt;guide&lt;/b&gt;'],
    author: [{ given: '<script>bad()</script>Andy', family: '<i>Tay</i>' }],
    'container-title': ['Journal\u0000 &amp; <b>Methods</b>'],
    volume: 'x'.repeat(301), issue: 7, page: ' 1–9 ', URL: 'javascript:alert(1)',
    type: '<b>journal-article</b>',
  })).POST(request());
  const bibliography = (await response.json()).bibliography;
  assert.equal(bibliography.title, 'A review & evidence guide');
  assert.deepEqual(bibliography.authors, ['Andy Tay']);
  assert.equal(bibliography.journal, 'Journal & Methods');
  assert.equal(bibliography.volume, undefined);
  assert.equal(bibliography.issue, undefined);
  assert.equal(bibliography.pages, '1–9');
  assert.equal(bibliography.type, 'journal-article');
  assert.equal(bibliography.url, `https://doi.org/${doi}`);
  assert.ok(!JSON.stringify(bibliography).includes('<'));
});

void test('journal-article remains the registry type and does not claim a research-paper subtype', async () => {
  for (const type of ['journal-article', 'editorial', 'peer-review', 'book-chapter', 'posted-content']) {
    const response = await createBibliographyService(async () => providerResponse({ type })).POST(request());
    assert.equal((await response.json()).bibliography.type, type);
  }
});

void test('book and proceedings containers are not mislabeled as journals', async () => {
  for (const type of ['book-chapter', 'proceedings-article', 'posted-content', undefined]) {
    const response = await createBibliographyService(async () => providerResponse({ type,
      'container-title': ['A Book or Conference Proceedings'],
    })).POST(request());
    const bibliography = (await response.json()).bibliography;
    assert.equal(bibliography.journal, undefined);
    assert.equal(bibliography.type, type);
    assert.equal(bibliography.year, 2013);
  }
});

void test('upstream redirect, error, timeout and unavailable service produce safe errors', async () => {
  const cases = [
    [async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } }), 502],
    [async () => new Response('private provider diagnostic', { status: 401 }), 502],
    [async () => new Response('private provider diagnostic', { status: 429 }), 503],
    [async () => new Response('private provider diagnostic', { status: 503 }), 503],
    [async () => { throw new DOMException('private timeout detail', 'TimeoutError'); }, 504],
    [async () => { throw new Error('private network detail'); }, 502],
  ];
  for (const [fetcher, expected] of cases) {
    const response = await createBibliographyService(fetcher).POST(request());
    assert.equal(response.status, expected);
    assert.ok(!(await response.text()).includes('private'));
  }
});

void test('Workerd-compatible manual redirects are rejected without following the destination', async () => {
  const calls = [];
  const service = createBibliographyService(async (url, options) => {
    calls.push(url);
    if (!['follow', 'manual'].includes(options.redirect)) throw new TypeError('Invalid redirect value');
    assert.equal(options.redirect, 'manual');
    return new Response(null, { status: 307, headers: { location: 'https://attacker.test/metadata' } });
  });
  const response = await service.POST(request());
  assert.equal(response.status, 502);
  assert.deepEqual(calls, [`https://api.crossref.org/works/${encodeURIComponent(doi)}`]);
  assert.deepEqual(Object.keys(await response.json()), ['error']);
});

void test('provider content is bounded by declared and actual size', async () => {
  let cancelled = 0;
  const declared = new Response(new ReadableStream({ cancel() { cancelled++; } }), {
    headers: { 'content-type': 'application/json', 'content-length': String(1024 * 1024 + 1) },
  });
  const oversized = new Response('a'.repeat(1024 * 1024 + 1), { headers: { 'content-type': 'application/json' } });
  for (const response of [declared, oversized]) {
    assert.equal((await createBibliographyService(async () => response).POST(request())).status, 502);
  }
  assert.equal(cancelled, 1);
});

void test('successful lookups cache normalized DOI and failures release concurrency slots', async () => {
  let calls = 0;
  const service = createBibliographyService(async () => { calls++; return calls === 1 ? new Response('', { status: 503 }) : providerResponse(); });
  assert.equal((await service.POST(request())).status, 503);
  assert.equal((await service.POST(request())).status, 200);
  assert.equal((await service.POST(request({ doi: doi.toUpperCase() }))).status, 200);
  assert.equal(calls, 2);
});

void test('bounds concurrent lookups and releases all slots after provider completion', async () => {
  const complete = [];
  let calls = 0;
  const service = createBibliographyService(async () => { calls++; await new Promise(resolve => complete.push(resolve)); return providerResponse(); });
  const requests = Array.from({ length: 4 }, () => service.POST(request()));
  while (complete.length < 4) await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal((await service.POST(request())).status, 429);
  assert.equal(calls, 4);
  for (const resolve of complete) resolve();
  for (const response of await Promise.all(requests)) assert.equal(response.status, 200);
  assert.equal((await service.POST(request())).status, 200);
});

void test('already aborted requests do not call provider and cancellation propagates to lookup', async () => {
  let calls = 0;
  const controller = new AbortController(); controller.abort();
  const service = createBibliographyService(async () => { calls++; return providerResponse(); });
  assert.equal((await service.POST(request({ doi }, { signal: controller.signal }))).status, 408);
  assert.equal(calls, 0);
  const second = new AbortController();
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const cancelled = createBibliographyService(async (_url, options) => {
    started();
    await new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
    return providerResponse();
  });
  const pending = cancelled.POST(request({ doi }, { signal: second.signal }));
  await ready; second.abort();
  assert.equal((await pending).status, 408);
});

void test('missing or invalid title does not discard other usable registry fields', async () => {
  for (const title of [[], ['x'.repeat(2001)]]) {
    const response = await createBibliographyService(async () => providerResponse({ title })).POST(request());
    assert.equal(response.status, 200);
    const fields = (await response.json()).bibliography;
    assert.equal(fields.title, undefined);
    assert.deepEqual(fields.authors, ['Marco Pautasso']);
  }
});
