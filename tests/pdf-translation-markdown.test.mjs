import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTranslationMarkdown } from '../lib/pdf-translation-markdown.ts';

const textOf = block => block.runs.map(run => run.text).join('');

test('translation Markdown keeps title hierarchy, paragraphs, lists and quote order', () => {
  const blocks = parseTranslationMarkdown('# 论文标题\n\n第一行\n第二行。\n\n## 研究方法 ##\n- 第一项\n2. 第二项\n  + 嵌套项\n> 引用的\n> 后半段\n\n### Results\nEnglish soft\nwrap.');
  assert.deepEqual(blocks.map(({ kind, level, marker }) => ({ kind, level, marker })), [
    { kind: 'heading', level: 1, marker: undefined },
    { kind: 'paragraph', level: undefined, marker: undefined },
    { kind: 'heading', level: 2, marker: undefined },
    { kind: 'list', level: 0, marker: '-' },
    { kind: 'list', level: 0, marker: '2.' },
    { kind: 'list', level: 1, marker: '+' },
    { kind: 'quote', level: undefined, marker: undefined },
    { kind: 'heading', level: 3, marker: undefined },
    { kind: 'paragraph', level: undefined, marker: undefined },
  ]);
  assert.deepEqual(blocks.map(textOf), ['论文标题', '第一行第二行。', '研究方法', '第一项', '第二项', '嵌套项', '引用的后半段', 'Results', 'English soft wrap.']);
});

test('inline emphasis retains exact text and style boundaries including nested emphasis', () => {
  const [block] = parseTranslationMarkdown('中文**重点**，*斜体*、_强调_、***同时***，**strong *nested* text** 和 `a*b + x_y`。');
  assert.equal(textOf(block), '中文重点，斜体、强调、同时，strong nested text 和 a*b + x_y。');
  assert.ok(block.runs.some(run => run.text === '重点' && run.bold));
  assert.ok(block.runs.some(run => run.text === '斜体' && run.italic));
  assert.ok(block.runs.some(run => run.text === '同时' && run.bold && run.italic));
  assert.ok(block.runs.some(run => run.text === 'nested' && run.bold && run.italic));
  assert.ok(block.runs.some(run => run.text === 'a*b + x_y' && run.code && !run.bold && !run.italic));
});

test('mathematical operators, identifiers, nonheadings and incomplete syntax do not lose characters', () => {
  const samples = ['a*b + c*d', 'x_y + z_w', 'a*b*c', 'x_y_z', '#42 ##token', '**unfinished', '*x + y', 'unfinished **', 'a**b**c', '𝜓_i * α_j', '``unfinished code', 'before _unclosed'];
  for (const sample of samples) assert.equal(parseTranslationMarkdown(sample).map(textOf).join('\n'), sample, sample);
  const fence = '```ts\n# This is not a heading\n* unclosed fence\n\nx_y';
  assert.equal(textOf(parseTranslationMarkdown(fence)[0]), fence);
});

test('Unicode identifiers keep multiplication, powers and subscripts literal beside emphasis markers', () => {
  const samples = ['ψ*α + β*γ', 'α_β + γ_δ', 'ψ**α + β**γ', '𝜓**α**β', '𝜓*α + β*𝛾', '𝜓_α + β_𝛾', 'ψ\u0301*α + β*γ', 'x**2 + y**2'];
  for (const sample of samples) {
    const [block] = parseTranslationMarkdown(sample);
    assert.equal(textOf(block), sample, sample);
    assert.ok(block.runs.every(run => !run.bold && !run.italic), sample);
  }
  const [prose] = parseTranslationMarkdown('中文**强调**仍然支持；**α** 表示加粗变量。');
  assert.equal(textOf(prose), '中文强调仍然支持；α 表示加粗变量。');
  assert.ok(prose.runs.some(run => run.text === '强调' && run.bold));
  assert.ok(prose.runs.some(run => run.text === 'α' && run.bold));
});

test('comparison expressions retain greater-than signs while prose can form quotes', () => {
  for (const sample of ['> 0', '> x', '> α', '> x + y', '> sin(x)', '> 0.95', '> α_β + γ_δ']) {
    const [block] = parseTranslationMarkdown(sample);
    assert.equal(block.kind, 'paragraph', sample);
    assert.equal(textOf(block), sample, sample);
  }
  const blocks = parseTranslationMarkdown('> This is quoted prose.\n> 引用正文\n> 0');
  assert.equal(blocks[0].kind, 'quote');
  assert.equal(textOf(blocks[0]), 'This is quoted prose.引用正文');
  assert.equal(blocks[1].kind, 'paragraph');
  assert.equal(textOf(blocks[1]), '> 0');
});

test('fenced and inline code remain literal without processing emphasis or headings', () => {
  const blocks = parseTranslationMarkdown('Before\n\n```text\n# code\n  x_y = a*b\n\n**literal**\n```\n\nAfter ``a ` tick``.');
  assert.equal(blocks.length, 3);
  assert.deepEqual(blocks[1], { kind: 'code', runs: [{ text: '# code\n  x_y = a*b\n\n**literal**', code: true }] });
  assert.equal(textOf(blocks[2]), 'After a ` tick.');
  assert.ok(blocks[2].runs.some(run => run.text === 'a ` tick' && run.code));
  assert.deepEqual(parseTranslationMarkdown('~~~\n**code**\n~~~~')[0], { kind: 'code', runs: [{ text: '**code**', code: true }] });
});

test('HTML and URLs stay inert text and escaped markers do not acquire styles', () => {
  const input = '<script>alert(1)</script> [source](https://example.com) \\*literal\\* \\alpha \\_name\\_';
  const [block] = parseTranslationMarkdown(input);
  assert.equal(textOf(block), '<script>alert(1)</script> [source](https://example.com) *literal* \\alpha _name_');
  assert.equal(block.runs.length, 1);
  assert.deepEqual(parseTranslationMarkdown(' \r\n\t\r\n'), []);
});

test('Unicode text, punctuation and source line endings survive block normalization', () => {
  const blocks = parseTranslationMarkdown('English\r\nwrapped sentence.\r\n\r\n中文行\r\n含 𝜓 和 😀\r\n，保留标点。\r\n\r\n（1） 项目');
  assert.deepEqual(blocks.map(textOf), ['English wrapped sentence.', '中文行含 𝜓 和 😀，保留标点。', '项目']);
  assert.equal(blocks[2].marker, '（1）');
});
