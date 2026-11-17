import test from 'node:test';
import assert from 'node:assert/strict';
import { findPdfFormulaRegions } from '../lib/pdf-formula-regions.ts';

const rect = (x, y, width, height = 1.3) => ({ x, y, width, height });
const units = (values, page = 1) => [{ id: `${page}:0`, page, text: values.map(value => value[0]).join(''),
  parts: values.map(([text, rects], index) => ({ id: `${page}:0:${index}`, text, rects })) }];
const formula = () => units([
  ['A paragraph before the displayed equation.', [rect(10, 15, 38)]],
  ['J = − V ', [rect(12, 20, 12)]], ['lat ', [rect(24, 20.6, 2, .9)]], ['(x)', [rect(26, 20, 4)]], ['(2)', [rect(46, 20, 2)]],
  ['The following paragraph remains translated.', [rect(10, 24, 38)]],
]);
const sizes = new Map([[1, { width: 612, height: 792 }]]);

test('display-equation detection uses source text even when a saved subscript was mistranslated', () => {
  const source = formula(), target = structuredClone(source);
  target[0].parts[2].text = '纬度';
  const before = structuredClone({ source, target });
  const [region] = findPdfFormulaRegions(source, target, sizes);
  assert.equal(region.page, 1); assert.deepEqual(region.partIds, ['1:0:1', '1:0:2', '1:0:3', '1:0:4']);
  assert.ok(region.rect.x < 12 && region.rect.x + region.rect.width > 48, 'distant equation number is included');
  assert.ok(region.rect.y < 20 && region.rect.y + region.rect.height > 21.5, 'subscripts receive crop padding');
  assert.deepEqual({ source, target }, before);
});

test('an incomplete translation never replaces only half an equation', () => {
  const source = formula(), target = structuredClone(source);
  target[0].parts.splice(2, 1);
  assert.deepEqual(findPdfFormulaRegions(source, target, sizes), []);
  const empty = structuredClone(source); empty[0].parts[2].text = '  ';
  assert.deepEqual(findPdfFormulaRegions(source, empty, sizes), []);
});

test('matching IDs require the same page and every source rectangle before crops can replace text', () => {
  const source = formula(), target = structuredClone(source);
  target[0].parts[1].rects[0].x += .1;
  assert.deepEqual(findPdfFormulaRegions(source, target, sizes), []);
  const wrongPage = structuredClone(source); wrongPage[0].page = 2;
  assert.deepEqual(findPdfFormulaRegions(source, wrongPage, sizes), []);
  const duplicate = structuredClone(source); duplicate[0].parts.push(structuredClone(duplicate[0].parts[1]));
  assert.deepEqual(findPdfFormulaRegions(source, duplicate, sizes), []);
  assert.deepEqual(findPdfFormulaRegions(duplicate, source, sizes), []);
});

test('inline formulas sharing a row with prose are never converted into display crops', () => {
  const source = units([['Here the energy is', [rect(10, 20, 15)]], ['E = mc', [rect(26, 20, 14)]], ['2', [rect(40, 19.4, 1, .9)]],
    ['and the following sentence continues.', [rect(42, 20, 20)]]]);
  assert.deepEqual(findPdfFormulaRegions(source, structuredClone(source), sizes), []);
  const mixed = units([['Here E = mc2 is the energy.', [rect(10, 20, 35)]]]);
  assert.deepEqual(findPdfFormulaRegions(mixed, structuredClone(mixed), sizes), []);
});

test('two-column equations stay separate while unrelated opposite-column prose does not block a crop', () => {
  const lines = x => [rect(x, 10, 38), rect(x, 12, 38), rect(x, 14, 38)];
  const source = units([
    ['Left paragraph with several lines.', lines(9)], ['E = mc2', [rect(16, 30, 20)]], ['(1)', [rect(46, 30, 2)]],
    ['Right paragraph with several lines.', lines(53)], ['The unrelated right column text.', [rect(53, 30, 38)]],
    ['H = x + y', [rect(57, 40, 22)]], ['(2)', [rect(90, 40, 2)]],
  ]);
  const found = findPdfFormulaRegions(source, structuredClone(source), sizes);
  assert.equal(found.length, 2); assert.deepEqual(found.map(region => region.partIds), [['1:0:1', '1:0:2'], ['1:0:5', '1:0:6']]);
  assert.ok(found[0].rect.x + found[0].rect.width < 50); assert.ok(found[1].rect.x > 50);
});

test('padding reserves neighbouring descenders and ascenders while retaining the formula baseline', () => {
  const source = units([['Sentence before.', [rect(10, 18.6, 38)]], ['E = mc2', [rect(15, 20, 22)]], ['(1)', [rect(46, 20, 2)]],
    ['Sentence after.', [rect(10, 21.5, 38)]]]);
  const [region] = findPdfFormulaRegions(source, structuredClone(source), sizes);
  assert.ok(region.rect.y > 19.9 + 1.3 * .3 && region.rect.y < 20 + 1.3 * .5);
  assert.ok(region.rect.y + region.rect.height >= 21.3 && region.rect.y + region.rect.height < 21.5 + 1.3 * .18);
});

test('page numbers, citations, prose with short words and malformed coordinates are not equations', () => {
  for (const values of [[['2', [rect(90, 3, 1)]]], [['[1] x = y (2020)', [rect(10, 20, 30)]]],
    [['It is x = y and not z.', [rect(10, 20, 30)]]], [['E = mc2', [rect(10, NaN, 30)]]]]) {
    const source = units(values); assert.deepEqual(findPdfFormulaRegions(source, structuredClone(source), sizes), []);
  }
});

test('unnumbered isolated equations can be copied while tiny individual variables remain text', () => {
  const source = units([['A paragraph above.', [rect(10, 10, 70)]], ['f(x) = sin(x) + cos(x)', [rect(25, 20, 45)]],
    ['A paragraph below.', [rect(10, 30, 70)]], ['i = 0', [rect(10, 40, 3)]]]);
  const found = findPdfFormulaRegions(source, structuredClone(source));
  assert.equal(found.length, 1); assert.deepEqual(found[0].partIds, ['1:0:1']);
});

test('unlocated source text on an equation page prevents unsafe crops across unknown prose', () => {
  const source = formula(); source[0].parts.splice(3, 0, {id:'1:0:unknown',text:'Text with missing positions.',rects:[]});
  assert.deepEqual(findPdfFormulaRegions(source, structuredClone(source), sizes), []);
});
