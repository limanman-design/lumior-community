import test from 'node:test';
import assert from 'node:assert/strict';
import { createLibraryCardDrag } from '../app/card-library-drag.ts';

const first = { id: 'first-pdf', kind: 'pdf', title: 'First PDF' };
const second = { id: 'second-pdf', kind: 'pdf', title: 'Second PDF' };
const sample = (patch = {}) => ({
  button: 0, pointerId: 1, clientX: 10, clientY: 20, buttons: 1, ...patch,
});
function emit(target, type, patch = {}) {
  const event = new Event(type);
  for (const [key, value] of Object.entries(sample(patch)))
    Object.defineProperty(event, key, { value });
  target.dispatchEvent(event);
}
function setup() {
  const view = new EventTarget(), document = new EventTarget(), target = new EventTarget();
  document.defaultView = view;
  document.visibilityState = 'visible';
  target.ownerDocument = document;
  let capture;
  target.setPointerCapture = id => { capture = id; };
  target.hasPointerCapture = id => capture === id;
  target.releasePointerCapture = id => {
    if (capture === id) {
      capture = undefined;
      emit(target, 'lostpointercapture', { pointerId: id });
    }
  };
  const previews = [], drops = [], activations = [];
  const drag = createLibraryCardDrag({
    onPreview: preview => previews.push(preview),
    onDrop: (card, point) => drops.push({ card, point }),
    onActivate: () => activations.push(true),
  });
  const start = (card = first, patch = {}) =>
    drag.start({ ...sample(patch), currentTarget: target }, card);
  return { view, document, target, previews, drops, activations, drag, start };
}

test('consecutive PDF drags each place their own source once and clear the preview', () => {
  const s = setup();
  for (const card of [first, second, first]) {
    s.start(card);
    emit(s.view, 'pointermove', { clientX: 150 });
    assert.equal(s.previews.at(-1).title, card.title);
    emit(s.view, 'pointerup', { clientX: 240, clientY: 350, buttons: 0 });
    emit(s.view, 'pointerup', { buttons: 0 });
    assert.equal(s.previews.at(-1), null);
    assert.equal(s.target.hasPointerCapture(1), false);
  }
  assert.deepEqual(s.drops, [first, second, first].map(card => ({
    card, point: { clientX: 240, clientY: 350 },
  })));
  assert.equal(s.activations.length, 3);
});

test('second drag still drops after its tile loses capture and stops receiving events', () => {
  const s = setup();
  s.start();
  emit(s.view, 'pointermove', { clientX: 120 });
  emit(s.view, 'pointerup', { buttons: 0 });
  s.start(second);
  emit(s.view, 'pointermove', { clientX: 150 });
  s.target.releasePointerCapture(1);
  // A moved/removed tile cannot receive pointerup; the window still receives it.
  emit(s.view, 'pointermove', { clientX: 220 });
  emit(s.view, 'pointerup', { clientX: 240, clientY: 350, buttons: 0 });
  assert.equal(s.drops.length, 2);
  assert.equal(s.drops[1].card, second);
  assert.equal(s.previews.at(-1), null);
});

test('unavailable capture still allows an immediate window release', () => {
  const s = setup();
  s.target.setPointerCapture = () => { throw new Error('Detached source'); };
  s.start();
  emit(s.view, 'pointermove', { clientX: 200 });
  emit(s.view, 'pointerup', { buttons: 0 });
  assert.equal(s.drops.length, 1);
  assert.equal(s.previews.at(-1), null);
});

test('click and small jitter keep preview selection without adding a card', () => {
  const s = setup();
  s.start();
  emit(s.view, 'pointermove', { clientX: 13, clientY: 22 });
  emit(s.view, 'pointerup', { buttons: 0 });
  assert.equal(s.drops.length, 0);
  assert.equal(s.activations.length, 0);
});

for (const exit of ['pointercancel', 'blur', 'visibilitychange', 'Escape', 'unmount', 'missed-release']) {
  test(`${exit} clears the gesture and the next PDF can be dragged normally`, () => {
    const s = setup();
    s.start();
    emit(s.view, 'pointermove', { clientX: 120 });
    if (exit === 'visibilitychange') {
      s.document.visibilityState = 'hidden';
      emit(s.document, exit);
      s.document.visibilityState = 'visible';
    } else if (exit === 'Escape') emit(s.view, 'keydown', { key: 'Escape' });
    else if (exit === 'unmount') s.drag.cancel();
    else if (exit === 'missed-release') emit(s.view, 'pointermove', { clientX: 150, buttons: 0 });
    else emit(s.view, exit);
    assert.equal(s.previews.at(-1), null);
    const count = s.previews.length;
    emit(s.view, 'pointermove', { clientX: 300, buttons: 0 });
    emit(s.view, 'pointerup', { buttons: 0 });
    assert.equal(s.previews.length, count);
    assert.equal(s.drops.length, 0);
    s.start(second);
    emit(s.view, 'pointermove', { clientX: 120 });
    emit(s.view, 'pointerup', { buttons: 0 });
    assert.equal(s.drops.length, 1);
    assert.equal(s.drops[0].card, second);
  });
}

test('other pointers cannot move, finish or cancel the original source', () => {
  const s = setup();
  s.start();
  emit(s.view, 'pointermove', { pointerId: 2, clientX: 120 });
  emit(s.view, 'pointerup', { pointerId: 2, buttons: 0 });
  emit(s.view, 'pointercancel', { pointerId: 2 });
  assert.equal(s.previews.length, 0);
  emit(s.view, 'pointermove', { clientX: 120 });
  emit(s.view, 'pointerup', { buttons: 0 });
  assert.equal(s.drops.length, 1);
  assert.equal(s.drops[0].card, first);
});

test('starting again discards an interrupted source and owns the new PDF', () => {
  const s = setup();
  s.start();
  emit(s.view, 'pointermove', { clientX: 120 });
  s.start(second, { pointerId: 3 });
  emit(s.view, 'pointerup', { buttons: 0 });
  emit(s.view, 'pointermove', { pointerId: 3, clientX: 120 });
  emit(s.view, 'pointerup', { pointerId: 3, buttons: 0 });
  assert.equal(s.drops.length, 1);
  assert.equal(s.drops[0].card, second);
});
