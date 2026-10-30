import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { aiCitationFormat, citationNumbers, citationPlugin, historicalCitationText, invalidCitationTokens, normalizeCitationTokens, readableCitationText } from '../lib/ai-citations.ts';

const render = (text, format) => renderToStaticMarkup(React.createElement(Markdown, { remarkPlugins: [remarkGfm, citationPlugin(format)] }, text));

void test('explicit source tokens do not consume the paper bibliography or code and existing links', () => {
  const text = 'Paper [2], [99], [10,11]. Evidence [Lumior:2]. `value[0] [Lumior:5]`\n```md\n[Lumior:7]\n```\n\\[8] [Lumior:9](https://example.com)';
  assert.deepEqual(citationNumbers(text), [2]);
  assert.deepEqual(invalidCitationTokens(text, new Set([2])), []);
  assert.equal(normalizeCitationTokens('Evidence [LUMIOR: 002 ]. Paper [2].'), 'Evidence [Lumior:2]. Paper [2].');
});

void test('malformed, zero and unseen source tokens fail validation while valid variants canonicalize', () => {
  for (const token of ['[Lumior:0]', '[Lumior:-1]', '[Lumior:wrong]', '[Lumior:999]', '[Lumior:9007199254740992]', '[Lumior:2']) {
    assert.deepEqual(invalidCitationTokens(`Evidence ${token}`, new Set([1])), [token]);
  }
  assert.deepEqual(invalidCitationTokens('Evidence [Lumior:1', new Set([1])), ['[Lumior:1']);
  assert.deepEqual(citationNumbers('[lumior:001][Lumior:2][LUMIOR:1]'), [1, 2]);
});

void test('new Markdown only links explicit tokens; escaped original references remain ordinary text', () => {
  const output = render('Paper [2] and \\[2], source [Lumior:2]. `code [Lumior:2]`. [Lumior:1](https://example.com).', aiCitationFormat);
  assert.equal((output.match(/href="#lumior-citation-/g) || []).length, 1);
  assert.ok(output.includes('href="#lumior-citation-2" data-lumior-source="lumior-v1">[2]</a>'));
  assert.ok(output.includes('Paper [2] and [2]'));
  assert.ok(output.includes('<code>code [Lumior:2]</code>'));
  assert.ok(output.includes('href="https://example.com">Lumior:1</a>'));
});

void test('adjacent and escaped source markers cannot bypass validation or reserve another source target', () => {
  assert.deepEqual(citationNumbers('word[Lumior:2] and \\[Lumior:2]'), [2]);
  assert.deepEqual(invalidCitationTokens('word[Lumior:2] and \\[Lumior:2]', new Set([1])), ['[Lumior:2]']);
  assert.equal(normalizeCitationTokens('word[Lumior:1] and \\[Lumior:1]'), 'word[Lumior:1] and [Lumior:1]');
  assert.deepEqual(invalidCitationTokens('[Evidence](#lumior-citation-2)', new Set([1, 2])), ['#lumior-citation-2']);
  assert.deepEqual(invalidCitationTokens('`[Evidence](#lumior-citation-2)`', new Set()), []);
  const tree = { type: 'root', children: [{ type: 'paragraph', children: [
    { type: 'text', value: 'word[Lumior:1]' },
    { type: 'link', url: '#lumior-citation-2', children: [{ type: 'text', value: 'Evidence' }] },
  ] }] };
  citationPlugin(aiCitationFormat)()(tree);
  const links = tree.children[0].children.filter(node => node.type === 'link');
  assert.equal(links[0].data.hProperties['data-lumior-source'], 'lumior-v1');
  assert.equal(links[1].data, undefined); // Manual target cannot become a source button.
});

void test('actual Markdown list continuations and entities cannot bypass reviewed-source validation', () => {
  for (const suffix of ['\n\n- List item\n    [Lumior:2]', '\n\n1. List item\n    [Lumior:2]', ' Entity [Lumior&#58;2].', ' Entity &#91;Lumior:2&#93;.']) {
    const text = 'Allowed [Lumior:1].' + suffix;
    const output = render(text, aiCitationFormat);
    assert.ok(output.includes('href="#lumior-citation-2" data-lumior-source="lumior-v1"'));
    assert.deepEqual(citationNumbers(text), [1, 2]);
    assert.deepEqual(invalidCitationTokens(text, new Set([1])), ['[Lumior:2]']);
  }
  assert.deepEqual(citationNumbers('Allowed [Lumior:1].\n\n    [Lumior:2]\n\n```md\n[Lumior:3]'), [1]);
  assert.deepEqual(invalidCitationTokens('[Lumior&#58;1]', new Set([1])), ['[Lumior:1]']); // Repair to literal canonical syntax.
  assert.deepEqual(invalidCitationTokens('[Manual][ref]\n\n[ref]: #lumior-citation-2', new Set([1, 2])), ['#lumior-citation-2']);
});

void test('source normalization and readable copies preserve Markdown lists, tables and code', () => {
  const text = '| Fact | Evidence |\n| --- | --- |\n| Paper [99] | [LUMIOR: 001 ] |\n\n- Note [Lumior:1]\n  - Code `[Lumior:2]`';
  const canonical = text.replace('[LUMIOR: 001 ]', '[Lumior:1]');
  assert.equal(normalizeCitationTokens(text), canonical);
  assert.equal(readableCitationText(canonical, aiCitationFormat), canonical.replaceAll('[Lumior:1]', '[1]'));
  assert.equal(historicalCitationText('Old &#91;Lumior:1&#93; and paper [99].', aiCitationFormat), 'Old （历史来源 1） and paper [99].');
  assert.ok(render(canonical, aiCitationFormat).includes('<table>'));
});

void test('unversioned saved Markdown retains its numeric source links and does not reinterpret new syntax', () => {
  const output = render('Old source [2]. New-looking plain text [Lumior:1].');
  assert.equal((output.match(/href="#lumior-citation-/g) || []).length, 1);
  assert.ok(output.includes('href="#lumior-citation-2">[2]</a>'));
  assert.ok(output.includes('New-looking plain text [Lumior:1]'));
});

void test('copy and note creation get readable references; current-source syntax is removed from model history only', () => {
  const answer = 'Paper [99]. Application source [Lumior:1].';
  assert.equal(readableCitationText(answer, aiCitationFormat), 'Paper [99]. Application source [1].');
  assert.equal(readableCitationText('Old [1]'), 'Old [1]');
  assert.equal(historicalCitationText(answer, aiCitationFormat), 'Paper [99]. Application source （历史来源 1）.');
  assert.equal(historicalCitationText('Old source [1].'), 'Old source （历史来源 1）.');
  assert.equal(answer, 'Paper [99]. Application source [Lumior:1].');
});
