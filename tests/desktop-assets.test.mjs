import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { includeDesktopAsset, omittedDesktopAssets } from '../desktop/scripts/asset-policy.mjs';

void test('desktop excludes only migrated lecture videos and keeps offline research assets', async () => {
  const root = path.resolve('dist/client');
  for (const name of omittedDesktopAssets) {
    assert.equal(includeDesktopAsset(path.join(root, name), root), false);
    assert.equal(includeDesktopAsset(path.join(root, `other/${name}`), root), true);
  }
  for (const name of ['game-research/short-hike-trailer.mp4', 'game-research/invisible-intuition.pdf', 'research/bloch-pages/1.jpg', 'assets/pdf-fonts/LumiorDocumentSans-Regular.ttf', 'pdf-assets/pdf.worker.min.mjs']) {
    assert.equal(includeDesktopAsset(path.join(root, name), root), true);
  }
});
