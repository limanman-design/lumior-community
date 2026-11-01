import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { includeDesktopAsset, retainedDesktopAssets } from '../desktop/scripts/asset-policy.mjs';

void test('desktop removes legacy board media but retains ordinary product assets and traversal parents', () => {
  const root = path.resolve('dist/client');
  for (const name of ['research', 'game-research', 'research/bloch-pages/page-01.jpg', 'research/bloch-review.pdf', 'game-research/short-hike-trailer.mp4', 'game-research/invisible-intuition.pdf', 'open-world/gdc.en.json', 'open-world/unused.jpg']) {
    assert.equal(includeDesktopAsset(path.join(root, name), root), false, name);
    assert.equal(includeDesktopAsset(path.join(root, `other/${name}`), root), true);
  }
  for (const name of ['', 'open-world', ...retainedDesktopAssets, 'research-other/page.jpg', 'open-world/forest.jpg.extra', 'assets/pdf-fonts/LumiorDocumentSans-Regular.ttf', 'pdf-assets/pdf.worker.min.mjs', 'sound/rain.mp3', 'assets/onboarding/first-board.pdf']) {
    // Similar names under an excluded directory are not whitelist matches.
    assert.equal(includeDesktopAsset(path.join(root, name), root), name !== 'open-world/forest.jpg.extra', name);
  }
});
