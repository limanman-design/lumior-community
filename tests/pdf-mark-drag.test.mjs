import test from 'node:test';
import assert from 'node:assert/strict';
import { cancelPdfMarkDrags, createPdfMarkDrag } from '../app/pdf-mark-drag.ts';

const mark = { id: 'source-mark', text: 'Original excerpt', color: '#f5d84a', fragments: [{ page: 1, rects: [] }] };
const sample = (patch = {}) => ({ pointerId: 1, clientX: 10, clientY: 20, buttons: 1, ...patch });
function setup() {
  const view = new EventTarget(), document = new EventTarget(), target = new EventTarget();
  document.defaultView = view;
  document.visibilityState = 'visible';
  target.ownerDocument = document;
  let capture;
  target.setPointerCapture = id => { capture = id; };
  target.hasPointerCapture = id => capture === id;
  target.releasePointerCapture = id => {
    if (capture === id) { capture = undefined; emit(target, 'lostpointercapture', { pointerId: id }); }
  };
  const previews = [], drops = [];
  const drag = createPdfMarkDrag({ onPreview: value => previews.push(value), onDrop: (mark, point) => drops.push({ mark, point }) });
  drag.start({ ...sample(), currentTarget: target }, mark);
  return { drag, view, document, target, previews, drops };
}
function emit(target, type, patch = {}) {
  const event = new Event(type);
  for (const [key, value] of Object.entries(sample(patch))) Object.defineProperty(event, key, { value });
  target.dispatchEvent(event);
  return event;
}

test('global release places the original excerpt exactly once even outside its source button', () => {
  const { drag, view, previews, drops } = setup();
  emit(view, 'pointermove', { clientX: 100, clientY: 150 });
  assert.equal(previews.at(-1).mark, mark);
  const up = emit(view, 'pointerup', { clientX: 200, clientY: 250, buttons: 0 });
  drag.end(up); // The original React button may receive this same release afterward.
  assert.deepEqual(drops, [{ mark, point: { clientX: 200, clientY: 250 } }]);
  assert.equal(previews.at(-1), null);
  assert.equal(drag.pending(), false);
});

test('a normal click keeps the annotation action without creating an excerpt', () => {
  const { drag, view, drops, previews } = setup();
  emit(view, 'pointerup', { buttons: 0 });
  assert.equal(drag.pending(), false);
  assert.equal(previews.at(-1), null);
  assert.equal(drops.length, 0);
});

test('lost capture cancels the ghost and later hovering cannot restart the drag', () => {
  const { drag, view, target, previews, drops } = setup();
  emit(view, 'pointermove', { clientX: 100 });
  target.releasePointerCapture(1);
  assert.equal(drag.pending(), false);
  assert.equal(previews.at(-1), null);
  emit(view, 'pointerup', { buttons: 0, clientX: 200 });
  drag.move(sample({ buttons: 0, clientX: 300 }));
  assert.equal(previews.at(-1), null);
  assert.equal(drops.length, 0);
});

for (const exit of ['pointercancel', 'blur', 'visibilitychange', 'Escape']) {
  test(`${exit} clears an interrupted drag without placing a card`, () => {
    const { drag, view, document, previews, drops } = setup();
    emit(view, 'pointermove', { clientX: 100 });
    if (exit === 'visibilitychange') {
      document.visibilityState = 'hidden';
      emit(document, exit);
    } else if (exit === 'Escape') emit(view, 'keydown', { key: 'Escape' });
    else emit(view, exit);
    assert.equal(drag.pending(), false);
    assert.equal(previews.at(-1), null);
    assert.equal(drops.length, 0);
  });
}

test('a missed pointerup is cleaned up on the first move with no left button', () => {
  const { drag, view, previews, drops } = setup();
  emit(view, 'pointermove', { clientX: 100 });
  emit(view, 'pointermove', { clientX: 110, buttons: 0 });
  assert.equal(drag.pending(), false);
  assert.equal(previews.at(-1), null);
  assert.equal(drops.length, 0);
});

test('another pointer cannot move, finish or cancel the active source', () => {
  const { drag, view, target, previews, drops } = setup();
  emit(view, 'pointermove', { pointerId: 2, clientX: 100 });
  emit(view, 'pointerup', { pointerId: 2, buttons: 0 });
  emit(target, 'lostpointercapture', { pointerId: 2 });
  assert.equal(drag.pending(), true);
  assert.equal(previews.length, 0);
  emit(view, 'pointermove', { clientX: 120 });
  emit(view, 'pointerup', { buttons: 0 });
  assert.equal(drops.length, 1);
});

test('disposing a pending gesture removes its listeners and releases capture', () => {
  const { drag, view, target, previews, drops } = setup();
  drag.cancel();
  assert.equal(target.hasPointerCapture(1), false);
  const count = previews.length;
  emit(view, 'pointermove', { clientX: 100 });
  emit(view, 'pointerup', { buttons: 0 });
  assert.equal(previews.length, count);
  assert.equal(drops.length, 0);
});

test('keyboard annotation activation does not require a real capture target or create a drag', () => {
  const { drag, view, drops } = setup();
  drag.start({ button: 0, clientX: 10, clientY: 20, currentTarget: {} }, mark);
  assert.equal(drag.pending(), false);
  emit(view, 'pointermove', { clientX: 100 });
  drag.end({ type: 'keyboard' });
  assert.equal(drops.length, 0);
});

test('starting again discards the interrupted source and places only the new source', () => {
  const { drag, view, target, drops } = setup();
  emit(view, 'pointermove', { clientX: 100 });
  const next = { ...mark, id: 'next-mark' };
  drag.start({ ...sample({ pointerId: 3 }), currentTarget: target }, next);
  emit(view, 'pointermove', { pointerId: 1, clientX: 200 });
  emit(view, 'pointermove', { pointerId: 3, clientX: 150 });
  emit(view, 'pointerup', { pointerId: 3, buttons: 0 });
  assert.equal(drops.length, 1);
  assert.equal(drops[0].mark.id, next.id);
});

test('ending a guide cancels all live previews before its key guard consumes Escape', () => {
  const first = setup(), second = setup();
  emit(first.view, 'pointermove', { clientX: 100 });
  emit(second.view, 'pointermove', { clientX: 200 });
  cancelPdfMarkDrags();
  for (const state of [first, second]) {
    assert.equal(state.drag.pending(), false);
    assert.equal(state.previews.at(-1), null);
    emit(state.view, 'pointerup', { buttons: 0 });
    assert.equal(state.drops.length, 0);
  }
});
