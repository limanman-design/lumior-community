import test from 'node:test';
import assert from 'node:assert/strict';
import { canvasPointerAction, panView, isFlashlightClick, nextFlashlightLevel } from '../app/canvas-input.ts';

const view = { x: 40, y: -20, zoom: .25 };
const start = { x: 200, y: 100 };
const flashlightPan = () => ({ start, view, flashlight: { canCycle: true, dragged: false } });

test('right mouse exits the flashlight and pans in normal mode; primary input stays reserved for card interactions', () => {
  assert.equal(canvasPointerAction(2, true), 'exit-flashlight');
  assert.equal(canvasPointerAction(2, false), 'pan');
  assert.equal(canvasPointerAction(0, true), 'pan');
  assert.equal(canvasPointerAction(0, false), null);
  assert.equal(canvasPointerAction(1, true), 'pan');
  assert.equal(canvasPointerAction(1, false), 'pan');
  assert.equal(canvasPointerAction(3, true), null);
});

test('slightly shaky flashlight clicks leave the view still and cycle through all three levels', () => {
  let level = 2;
  const levels = [];
  for (let i = 0; i < 3; i++) {
    const gesture = flashlightPan();
    const point = { x: start.x + 2, y: start.y + 1 };
    assert.equal(panView(gesture, point), null);
    assert.equal(isFlashlightClick(gesture, point), true);
    level = nextFlashlightLevel(level);
    levels.push(level);
  }
  assert.deepEqual(levels, [3, 1, 2]);
});

test('a flashlight drag stays a drag even after returning to the starting point', () => {
  const gesture = flashlightPan();
  assert.equal(panView(gesture, { x: 203, y: 100 }), null);
  assert.deepEqual(panView(gesture, { x: 204, y: 100 }), { ...view, x: 44 });
  assert.equal(isFlashlightClick(gesture, { x: 204, y: 100 }), false);
  assert.deepEqual(panView(gesture, start), view);
  assert.equal(isFlashlightClick(gesture, start), false);
});

test('normal, middle-button and Space pans use screen distances and never change the light level', () => {
  for (const zoom of [.2, .95, 2.4]) {
    const original = { ...view, zoom };
    for (const flashlight of [undefined, { canCycle: false, dragged: false }]) {
      const gesture = { start, view: original, flashlight };
      assert.deepEqual(panView(gesture, { x: 201, y: 101 }), { ...original, x: 41, y: -19 });
      assert.deepEqual(panView(gesture, { x: 300, y: 150 }), { ...original, x: 140, y: 30 });
      assert.equal(isFlashlightClick(gesture, start), false);
      assert.deepEqual(original, { ...view, zoom });
    }
  }
});
