import test from 'node:test';
import assert from 'node:assert/strict';
import { aiAnswerFragmentBlocks } from '../app/ai-answer-fragment.ts';
import { aiAnswerNote, encodeAiAnswerDrag, parseAiAnswerDrag } from '../app/ai-answer-drag.ts';
import { cardDocument, documentText } from '../app/card-document.ts';

const element = (tag, children = [], attributes = {}) => ({ tag, children, ...attributes });
const textRun = (text, styles = {}) => ({ type: 'text', text, styles });

test('a clipped heading fragment keeps its level and nested marks without adding an independent title', () => {
  // The Range adapter supplies only selected text, retaining semantic ancestors.
  const selected = [element('h2', ['选中的', element('strong', ['重点', element('em', ['部分'])])])];
  const blocks = aiAnswerFragmentBlocks(selected);
  assert.deepEqual(blocks, [{ type: 'heading', props: { level: 2 }, content: [
    textRun('选中的'), textRun('重点', { bold: true }), textRun('部分', { bold: true, italic: true }),
  ] }]);
  assert.equal(aiAnswerNote(documentText(blocks), blocks).title, '');
  assert.deepEqual(aiAnswerFragmentBlocks([element('h5', ['旧标题'])])[0].props, { level: 5 });
});

test('selected ordered items retain their original ordinal, nested tasks and following paragraph order', () => {
  const selected = [element('ol', [
    element('li', [element('p', ['第四项']), element('ul', [
      element('li', ['完成项'], { checked: true }),
      element('li', ['待办项'], { checked: false }),
    ]), element('p', [element('strong', ['子列表之后的段落'])])], { start: 4 }),
    element('li', ['第五项'], { start: 5 }),
  ])];
  const original = structuredClone(selected);
  const blocks = aiAnswerFragmentBlocks(selected);
  assert.equal(blocks[0].type, 'numberedListItem');
  assert.equal(blocks[0].props.start, 4);
  assert.deepEqual(blocks[0].content, [textRun('第四项')]);
  assert.deepEqual(blocks[0].children.map(block => block.type), ['checkListItem', 'checkListItem', 'paragraph']);
  assert.equal(blocks[0].children[0].props.checked, true);
  assert.equal(blocks[0].children[1].props.checked, false);
  assert.deepEqual(blocks[0].children[2].content, [textRun('子列表之后的段落', { bold: true })]);
  assert.equal(blocks[1].props.start, 5);
  assert.deepEqual(selected, original, 'conversion does not alter the answer fragment');
});

test('nested-list-only excerpts do not create an empty parent item or copy unselected parent text', () => {
  const blocks = aiAnswerFragmentBlocks([element('ul', [element('li', [
    element('ol', [element('li', ['选中的子项'], { start: 3 })]),
  ])])]);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'numberedListItem');
  assert.equal(blocks[0].props.start, 3);
  assert.deepEqual(blocks[0].content, [textRun('选中的子项')]);
});

test('headings, code and quotes at the start of list items retain both list and block semantics', () => {
  const blocks = aiAnswerFragmentBlocks([element('ol', [
    element('li', [element('h2', [element('strong', ['列表中的标题'])]), element('p', ['后续说明'])], { start: 7 }),
    element('li', [element('pre', [element('code', ['  code\n'], { language: 'text' })])], { start: 8 }),
    element('li', [element('blockquote', [element('p', ['引用内容'])])], { start: 9 }),
  ])]);
  assert.deepEqual(blocks.map(block => block.type), ['numberedListItem', 'numberedListItem', 'numberedListItem']);
  assert.deepEqual(blocks.map(block => block.props.start), [7, 8, 9]);
  assert.ok(blocks.every(block => block.content.length === 0));
  assert.deepEqual(blocks[0].children.map(block => block.type), ['heading', 'paragraph']);
  assert.equal(blocks[0].children[0].props.level, 2);
  assert.deepEqual(blocks[0].children[0].content, [textRun('列表中的标题', { bold: true })]);
  assert.equal(blocks[1].children[0].type, 'codeBlock');
  assert.equal(blocks[1].children[0].props.language, 'text');
  assert.deepEqual(blocks[1].children[0].content, [textRun('  code\n')]);
  assert.equal(blocks[2].children[0].type, 'quote');
  assert.deepEqual(blocks[2].children[0].content, [textRun('引用内容')]);
});

test('literal Markdown remains literal prose and inline code preserves internal spacing', () => {
  const literal = '## literal **stars** and - a dash';
  const blocks = aiAnswerFragmentBlocks([element('p', [literal]), element('p', [
    element('code', ['x  +  y']), ' ', element('del', ['删除线']),
  ])]);
  assert.equal(blocks[0].type, 'paragraph');
  assert.deepEqual(blocks[0].content, [textRun(literal)]);
  assert.deepEqual(blocks[1].content, [textRun('x  +  y', { code: true }), textRun(' '), textRun('删除线', { strike: true })]);
});

test('code blocks retain language, line breaks and indentation rather than collapsing whitespace', () => {
  const code = 'function example() {\n\treturn  1;\n}\n';
  const blocks = aiAnswerFragmentBlocks([element('pre', [element('code', [code], { language: 'javascript' })])]);
  assert.deepEqual(blocks, [{ type: 'codeBlock', props: { language: 'javascript' }, content: [textRun(code)] }]);
});

test('links retain safe destinations while unsafe or relative targets become formatted text', () => {
  const safe = ['https://example.com/a?q=1', 'http://example.com', 'mailto:test@example.com', '#lumior-content=note-1'];
  for (const href of safe) {
    const [block] = aiAnswerFragmentBlocks([element('p', [element('a', [element('strong', ['链接'])], { href })])]);
    assert.deepEqual(block.content, [{ type: 'link', href, content: [textRun('链接', { bold: true })] }]);
  }
  for (const href of ['javascript:alert(1)', 'data:text/html,unsafe', 'file:///tmp/private', '/relative', 'https://example.com/a\nb']) {
    const [block] = aiAnswerFragmentBlocks([element('p', [element('a', [element('em', ['保留文字'])], { href })])]);
    assert.deepEqual(block.content, [textRun('保留文字', { italic: true })]);
  }
});

test('tables preserve row structure, header marks and empty placeholders without shifting columns', () => {
  const [table] = aiAnswerFragmentBlocks([element('table', [
    element('thead', [element('tr', [element('th', ['名称']), element('th', ['内容']), element('th', ['备注'])])]),
    element('tbody', [
      element('tr', [element('td', []), element('td', [element('strong', ['选中第二列'])]), element('td', ['第三列'])]),
      element('tr', [element('td', ['下一行'])]),
    ]),
  ])]);
  assert.equal(table.content.headerRows, 1);
  assert.deepEqual(table.content.rows.map(row => row.cells.length), [3, 3, 3]);
  assert.deepEqual(table.content.rows[1].cells[0], []);
  assert.deepEqual(table.content.rows[1].cells[1], [textRun('选中第二列', { bold: true })]);
  assert.deepEqual(table.content.rows[2].cells, [[textRun('下一行')], [], []]);
});

test('formatted excerpts survive the v2 drag protocol and saved Note blocks take precedence over Markdown parsing', () => {
  const blocks = aiAnswerFragmentBlocks([
    element('h2', [element('strong', ['研究方向'])]),
    element('ul', [element('li', ['普通列表'], { checked: false }), element('li', ['补充项'])]),
    element('p', ['## 这行是原样文字']),
  ]);
  const note = aiAnswerNote(documentText(blocks), blocks);
  const payload = encodeAiAnswerDrag(note.body, note.blocks);
  assert.equal(JSON.parse(payload).version, 2);
  const dropped = parseAiAnswerDrag(payload);
  assert.deepEqual(dropped, note);
  assert.equal(dropped.title, '');
  const reopened = JSON.parse(JSON.stringify({ id: 'new-card', kind: 'note', x: 0, y: 0, width: 420, ...dropped }));
  const rendered = cardDocument(reopened, () => { throw new Error('Rich excerpts must never be reparsed from the plain-text cache'); });
  assert.deepEqual(rendered, dropped.blocks);
  assert.equal(rendered[0].props.level, 2);
  assert.equal(rendered[0].content[0].styles.bold, true);
  assert.equal(rendered[1].type, 'checkListItem');
  assert.equal(rendered[3].type, 'paragraph');
  rendered[0].content[0].text = '本次编辑';
  assert.equal(reopened.blocks[0].content[0].text, '研究方向', 'the reopened document is cloned for editing');
});
