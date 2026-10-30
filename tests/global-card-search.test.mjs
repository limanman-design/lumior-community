import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'vite';
import { createGlobalCardSearchIndex, globalCardSearchLimit, globalCardSearchSnippet,
  searchGlobalCardIndex, shouldLocateFirstGlobalSearchResult } from '../app/global-card-search-model.ts';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const card = (id, patch = {}) => ({ id, title: 'A card', body: '', kind: 'note', x: 0, y: 0, width: 300, ...patch });
const board = (id, cards, title = id) => ({ id, title, cards, edges: [] });
const search = (boards, query, limit) => searchGlobalCardIndex(createGlobalCardSearchIndex(boards), query, limit);

void test('global search crosses board boundaries and keeps duplicate card IDs as separate locations', () => {
  const first = card('same', { title: 'Shared evidence', body: 'apple' });
  const second = card('same', { title: 'Shared evidence', body: 'banana' });
  const matches = search([board('a', [first], 'Reading'), board('b', [second], 'Research')], 'evidence');
  assert.deepEqual(matches.results.map(entry => entry.key), ['a:same', 'b:same']);
  assert.deepEqual(matches.results.map(entry => entry.boardTitle), ['Reading', 'Research']);
  assert.equal(matches.results[0].card, first);
  assert.equal(matches.results[1].card, second);
  assert.equal(search([board('a', [first]), board('b', [second])], 'banana').results[0].boardId, 'b');
});

void test('block documents override stale body and include nested text and tables', () => {
  const blocks = [{ type: 'paragraph', content: [{ type: 'text', text: 'Main evidence' }], children: [
    { type: 'paragraph', content: 'Nested reading' },
  ] }, { type: 'table', content: { type: 'tableContent', rows: [{ cells: [
    [{ type: 'text', text: 'Research method' }], [{ type: 'text', text: 'Interview' }],
  ] }] } }];
  const boards = [board('a', [card('blocks', { body: 'Discarded stale sentence', blocks })])];
  assert.equal(search(boards, 'nested interview').total, 1);
  assert.equal(search(boards, 'research method').total, 1);
  assert.equal(search(boards, 'stale').total, 0);
  assert.equal(search([board('a', [card('empty-block', { body: 'stale', blocks: [{ type: 'paragraph' }] })])], 'stale').total, 0);
});

void test('all card types search stored titles and body without expanding PDFs or videos', () => {
  const entries = [
    card('note', { kind: 'note', body: 'match note' }),
    card('text', { kind: 'text', body: 'match text' }),
    card('image', { kind: 'image', body: 'match image', image: 'lumior-file:image' }),
    card('pdf', { kind: 'pdf', body: 'match pdf', pdf: { name: 'paper.pdf', url: 'lumior-file:pdf',
      thumbnail: 'lumior-file:thumbnail', pages: 80, size: 900, translation: { text: 'hidden full document' } } }),
    card('video', { kind: 'video', body: 'match video', video: { url: 'lumior-file:video',
      poster: 'lumior-file:poster', duration: 30, transcriptUrl: 'https://example.com/private-transcript' } }),
  ];
  const matches = search([board('normal', entries)], 'match');
  assert.deepEqual(matches.results.map(entry => entry.card.kind), ['note', 'text', 'image', 'pdf', 'video']);
  assert.deepEqual(matches.results.slice(2).map(entry => entry.thumbnail), ['lumior-file:image', 'lumior-file:thumbnail', 'lumior-file:poster']);
  assert.equal(search([board('normal', entries)], 'hidden full document').total, 0);
  assert.equal(search([board('normal', entries)], 'private-transcript').total, 0);
});

void test('empty queries are inert and matches use case-insensitive terms with title priority', () => {
  const boards = [board('a', [card('body', { title: 'Other', body: 'Kimi research plan' }),
    card('title', { title: 'Kimi Research Plan' }), card('mixed', { title: 'Kimi', body: '研究方法' })])];
  for (const query of ['', '  ', '\n\t']) assert.deepEqual(search(boards, query), { results: [], total: 0, hasQuery: false });
  assert.deepEqual(search(boards, 'ＫＩＭＩ research').results.map(entry => entry.card.id), ['title', 'body']);
  assert.equal(search(boards, 'kimi 研究').results[0].card.id, 'mixed');
  assert.equal(search(boards, 'kimi absent').total, 0);
});

void test('caller board boundary excludes recycle-bin cards and board names are metadata only', () => {
  const snapshot = { boards: [board('normal', [card('keep', { body: 'Visible keyword' })], 'Hidden keyword')],
    deletedBoards: [{ board: board('trash', [card('deleted', { body: 'Recycled secret' })]), deletedAt: 1 }] };
  assert.equal(search(snapshot.boards, 'visible').results[0].card.id, 'keep');
  assert.equal(search(snapshot.boards, 'recycled').total, 0);
  assert.equal(search(snapshot.boards, 'hidden').total, 0);
});

void test('large match sets retain full counts while rendered results stay bounded', () => {
  const boards = [board('a', Array.from({ length: 200 }, (_, i) => card(`${i}`, { title: `match ${i}` })))];
  assert.equal(search(boards, 'match').total, 200);
  assert.equal(search(boards, 'match').results.length, globalCardSearchLimit);
  assert.equal(search(boards, 'match', 5).results.length, 5);
  assert.equal(search(boards, 'match', 5000).results.length, globalCardSearchLimit);
  assert.equal(search(boards, 'match', -1).results.length, 0);
});

void test('snippets expose matched body text without rendering markup or excessive text', () => {
  const body = `${'Prefix '.repeat(30)}needle ${'suffix '.repeat(40)}`;
  const snippet = globalCardSearchSnippet(body, 'needle');
  assert.match(snippet, /needle/);
  assert.match(snippet, /^…/);
  assert.ok(snippet.length <= 182);
  assert.equal(globalCardSearchSnippet('   ', 'text'), '');
});

void test('Enter locates only outside IME confirmation and ignores held-key repetition', () => {
  assert.equal(shouldLocateFirstGlobalSearchResult({ key: 'Enter' }), true);
  for (const event of [{ key: 'Escape' }, { key: 'Enter', isComposing: true },
    { key: 'Enter', keyCode: 229 }, { key: 'Enter', repeat: true }]) {
    assert.equal(shouldLocateFirstGlobalSearchResult(event), false);
  }
});

void test('SSR renders distinct board locations, type icons and escaped text without loading card viewers', async () => {
  const temporary = await mkdtemp(join(root, 'tests', '.global-card-search-'));
  try {
    const entry = join(temporary, 'search.mjs');
    await build({ configFile: false, resolve: { alias: { '@': root } }, logLevel: 'silent', build: {
      ssr: join(root, 'app/global-card-search.tsx'), outDir: temporary, emptyOutDir: false, minify: false,
      rolldownOptions: { output: { format: 'es', entryFileNames: 'search.mjs' } },
    } });
    const { GlobalCardSearch, GlobalCardSearchResults } = await import(pathToFileURL(entry).href);
    const boards = [board('one', [card('same', { title: '<img onerror=alert(1)>', body: 'Search result text' })], 'First board'),
      board('two', [card('same', { title: 'Search video', body: 'Search again', kind: 'video',
        video: { url: 'https://youtube.com/watch?v=abcdef', poster: 'lumior-file:poster', duration: 3 } })], 'Second board')];
    const html = renderToStaticMarkup(React.createElement(GlobalCardSearchResults, {
      results: createGlobalCardSearchIndex(boards), query: 'search', onChoose: () => {},
    }));
    assert.equal((html.match(/<button /g) || []).length, 2);
    assert.match(html, /data-board-id="one" data-card-id="same"/);
    assert.match(html, /data-board-id="two" data-card-id="same"/);
    assert.match(html, /First board/);
    assert.match(html, /Second board/);
    assert.match(html, /video-card\/video-type.svg/);
    assert.match(html, /loading="lazy" decoding="async"/);
    assert.match(html, /&lt;img onerror=alert\(1\)&gt;/);
    assert.doesNotMatch(html, /<iframe|<video|<canvas|<img onerror/);
    for (const open of [false, true]) assert.doesNotThrow(() => renderToStaticMarkup(React.createElement(GlobalCardSearch, {
      open, onOpenChange: () => {}, boards, onLocate: () => {},
    })));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
