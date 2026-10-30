import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPdfBibliography, bibliographyTitlesMatch, pdfBibliographyLines } from '../lib/pdf-bibliography-extract.ts';
import { BibliographyLookupError, lookupDoiBibliography, readPdfBibliographyDocument } from '../app/pdf-bibliography.ts';
import { validBibliography, validBibliographyFields } from '../lib/bibliography.ts';

const title = 'Literature review as a research methodology: An overview and guidelines';
const doi = '10.1016/j.jbusres.2019.07.039';
const line = (text, size = 10) => ({ text, size });
const metadata = (info = {}, xmp = {}) => ({ info, metadata: { getAll: () => xmp } });
const content = text => ({ items: [{ str: text, hasEOL: true, transform: [1, 0, 0, 12, 0, 700], height: 12 }] });
const doc = (extra = {}) => ({ numPages: 1, getMetadata: async () => metadata({ Title: title }), getPage: async () => ({ getTextContent: async () => content(`doi: ${doi}`) }), ...extra });

void test('structured publication metadata is extracted without using PDF creation dates', () => {
  const result = extractPdfBibliography({ info: { Title: title, Author: 'Microsoft Word', CreationDate: 'D:20261021110000', Creator: 'Jane Doe' }, xmp: {
    'dc:creator': ['Hannah Snyder'], 'prism:publicationDate': '2019-07-25', 'prism:publicationName': 'Journal of Business Research',
    'prism:doi': doi, 'prism:volume': '104', 'prism:number': '2', 'prism:startingPage': '333', 'prism:endingPage': '339',
  } });
  assert.deepEqual(result.fields, { title, authors: ['Hannah Snyder'], year: 2019, journal: 'Journal of Business Research', doi, volume: '104', issue: '2', pages: '333–339' });
  assert.equal(result.ambiguousDoi, false);
});

void test('software, logins, Creator, Producer and CreationDate cannot become author or publication year', () => {
  for (const author of ['sampleuser', 'root', 'Administrator', 'Microsoft Corporation', 'Adobe Acrobat', 'Springer Nature', 'Department of Management']) {
    const result = extractPdfBibliography({ info: { Author: author, Creator: 'John Smith', Producer: 'Jane Doe', CreationDate: 'D:20261021', ModDate: 'D:20261021' } });
    assert.equal(result.fields.authors, undefined, author);
    assert.equal(result.fields.year, undefined, author);
  }
});

void test('human name lists from metadata retain ordered authors including Chinese names', () => {
  const result = extractPdfBibliography({ info: { Author: 'John Smith; Jane Doe and 李明' } });
  assert.deepEqual(result.fields.authors, ['John Smith', 'Jane Doe', '李明']);
});

void test('short Chinese titles and authors are supported without treating an abstract heading as an author', () => {
  const chineseTitle = '人工智能信任研究';
  const local = extractPdfBibliography({ info: { Title: chineseTitle }, pages: [[line(chineseTitle, 18), line('摘要', 10)]] });
  assert.equal(local.fields.title, chineseTitle);
  assert.equal(local.fields.authors, undefined);
  assert.equal(bibliographyTitlesMatch(chineseTitle, chineseTitle), true);
  assert.equal(bibliographyTitlesMatch(chineseTitle, '人工智能使用研究'), false);
  assert.deepEqual(extractPdfBibliography({ info: { Author: '张三 李四' } }).fields.authors, ['张三', '李四']);
});

void test('current PDF.js lowercase XMP keys and custom DOI maps are understood', async () => {
  const xmp = { 'dc:title': title, 'dc:creator': ['Hannah Snyder'], 'prism:publicationdate': '2019-07-25', 'prism:publicationname': 'Journal of Business Research', 'prism:doi': doi };
  const result = await readPdfBibliographyDocument(Promise.resolve(doc({ getMetadata: async () => ({ info: {}, metadata: { get: key => xmp[key] } }) })), { lookup: async () => ({ title, doi, year: 2019 }) });
  assert.equal(result.status, 'resolved');
  assert.equal(result.journal, 'Journal of Business Research');
  assert.deepEqual(result.authors, ['Hannah Snyder']);
  const custom = extractPdfBibliography({ info: { Title: title, Custom: new Map([['DOI', doi], ['Journal', 'Journal of Business Research']]) } });
  assert.equal(custom.fields.doi, doi);
  assert.equal(custom.fields.journal, 'Journal of Business Research');
});

void test('C0 and C1 controls become whitespace in every local field without merging newline-separated authors', async () => {
  for (const control of ['\u0000', '\u0007', '\u001f', '\u007f', '\u0085', '\u009f']) {
    const snapshot = { info: { Title: `Literature${control}review methods`, Author: `John${control}Smith\nJane Doe`, DOI: `${doi}${control}unrelated text` }, xmp: {
      'prism:publicationName': `Journal${control}of Business Research`, 'prism:publicationDate': `${control}2019-07-25`,
      'prism:volume': `${control}104`, 'prism:number': `2${control}`, 'prism:startingPage': `${control}333`, 'prism:endingPage': `339${control}`,
    } };
    const extracted = extractPdfBibliography(snapshot);
    assert.equal(extracted.fields.title, 'Literature review methods');
    assert.deepEqual(extracted.fields.authors, ['John Smith', 'Jane Doe']);
    assert.equal(extracted.fields.doi, doi);
    assert.equal(extracted.fields.journal, 'Journal of Business Research');
    assert.equal(validBibliographyFields(extracted.fields), true);
    assert.equal(validBibliography({ ...extracted.fields, status: 'review' }), true);
    const result = await readPdfBibliographyDocument(Promise.resolve(doc({ getMetadata: async () => metadata(snapshot.info, snapshot.xmp), getPage: async () => ({ getTextContent: async () => content(`First${control}page text`) }) })), { lookup: async () => { throw new Error('offline'); } });
    assert.equal(validBibliography(result), true);
    assert.equal(result.status, 'review');
    assert.deepEqual(result.authors, ['John Smith', 'Jane Doe']);
  }
  const pageOnly = extractPdfBibliography({ pages: [pdfBibliographyLines([{ str: 'Research\u0085methodology overview', height: 18, hasEOL: true }, { str: 'John\u0085Smith', height: 10, hasEOL: true }, { str: `doi:${doi}\u009f trailing text`, height: 8 }])] });
  assert.equal(pageOnly.fields.title, 'Research methodology overview');
  assert.deepEqual(pageOnly.fields.authors, ['John Smith']);
  assert.equal(pageOnly.fields.doi, doi);
  assert.equal(validBibliography({ ...pageOnly.fields, status: 'review' }), true);
});

void test('a journal header and prominent first-page title produce only local candidates', () => {
  const result = extractPdfBibliography({ pages: [[
    line('Journal of Business Research 104 (2019) 333–339', 8), line(title, 18), line('Hannah Snyder', 11),
    line('Department of Marketing, University', 9), line('Abstract'), line('Body paragraphs mention many years such as 2026.'),
  ]] });
  assert.equal(result.fields.title, title);
  assert.deepEqual(result.fields.authors, ['Hannah Snyder']);
  assert.equal(result.fields.year, 2019);
  assert.equal(result.fields.journal, 'Journal of Business Research');
  assert.equal(result.fields.volume, '104');
  assert.equal(result.fields.pages, '333–339');
});

void test('arbitrary body years and file-like or software-generated titles are ignored', () => {
  for (const value of ['Untitled', 'Microsoft Word - paper.doc', 'draft.pdf', '/Users/example/paper.pdf']) {
    const result = extractPdfBibliography({ info: { Title: value }, pages: [[line('Text about research in 2020 and 2026.', 9)]] });
    assert.equal(result.fields.title, undefined);
    assert.equal(result.fields.year, undefined);
  }
});

void test('DOIs after a References heading are excluded rather than used as the document DOI', () => {
  const result = extractPdfBibliography({ info: { DOI: doi }, pages: [[line(title, 18), line('References'), line('Other article doi:10.1000/another')]] });
  assert.equal(result.fields.doi, doi);
  assert.equal(result.ambiguousDoi, false);
  assert.equal(extractPdfBibliography({ pages: [[line('参考文献'), line('10.1000/another')]] }).fields.doi, undefined);
});

void test('multiple distinct DOI candidates require confirmation while repeated identifiers are deduplicated', () => {
  const repeated = extractPdfBibliography({ info: { DOI: doi }, pages: [[line(`https://doi.org/${doi}.`)]] });
  assert.equal(repeated.fields.doi, doi);
  assert.equal(repeated.ambiguousDoi, false);
  const ambiguous = extractPdfBibliography({ info: { DOI: doi }, pages: [[line('doi:10.1000/other')]] });
  assert.equal(ambiguous.fields.doi, undefined);
  assert.equal(ambiguous.ambiguousDoi, true);
});

void test('title matching tolerates punctuation and case while rejecting unrelated or insufficient titles', () => {
  assert.equal(bibliographyTitlesMatch(title, title.toUpperCase().replace(':', ' —')), true);
  assert.equal(bibliographyTitlesMatch('AI', 'AI'), false);
  assert.equal(bibliographyTitlesMatch(title, 'Trust in generative artificial intelligence for university students'), false);
  assert.equal(bibliographyTitlesMatch(undefined, title), false);
});

void test('PDF text items are grouped by actual line breaks and coordinates with hard processing limits', () => {
  const result = pdfBibliographyLines([
    { str: 'Research', transform: [1, 0, 0, 18, 0, 700], height: 18 },
    { str: 'methods', transform: [1, 0, 0, 18, 100, 700], height: 18, hasEOL: true },
    { str: 'Jane Doe', transform: [1, 0, 0, 10, 0, 680], height: 10 },
    { str: 'Abstract', transform: [1, 0, 0, 10, 0, 650], height: 10 },
  ]);
  assert.deepEqual(result.map(item => item.text), ['Research methods', 'Jane Doe', 'Abstract']);
  assert.equal(result[0].size, 18);
  assert.ok(pdfBibliographyLines(Array.from({ length: 10000 }, () => ({ str: 'Text', hasEOL: true }))).length <= 500);
});

void test('a verified matching DOI enriches fields and reads no more than two pages', async () => {
  const pages = [], lookups = [];
  const result = await readPdfBibliographyDocument(Promise.resolve(doc({ numPages: 500, getPage: async number => {
    pages.push(number); return { getTextContent: async () => content(number === 1 ? `doi:${doi}` : 'Body text') };
  } })), { lookup: async (...args) => { lookups.push(args); return { title, doi, authors: ['Hannah Snyder'], year: 2019 }; } });
  assert.deepEqual(pages, [1, 2]);
  assert.equal(lookups.length, 1);
  assert.equal(lookups[0][0], doi);
  assert.ok(lookups[0][1] instanceof AbortSignal);
  assert.equal(result.status, 'resolved');
  assert.deepEqual(result.authors, ['Hannah Snyder']);
  assert.equal(result.origins.authors, 'doi');
});

void test('an unrelated DOI response never replaces the locally identified paper', async () => {
  const result = await readPdfBibliographyDocument(Promise.resolve(doc()), { lookup: async () => ({ title: 'A different scientific article on machine learning', doi, authors: ['Wrong Author'], year: 2020 }) });
  assert.equal(result.status, 'review');
  assert.equal(result.reason, 'mismatch');
  assert.equal(result.title, title);
  assert.equal(result.authors, undefined);
  assert.equal(result.year, undefined);
});

void test('a DOI without a local title never imports a potentially cited work as the document identity', async () => {
  let lookups = 0;
  const result = await readPdfBibliographyDocument(Promise.resolve(doc({ getMetadata: async () => metadata() })), { lookup: async () => { lookups++; return { title, doi, authors: ['Wrong Author'], year: 2019 }; } });
  assert.equal(result.title, undefined);
  assert.equal(result.authors, undefined);
  assert.equal(result.year, undefined);
  assert.equal(result.status, 'review');
  assert.equal(result.doi, doi);
  assert.equal(lookups, 0);
});

void test('ambiguous identifiers are not sent to the lookup endpoint', async () => {
  let lookups = 0;
  const result = await readPdfBibliographyDocument(Promise.resolve(doc({ getPage: async () => ({ getTextContent: async () => content(`doi:${doi} and 10.1000/other`) }) })), { lookup: async () => { lookups++; return {}; } });
  assert.equal(result.reason, 'ambiguous');
  assert.equal(result.doi, undefined);
  assert.equal(lookups, 0);
});

void test('lookup failure preserves local candidates and reports a retryable network result', async () => {
  const result = await readPdfBibliographyDocument(Promise.resolve(doc()), { lookup: async () => { throw new Error('offline'); } });
  assert.equal(result.title, title);
  assert.equal(result.doi, doi);
  assert.equal(result.status, 'review');
  assert.equal(result.reason, 'network');
});

void test('missing DOI records remain local candidates rather than a misleading success', async () => {
  const result = await readPdfBibliographyDocument(Promise.resolve(doc()), { lookup: async () => { throw new BibliographyLookupError('no-match'); } });
  assert.equal(result.reason, 'no-match');
  assert.equal(result.status, 'review');
});

void test('a damaged PDF or scanned page returns an unavailable result without rejecting the import', async () => {
  const damaged = await readPdfBibliographyDocument(Promise.reject(new Error('bad PDF')));
  assert.equal(damaged.status, 'unavailable');
  const scanned = await readPdfBibliographyDocument(Promise.resolve(doc({ getMetadata: async () => metadata({ CreationDate: 'D:20261021' }), getPage: async () => ({ getTextContent: async () => ({ items: [] }) }) })));
  assert.equal(scanned.status, 'unavailable');
  assert.equal(scanned.reason, 'no-text');
  assert.equal(scanned.year, undefined);
});

void test('PDF metadata failures still permit extraction from the readable first page', async () => {
  const result = await readPdfBibliographyDocument(Promise.resolve(doc({ getMetadata: async () => { throw new Error('bad metadata'); }, getPage: async () => ({ getTextContent: async () => ({ items: [{ str: title, hasEOL: true, height: 18 }] }) }) })));
  assert.equal(result.title, title);
  assert.equal(result.status, 'review');
});

void test('stalled PDF promises and text extraction have bounded wait times and retain collected candidates', async () => {
  const never = new Promise(() => {}), started = Date.now();
  const unloaded = await readPdfBibliographyDocument(never, { timeoutMs: 20 });
  const stalledText = await readPdfBibliographyDocument(Promise.resolve(doc({ getPage: async () => ({ getTextContent: () => never }) })), { timeoutMs: 20 });
  assert.ok(Date.now() - started < 1000);
  assert.equal(unloaded.status, 'unavailable');
  assert.equal(stalledText.title, title);
  assert.equal(stalledText.status, 'review');
  assert.equal(stalledText.reason, 'network');
});

void test('caller cancellation rejects promptly so deleted files and switched workspaces receive no result', async () => {
  const controller = new AbortController();
  const promise = readPdfBibliographyDocument(new Promise(() => {}), { signal: controller.signal });
  controller.abort();
  await assert.rejects(promise, error => error.name === 'AbortError');
});

void test('the DOI request sends only a normalized identifier and validates the returned identity', async () => {
  const previous = globalThis.fetch, requests = [];
  try {
    globalThis.fetch = async (...args) => { requests.push(args); return Response.json({ bibliography: { title, doi, year: 2019 } }); };
    const result = await lookupDoiBibliography(`https://doi.org/${doi.toUpperCase()}`);
    assert.deepEqual(result, { title, doi, year: 2019 });
    assert.equal(requests[0][0], '/api/bibliography');
    assert.deepEqual(JSON.parse(requests[0][1].body), { doi });
    assert.deepEqual(Object.keys(JSON.parse(requests[0][1].body)), ['doi']);
    globalThis.fetch = async () => Response.json({ bibliography: { title, doi: '10.1000/wrong' } });
    await assert.rejects(lookupDoiBibliography(doi), error => error.code === 'invalid-response');
    globalThis.fetch = async () => Response.json({ bibliography: { title, doi, authors: ['Jane'], extra: 'untrusted' } });
    await assert.rejects(lookupDoiBibliography(doi), error => error.code === 'invalid-response');
    globalThis.fetch = async () => new Response('', { status: 404 });
    await assert.rejects(lookupDoiBibliography(doi), error => error.code === 'no-match');
  } finally { globalThis.fetch = previous; }
});

void test('invalid DOI and already cancelled lookup do not initiate any network request', async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = async () => { assert.fail('should not fetch'); };
    await assert.rejects(lookupDoiBibliography('https://example.com/paper.pdf'), error => error.code === 'invalid-doi');
    const controller = new AbortController(); controller.abort();
    await assert.rejects(lookupDoiBibliography(doi, controller.signal), error => error.name === 'AbortError');
  } finally { globalThis.fetch = previous; }
});
