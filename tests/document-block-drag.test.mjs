import test from 'node:test';
import assert from 'node:assert/strict';
import { registerDocumentBlockDrag } from '../app/document-block-drag.ts';

class FakeDragEvent {
  constructor(type, init = {}) {
    this.type = type;
    Object.assign(this, init);
  }
  preventDefault() { this.defaultPrevented = true; }
  stopImmediatePropagation() { this.stopped = true; }
}

class FakeWindow {
  listeners = new Map();
  getComputedStyle(dom) { return dom.style || { visibility: 'visible', display: 'block' }; }
  addEventListener(type, listener, capture = false) {
    this.listeners.set(type, [...(this.listeners.get(type) || []), { listener, capture }]);
  }
  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item.listener !== listener));
  }
  emit(type, target, dataTransfer, fields = {}) {
    const event = new FakeDragEvent(type, { target, dataTransfer, clientX: 50, clientY: 60, ...fields });
    this.dispatchEvent(event);
    return event;
  }
  dispatchEvent(event) {
    const listeners = [...(this.listeners.get(event.type) || [])].sort((a, b) => Number(b.capture) - Number(a.capture));
    for (const { listener } of listeners) {
      listener(event);
      if (event.stopped) break;
    }
    return !event.defaultPrevented;
  }
}

function setup() {
  const owner = new FakeWindow();
  const transfer = { types: ['blocknote/html', 'text/html', 'text/plain'], effectAllowed: 'move', dropEffect: 'move' };
  const makeEditor = () => {
    const received = [];
    const surface = { contains: target => target.surface === surface };
    const element = {
      ownerDocument: { defaultView: owner },
      surface,
      contains: target => target === element || target.editor === element,
      closest: () => surface,
    };
    const dom = {
      isConnected: true,
      rect: { left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200 },
      contains: target => target === element || (target.editor === element && !target.outsideEditor),
      closest: () => element.inert ? element : null,
      getBoundingClientRect: () => dom.rect,
      dispatchEvent: event => received.push(event),
    };
    let ends = 0;
    const editor = {
      element,
      view: { dom, dragging: { slice: { richBlocks: true } } },
      isEditable: () => true,
      onDragEnd: () => { ends += 1; },
    };
    const dispose = registerDocumentBlockDrag(editor);
    return { ...editor, received, dispose, get ends() { return ends; } };
  };
  const source = makeEditor(), target = makeEditor();
  return { owner, transfer, source, target, dispose: () => { source.dispose(); target.dispose(); } };
}

const originalDragEvent = globalThis.DragEvent;
globalThis.DragEvent = FakeDragEvent;
test.after(() => { globalThis.DragEvent = originalDragEvent; });

void test('cross-editor drops copy the original rich transfer before BlockNote can delete its source', async () => {
  const { owner, transfer, source, target, dispose } = setup();
  owner.emit('dragstart', source.element, transfer);
  assert.equal(transfer.effectAllowed, 'copyMove');
  const over = owner.emit('dragover', target.element, transfer);
  assert.equal(over.defaultPrevented, true);
  assert.equal(transfer.dropEffect, 'copy');
  let nativeDropSeen = false;
  owner.addEventListener('drop', () => { nativeDropSeen = true; }, true);
  const drop = owner.emit('drop', target.element, transfer);
  assert.equal(drop.stopped, true);
  assert.equal(nativeDropSeen, false);
  assert.equal(target.received.length, 1);
  const copy = target.received[0];
  assert.equal(copy.synthetic, true);
  assert.equal(copy.dataTransfer, transfer);
  assert.equal(copy.altKey, true);
  assert.equal(copy.ctrlKey, true);
  assert.deepEqual([copy.clientX, copy.clientY], [50, 60]);
  assert.ok(source.view.dragging.slice);
  assert.ok(target.view.dragging.slice);
  await Promise.resolve();
  assert.equal(source.view.dragging, null);
  assert.equal(target.view.dragging, null);
  assert.equal(source.ends, 1);
  dispose();
});

void test('window-level Tiptap drag source is released before the rich copy reaches target drop handlers', async () => {
  const { owner, transfer, source, target, dispose } = setup();
  let tiptapSource;
  const trackStart = () => { tiptapSource = source; };
  const trackEnd = () => { tiptapSource = undefined; };
  owner.addEventListener('dragstart', trackStart);
  owner.addEventListener('dragend', trackEnd);
  const receive = target.view.dom.dispatchEvent;
  target.view.dom.dispatchEvent = event => {
    assert.equal(tiptapSource, undefined, 'Tiptap must not capture a source to delete');
    assert.ok(target.view.dragging.slice, 'Rich target slice must survive tracker release');
    return receive(event);
  };
  owner.emit('dragstart', source.element, transfer);
  assert.equal(tiptapSource, source);
  owner.emit('drop', target.element, transfer);
  assert.equal(target.received.length, 1);
  assert.equal(source.ends, 0);
  await Promise.resolve();
  assert.equal(source.ends, 1);
  owner.removeEventListener('dragstart', trackStart);
  owner.removeEventListener('dragend', trackEnd);
  dispose();
});

void test('same-editor reordering remains a normal native move and cleans up after handling', async () => {
  const { owner, transfer, source, target, dispose } = setup();
  owner.emit('dragstart', source.element, transfer);
  const drop = owner.emit('drop', source.element, transfer);
  assert.equal(drop.stopped, undefined);
  assert.equal(drop.defaultPrevented, undefined);
  assert.equal(source.received.length, 0);
  assert.equal(target.received.length, 0);
  assert.ok(source.view.dragging);
  await Promise.resolve();
  assert.equal(source.ends, 1);
  dispose();
});

void test('a native dragend clears all editor drag state even if the handle no longer exists', async () => {
  const { owner, transfer, source, target, dispose } = setup();
  owner.emit('dragstart', source.element, transfer);
  owner.emit('dragend', source.element, transfer);
  await Promise.resolve();
  assert.equal(source.ends, 1);
  assert.equal(source.view.dragging, null);
  assert.equal(target.view.dragging, null);
  owner.emit('dragend', source.element, transfer);
  await Promise.resolve();
  assert.equal(source.ends, 1);
  dispose();
});

void test('external and non-document drags continue to their own drop handlers', async () => {
  const { owner, source, target, dispose } = setup();
  const transfer = { types: ['Files'], effectAllowed: 'all' };
  const outside = {};
  owner.emit('dragstart', outside, transfer);
  assert.equal(owner.emit('drop', target.element, transfer).stopped, undefined);
  await Promise.resolve();
  source.view.dragging = null;
  owner.emit('dragstart', source.element, transfer);
  assert.equal(owner.emit('drop', target.element, transfer).stopped, undefined);
  await Promise.resolve();
  assert.equal(target.received.length, 0);
  dispose();
});

void test('BlockNote forwarded events do not recurse and unmount removes the window listeners', () => {
  const { owner, transfer, source, target, dispose } = setup();
  owner.emit('dragstart', source.element, transfer);
  const synthetic = owner.emit('drop', target.element, transfer, { synthetic: true });
  assert.equal(synthetic.stopped, undefined);
  assert.equal(target.received.length, 0);
  dispose();
  assert.equal([...owner.listeners.values()].flat().length, 0);
});

void test('dropping on a Note title uses its nearest visible editor and clamps the insertion point', async () => {
  const { owner, transfer, source, target, dispose } = setup();
  target.view.dom.rect = { left: 300, top: 200, right: 600, bottom: 500, width: 300, height: 300 };
  const title = { surface: target.element.surface, closest: () => null };
  owner.emit('dragstart', source.element, transfer);
  const drop = owner.emit('drop', title, transfer, { clientX: 420, clientY: 160 });
  assert.equal(drop.stopped, true);
  assert.equal(target.received.length, 1);
  assert.deepEqual([target.received[0].clientX, target.received[0].clientY], [420, 201]);
  assert.equal(target.received[0].altKey, true);
  await Promise.resolve();
  dispose();
});

void test('actual DOM hits win and hidden or inert editors cannot attract title and whitespace drops', async () => {
  const { owner, transfer, source, target, dispose } = setup();
  source.view.dom.rect = target.view.dom.rect;
  source.view.dom.style = { visibility: 'hidden', display: 'block' };
  owner.emit('dragstart', source.element, transfer);
  owner.emit('drop', target.element, transfer);
  assert.equal(target.received.length, 1);
  assert.equal(source.received.length, 0);
  await Promise.resolve();
  source.view.dragging = { slice: {} };
  target.element.inert = true;
  const blank = { surface: target.element.surface, closest: () => null };
  owner.emit('dragstart', source.element, transfer);
  const canceled = owner.emit('drop', blank, transfer);
  assert.equal(canceled.stopped, true);
  assert.equal(target.received.length, 1);
  await Promise.resolve();
  dispose();
});

void test('drops on unrelated controls and far whitespace cancel without allowing source deletion', async () => {
  const { owner, transfer, source, target, dispose } = setup();
  const unrelatedButton = { surface: target.element.surface, closest: () => ({ tagName: 'BUTTON' }) };
  owner.emit('dragstart', source.element, transfer);
  const canceled = owner.emit('drop', unrelatedButton, transfer);
  assert.equal(canceled.defaultPrevented, true);
  assert.equal(canceled.stopped, true);
  assert.equal(target.received.length, 0);
  await Promise.resolve();
  source.view.dragging = { slice: {} };
  const blank = { surface: target.element.surface, closest: () => null };
  owner.emit('dragstart', source.element, transfer);
  assert.equal(owner.emit('drop', blank, transfer, { clientX: 500, clientY: 600 }).stopped, true);
  assert.equal(target.received.length, 0);
  await Promise.resolve();
  dispose();
});

void test('same-editor whitespace forwards a clamped move while a drop outside document surfaces cancels', async () => {
  const { owner, transfer, source, dispose } = setup();
  const blank = { surface: source.element.surface, closest: () => null };
  owner.emit('dragstart', source.element, transfer);
  owner.emit('drop', blank, transfer, { clientX: 50, clientY: 220, altKey: false, ctrlKey: false });
  assert.equal(source.received.length, 1);
  assert.equal(source.received[0].ctrlKey, false);
  assert.equal(source.received[0].altKey, false);
  assert.equal(source.received[0].clientY, 199);
  await Promise.resolve();
  source.view.dragging = { slice: {} };
  owner.emit('dragstart', source.element, transfer);
  assert.equal(owner.emit('drop', {}, transfer).stopped, true);
  assert.equal(source.received.length, 1);
  await Promise.resolve();
  dispose();
});
