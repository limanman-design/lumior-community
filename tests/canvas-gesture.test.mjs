import test from 'node:test';
import assert from 'node:assert/strict';
import { cancelConnectionGesture, finishCanvasGesture } from '../app/canvas-gesture.ts';

test('Escape during a connection releases capture and leaves no action for the later pointerup', () => {
  const active = { current: null };
  let captured = true, releases = 0, completions = 0;
  const gesture = {
    type: 'connect', pointer: 7,
    // Capture belongs to the connector button, not its nested icon target.
    target: { tagName: 'SPAN' },
    captureTarget: {
      hasPointerCapture: id => id === 7 && captured,
      releasePointerCapture: id => {
        assert.equal(id, 7);
        assert.equal(active.current, null);
        captured = false;
        releases++;
        // A synchronous lostpointercapture cannot commit or reopen the menu.
        if (finishCanvasGesture(active, id)) completions++;
      },
    },
  };
  active.current = gesture;
  assert.equal(cancelConnectionGesture(active), gesture);
  assert.equal(active.current, null); // The paste guard is no longer blocked.
  assert.equal(captured, false);
  assert.equal(releases, 1);
  if (finishCanvasGesture(active, 7)) completions++;
  assert.equal(completions, 0);
  assert.equal(cancelConnectionGesture(active), null);
});

test('lost capture clears an interrupted connection even after capture is already gone', () => {
  const gesture = {
    type: 'connect', pointer: 3,
    captureTarget: {
      hasPointerCapture: () => false,
      releasePointerCapture: () => assert.fail('capture is already gone'),
    },
  };
  const active = { current: gesture };
  assert.equal(finishCanvasGesture(active, 3), gesture);
  assert.equal(active.current, null);
  assert.equal(finishCanvasGesture(active, 3), null);
});

test('a delayed event from a different pointer does not clear the current gesture', () => {
  const gesture = { type: 'connect', pointer: 2 };
  const active = { current: gesture };
  assert.equal(finishCanvasGesture(active, 1), null);
  assert.equal(active.current, gesture);
  assert.equal(finishCanvasGesture(active, 2), gesture);
});

test('connection cancellation leaves card moves, resize rollback and other gestures to their own handlers', () => {
  for (const type of ['move', 'resize', 'select', 'pan', 'section', 'section-move', 'section-resize']) {
    const gesture = { type, pointer: 1 };
    const active = { current: gesture };
    assert.equal(cancelConnectionGesture(active), null);
    assert.equal(active.current, gesture);
    assert.equal(finishCanvasGesture(active, 1), gesture);
    assert.equal(active.current, null);
  }
});
