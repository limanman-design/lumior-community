import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCnkiBibliography, lookupCnkiPage } from '../lib/cnki-bibliography.ts';
import { createBibliographyService } from '../lib/bibliography-service.ts';
const doi = '10.15897/j.cnki.cn51-1046/g2.20260622.001';
const html = readFileSync(new URL('./fixtures/bibliography/cnki-resolution.html', import.meta.url), 'utf8');
const page = value => new Response(value, { headers: { 'content-type': 'text/html;charset=utf-8' } });
const request = () => new Request('http://localhost/api/bibliography', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ doi }) });
test('real CNKI resolution fixture supplies title and author, never registration year or publisher as journal', () => {
  const fields = parseCnkiBibliography(html, doi);
  assert.equal(fields.title, '可控的不足：生成式人工智能道歉框架对用户信任韧性的影响研究');
  assert.deepEqual(fields.authors, ['伊靳涛']);
  assert.equal(fields.year, undefined); assert.equal(fields.journal, undefined);
  assert.equal(parseCnkiBibliography(html, '10.1234/wrong'), undefined);
});
test('citation metadata permits partial author-only records and strips markup', () => {
  const fields = parseCnkiBibliography(`<meta content="${doi}" name="citation_doi"><meta name='citation_author' content='A &amp; B'><meta name='citation_publication_date' content='2024/10/12'><meta name='citation_journal_title' content='Journal'>`, doi);
  assert.deepEqual(fields.authors, ['A & B']); assert.equal(fields.year, 2024); assert.equal(fields.title, undefined);
});
test('404 registry falls back through allowed DOI redirect and caches partial results', async () => {
  const calls = [];
  const service = createBibliographyService(async (url, options) => {
    calls.push(url); assert.equal(options.redirect, 'manual');
    if (url.includes('crossref')) return new Response('', { status: 404 });
    if (url.startsWith('https://doi.org/')) return new Response(null, { status: 302, headers: { location: `https://www.chndoi.org/Resolution/Handler?doi=${doi}` } });
    return page(html);
  });
  const result = await service.POST(request());
  assert.equal(result.status, 200); assert.deepEqual((await result.json()).bibliography.authors, ['伊靳涛']);
  await service.POST(request()); assert.equal(calls.length, 3);
});
test('incomplete registry keeps known fields and fills missing fields from webpage', async () => {
  const service = createBibliographyService(async url => url.includes('crossref') ? Response.json({ status:'ok', 'message-type':'work', message: { DOI:doi, title:['Registry title'], type:'journal-article' } }) : page(html));
  const fields = (await (await service.POST(request())).json()).bibliography;
  assert.equal(fields.title, 'Registry title'); assert.deepEqual(fields.authors,['伊靳涛']);
});
test('failed webpage preserves registry results and malformed DOI pages add nothing', async () => {
  for (const failure of ['network', 'mismatch']) {
    const service = createBibliographyService(async url => {
      if (url.includes('crossref')) return Response.json({ status:'ok', 'message-type':'work', message:{ DOI:doi, title:['Existing'] } });
      if (failure === 'network') throw new Error('offline');
      return page(html.replaceAll(doi, '10.1234/other'));
    });
    const fields = (await (await service.POST(request())).json()).bibliography;
    assert.equal(fields.title,'Existing'); assert.equal(fields.authors,undefined);
  }
});
test('unsafe redirects, non-html, oversized pages and redirect loops are bounded', async () => {
  for (const location of ['http://www.chndoi.org/a', 'https://127.0.0.1/a', 'https://cnki.net.evil.test/a', 'https://user@www.chndoi.org/a', 'https://www.chndoi.org:444/a']) {
    let calls=0;
    assert.equal(await lookupCnkiPage(doi, async()=>{ calls++; return new Response(null,{status:302,headers:{location}}); },new AbortController().signal),undefined);
    assert.equal(calls,1);
  }
  let calls=0;
  assert.equal(await lookupCnkiPage(doi, async()=>{ calls++; return new Response(null,{status:302,headers:{location:'https://doi.org/loop'}}); },new AbortController().signal),undefined);
  assert.equal(calls,5);
  for (const response of [new Response('{}',{headers:{'content-type':'application/json'}}),page('x'.repeat(1024*1024+1))]) {
    assert.equal(await lookupCnkiPage(doi,async()=>response,new AbortController().signal),undefined);
  }
});
