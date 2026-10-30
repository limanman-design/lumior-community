import test from 'node:test';
import assert from 'node:assert/strict';
import { flashlightStrength } from '../app/canvas-input.ts';
import {
  flashlightGeometry,
  flashlightProfiles,
  flashlightShadeOpacity,
  flashlightSpillOpacity,
} from '../app/canvas-flashlight-profile.ts';

// Nominal centreline contrast from the SVG's two linear gradients and black
// mask group. Edge feathering/blur are deliberately excluded; GUI checks cover
// their rendering. A value of 1 means the original card contrast is retained.
function contrastAt(level, distance) {
  const profile = flashlightProfiles[level];
  const opening = (reach) => {
    const position = distance / reach;
    return Math.max(
      0,
      Math.min(1, (1 - position) / (1 - profile.falloffStart)),
    );
  };
  const core = opening(profile.reach);
  const spill =
    flashlightSpillOpacity * opening(flashlightGeometry(profile).spillReach);
  const hole = flashlightStrength[level] * (1 - (1 - core) * (1 - spill));
  return 1 - flashlightShadeOpacity * (1 - hole);
}

test('all three levels noticeably separate contrast at the same near and middle points', () => {
  for (const distance of [100, 250]) {
    const values = [1, 2, 3].map((level) => contrastAt(level, distance));
    assert.ok(
      values[1] - values[0] >= 0.3,
      `weak/medium at ${distance}px: ${values.join(', ')}`,
    );
    assert.ok(
      values[2] - values[1] >= 0.3,
      `medium/strong at ${distance}px: ${values.join(', ')}`,
    );
    assert.ok(values[0] < 0.4);
    assert.ok(values[2] >= 0.99);
  }
});

test('the strongest level reveals original contrast over a much longer and wider reading area', () => {
  const weak = flashlightProfiles[1];
  const medium = flashlightProfiles[2];
  const strong = flashlightProfiles[3];
  assert.ok(medium.reach >= weak.reach * 1.7);
  assert.ok(strong.reach >= medium.reach * 1.6);
  assert.ok(strong.halfWidth >= medium.halfWidth * 1.6);
  assert.ok(
    strong.reach * strong.halfWidth > 2.5 * medium.reach * medium.halfWidth,
  );
  assert.ok(strong.reach * strong.falloffStart > 850);
  assert.ok(contrastAt(3, 850) >= 0.99);
  assert.ok(contrastAt(3, 900) >= 0.95);
  assert.ok(contrastAt(2, 900) <= 0.15);
  assert.ok(contrastAt(3, 500) - contrastAt(2, 500) > 0.5);
});

test('each cone and spill have unclipped blur bounds and return to the ambient shade beyond their reach', () => {
  for (const level of [1, 2, 3]) {
    const profile = flashlightProfiles[level];
    const { spillReach, spillWidth, bounds } = flashlightGeometry(profile);
    assert.ok(profile.falloffStart > 0 && profile.falloffStart < 1);
    assert.ok(bounds.x <= -spillWidth - profile.spillBlur * 3);
    assert.ok(bounds.x + bounds.width >= spillWidth + profile.spillBlur * 3);
    assert.ok(bounds.y <= -spillReach - profile.spillBlur * 3);
    assert.ok(bounds.y + bounds.height >= profile.spillBlur * 3);
    assert.ok(
      Math.abs(
        contrastAt(level, spillReach + 1) - (1 - flashlightShadeOpacity),
      ) < 1e-12,
    );
  }
});
