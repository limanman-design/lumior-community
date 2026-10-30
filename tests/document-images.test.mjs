import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDocumentImage } from '../app/document-images.ts';

test('community image references are preserved without private report assets', () => {
  for (const value of ['/Users/example/report.png', '/assets/example.png', 'https://example.com/image.png', 'lumior-file:example', 'data:image/png;base64,example']) {
    assert.equal(resolveDocumentImage(value), value);
  }
});
