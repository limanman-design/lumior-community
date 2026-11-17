import test from 'node:test';
import assert from 'node:assert/strict';
import { translationStructure } from '../lib/pdf-translation-structure.ts';

const rect = (x, y, width = 38, height = 1.3) => ({ x, y, width, height });
const part = (id, text, rects = []) => ({ id, text, rects });
const body = () => [
  part('left', '左栏正文第一段，保持阅读顺序。', [rect(9, 40), rect(9, 42), rect(9, 44), rect(9, 46)]),
  part('right', '右栏正文第一段，不能插进左栏。', [rect(53, 39), rect(53, 41), rect(53, 43), rect(53, 45)]),
];
const blocks = value => value.sections.flatMap(section => section.columns.flat());
const text = value => blocks(value).map(block => (block.marker || '') + block.runs.map(run => run.text).join('')).join('').replace(/\s/g, '');

test('source columns keep title and abstract spanning both lanes without interleaving paragraphs', () => {
  const input = [part('meta', 'arXiv:1234.5678', [rect(5, 76, 74, 2.5)]),
    part('title', '论文标题', [rect(20, 6, 60, 1.6)]), part('subtitle', '跨栏副标题', [rect(38, 8, 24, 1.6)]),
    part('abstract', '摘要正文。'.repeat(20), [rect(18, 20, 64), rect(18, 22, 64), rect(18, 24, 64), rect(18, 26, 64), rect(18, 28, 64), rect(18, 30, 64)]), ...body()];
  const before = structuredClone(input), value = translationStructure(input, 1);
  assert.equal(value.columns, 2); assert.equal(value.hasTitle, true);
  assert.deepEqual(value.sections.map(section => section.columns.length), [1, 2]);
  assert.equal(value.sections[0].columns[0].filter(block => block.level === 1).length, 2);
  assert.equal(value.sections[1].columns[0][0].runs[0].id, 'left');
  assert.equal(value.sections[1].columns[1][0].runs[0].id, 'right');
  assert.equal(text(value), input.map(part => part.text).join('').replace(/\s/g, ''));
  assert.deepEqual(input, before);
});

test('same source rectangles across translation batches retain both fragments and IDs', () => {
  const coordinates = [rect(9, 40), rect(9, 42), rect(9, 44), rect(9, 46)];
  const input = [part('a', '正文前半句', coordinates), part('b', '正文后半句。', coordinates), body()[1]];
  const value = translationStructure(input, 2), left = value.sections[0].columns[0];
  assert.equal(left.length, 1); assert.deepEqual(left[0].runs.map(run => run.id), ['a', 'b']);
  assert.equal(text(value), '正文前半句正文后半句。右栏正文第一段，不能插进左栏。');
});

test('formula and inline fragments use a compact literal flow without losing operators or source IDs', () => {
  const values = ['H = − J', 'X', '⟨i,j⟩', 'ψ*α + β*γ', 'i', '+', '1\n2', 'U', 'X', 'i'];
  const formula = values.map((value, i) => part(`math${i}`, value, [rect(53 + i * 3, 58 + [0, -1, 1.6][i % 3], 2, 1.2)]));
  const input = [...body(), ...formula];
  const value = translationStructure(input, 2);
  const math = blocks(value).filter(block => block.runs.some(run => run.id.startsWith('math')));
  assert.equal(math.length, 1);
  assert.deepEqual(math[0].runs.map(run => run.id), formula.map(part => part.id));
  assert.equal(text(value), input.map(part => part.text).join('').replace(/\s/g, ''));
});

test('explicit Markdown kinds and levels take precedence over centered source heading guesses', () => {
  for (const [source, kind, level] of [['### 三级标题', 'heading', 3], ['- 一个项目', 'list', 0], ['```\ncode\n```', 'code', undefined]]) {
    const input = [part('markdown', source, [rect(21, 37, 16, 1.3)]), ...body()];
    const block = blocks(translationStructure(input, 1)).find(block => block.runs[0].id === 'markdown');
    assert.equal(block.kind, kind); assert.equal(block.level, level);
  }
});

test('long single-column sources stay single-column and missing geometry remains readable', () => {
  const text = '完整单栏正文。'.repeat(100);
  assert.equal(translationStructure([part('single', text, [rect(10, 10, 80), rect(10, 12, 80)])], 2).columns, 1);
  assert.equal(translationStructure([part('legacy', text)], 2).columns, 2);
  assert.equal(translationStructure([part('invalid', '保留内容', [null, rect(1, NaN)])], 2).sections[0].columns[0][0].runs[0].text, '保留内容');
});

test('page numbers stay above both columns and a later spanning block separates column sections', () => {
  const input = [part('page', '8', [rect(91, 3, 1)]), ...body(), part('wide', '跨栏说明。', [rect(10, 65, 80)]),
    ...body().map((part, i) => ({ ...part, id: `tail${i}`, rects: part.rects.map(rect => ({ ...rect, y: rect.y + 35 })) }))];
  const value = translationStructure(input, 8);
  assert.deepEqual(value.sections.map(section => section.columns.length), [1, 2, 1, 2]);
  assert.equal(value.sections[0].columns[0][0].metadata, true);
  assert.equal(text(value), input.map(part => part.text).join('').replace(/\s/g, ''));
});

test('source formula blocks preserve their position and IDs without consuming adjacent prose', () => {
  const input=[...body(),part('math-a','H = 误译',[rect(53,60,15)]),part('math-b','(1)',[rect(90,60,2)]),part('after','公式之后的中文说明。',[rect(53,68)])];
  const formula={id:'image',page:2,partIds:['math-a','math-b'],rect:rect(52,59,41,4)};
  const value=translationStructure(input,2,[formula]);
  const right=value.sections[0].columns[1];
  assert.deepEqual(right.map(block=>block.runs.map(run=>run.id)),[['right'],['math-a','math-b'],['after']]);
  assert.equal(right[1].formula,formula);
  for(const bad of [{...formula,page:1},{...formula,partIds:['math-a','missing']},{...formula,partIds:['right','math-b']},{...formula,partIds:['math-a','math-a']}]){
    const unchanged=translationStructure(input,2,[bad]);
    assert.ok(blocks(unchanged).every(block=>!block.formula));
    assert.equal(text(unchanged),input.map(part=>part.text).join('').replace(/\s/g,''));
  }
});
