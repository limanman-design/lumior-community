import test from 'node:test';
import assert from 'node:assert/strict';
import { aiAnswerNote, encodeAiAnswerDrag, parseAiAnswerDrag, normalizeAiAnswerBlocks, maxAiAnswerExcerptLength } from '../app/ai-answer-drag.ts';

test('an answer excerpt keeps its rendered plain text as body and leaves the title empty', () => {
  const note = aiAnswerNote('  先看论文的研究问题\n\n再核对实验结果。  ');
  assert.deepEqual(note, { title: '', body: '先看论文的研究问题\n\n再核对实验结果。' });
  assert.deepEqual(parseAiAnswerDrag(encodeAiAnswerDrag(note.body)), note);
});

test('long excerpts keep their full body without generating a title', () => {
  const text = '长'.repeat(120);
  const note = aiAnswerNote(text);
  assert.equal(note.title, '');
  assert.equal(note.body, text);
});

test('empty or oversized excerpts cannot create blank or silently truncated cards', () => {
  assert.equal(aiAnswerNote(' \n\t '), null);
  assert.equal(encodeAiAnswerDrag('x'.repeat(maxAiAnswerExcerptLength + 1)), null);
  assert.equal(parseAiAnswerDrag(JSON.stringify({ version: 1, title: 'x', body: 'x'.repeat(maxAiAnswerExcerptLength + 1) })), null);
  assert.equal(parseAiAnswerDrag('x'.repeat(maxAiAnswerExcerptLength * 6 + 1_001)), null);
});

test('only a supported typed payload is accepted; malformed and foreign drops remain inert', () => {
  for (const value of ['', 'ordinary text', '{}', '[]', 'null', '{', JSON.stringify({ boardId: 'a', cardId: 'b' }), JSON.stringify({ version: 2, title: 'x', body: 'x' }), JSON.stringify({ version: 1, title: {}, body: 'x' }), JSON.stringify({ version: 1, title: 'x', body: {} })]) assert.equal(parseAiAnswerDrag(value), null);
});

test('legacy payload titles are ignored so dropped excerpts always have an empty title', () => {
  assert.deepEqual(parseAiAnswerDrag(JSON.stringify({ version: 1, title: 'forged', body: 'Selected excerpt' })), { title: '', body: 'Selected excerpt' });
});

test('rich excerpts keep heading level, list nesting and inline marks without carrying source styling or identity', () => {
  const blocks = [{ id: 'source-id', type: 'heading', props: { level: 2, textColor: 'red', fontSize: 60 }, content: [
    { type: 'text', text: '关键方向', styles: { bold: true, italic: true, backgroundColor: 'red' } },
  ] }, { type: 'numberedListItem', props: { start: 4 }, content: '第四项', children: [
    { type: 'bulletListItem', content: [{ type: 'text', text: '子项', styles: { strike: true } }] },
  ] }];
  const note = aiAnswerNote('关键方向\n第四项\n子项', blocks);
  assert.equal(note.title, '');
  assert.equal(note.blocks[0].id, undefined);
  assert.deepEqual(note.blocks[0].props, { level: 2 });
  assert.deepEqual(note.blocks[0].content[0].styles, { bold: true, italic: true });
  assert.equal(note.blocks[1].props.start, 4);
  assert.equal(note.blocks[1].children[0].content[0].styles.strike, true);
  const payload = encodeAiAnswerDrag(note.body, note.blocks);
  assert.equal(JSON.parse(payload).version, 2);
  assert.deepEqual(parseAiAnswerDrag(payload), note);
  assert.equal(blocks[0].id, 'source-id', 'source document remains untouched');
});

test('rich payloads cannot inject media, unsafe links, malformed blocks, or excessive nesting', () => {
  const link = href => ({ type: 'link', href, content: [{ type: 'text', text: 'label', styles: {} }] });
  const safe = normalizeAiAnswerBlocks([{ type: 'paragraph', content: [link('https://example.com/a'), link('javascript:alert(1)')] }]);
  assert.equal(safe[0].content[0].type, 'link');
  assert.equal(safe[0].content[1].type, 'text');
  assert.equal(safe[0].content[1].text, 'label');
  const invalid = [[], [{ type: 'image', props: { url: 'data:text/html,unsafe' } }], [{ type: 'heading', props: { level: 99 }, content: 'bad' }], [{ type: 'paragraph', content: [{}] }]];
  let deep = { type: 'paragraph', content: 'deep' };
  for (let i = 0; i < 30; i++) deep = { type: 'bulletListItem', content: 'parent', children: [deep] };
  invalid.push([deep]);
  for (const blocks of invalid) assert.equal(parseAiAnswerDrag(JSON.stringify({ version: 2, title: '', body: 'text', blocks })), null);
});

test('nested link payloads become styled text inside one valid Note link', () => {
  const blocks = [{ type: 'paragraph', content: [{ type: 'link', href: 'https://example.com', content: [
    { type: 'link', href: 'https://example.com/inner', content: [{ type: 'text', text: 'nested label', styles: { bold: true } }] },
  ] }, { type: 'link', href: 'https://bad host', content: [{ type: 'text', text: 'invalid URL', styles: {} }] }] }];
  const note = parseAiAnswerDrag(JSON.stringify({ version: 2, title: '', body: 'nested label invalid URL', blocks }));
  assert.deepEqual(note.blocks[0].content[0].content, [{ type: 'text', text: 'nested label', styles: { bold: true } }]);
  assert.equal(note.blocks[0].content[1].type, 'text');
});
