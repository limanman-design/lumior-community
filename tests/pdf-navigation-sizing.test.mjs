import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultPdfNavigationWidth, pdfNavigationSize, preferredPdfNavigationWidth } from '../app/pdf-navigation-sizing.ts';

test('navigation defaults to 268px and respects the 200–400px range when there is room', () => {
  assert.deepEqual(pdfNavigationSize(defaultPdfNavigationWidth, 1000), { width: 268, min: 200, max: 400 });
  assert.equal(pdfNavigationSize(100, 1000).width, 200);
  assert.equal(pdfNavigationSize(800, 1000).width, 400);
});

test('notes and AI leave enough room for the paper while retaining the preferred width for later', () => {
  const preferred = 350;
  assert.deepEqual(pdfNavigationSize(preferred, 541), { width: 221, min: 200, max: 221 });
  assert.equal(pdfNavigationSize(preferred, 541).width + 320, 541);
  assert.equal(pdfNavigationSize(preferred, 900).width, preferred);
});

test('very narrow views shrink navigation instead of overflowing the document column', () => {
  const size = pdfNavigationSize(268, 374);
  assert.deepEqual(size, { width: 150, min: 150, max: 150 });
  for (const available of [0, 100, 280, 496, 689]) {
    const result = pdfNavigationSize(268, available);
    assert.ok(result.width >= 0 && result.width <= available);
    assert.ok(result.min <= result.width && result.width <= result.max);
  }
});

test('missing or invalid saved preferences fall back to the default and oversized values are clamped', () => {
  for (const value of [0, -1, NaN, Infinity]) assert.equal(preferredPdfNavigationWidth(value), 268);
  assert.equal(preferredPdfNavigationWidth(201.6), 202);
  assert.equal(preferredPdfNavigationWidth(150), 200);
  assert.equal(preferredPdfNavigationWidth(900), 400);
});
