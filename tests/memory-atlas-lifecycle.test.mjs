import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryAtlas } from '../app/vendor/memory-atlas/memory-atlas.js';

// Exercise the real runtime against instrumented browser resources. Shader
// compilation/visual appearance are separately checked in the live browser.
function browser(width = 390, height = 780) {
  let now = 0, sequence = 0, contexts = 0, paints = 0, sizeWrites = 0;
  const frames = new Map(), observers = new Set(), listeners = new Map(), documentListeners = new Map(), uniforms = new Map();
  const noop = () => {};
  const drawing = new Proxy({
    createRadialGradient: () => ({ addColorStop: noop }),
    createLinearGradient: () => ({ addColorStop: noop }),
    clearRect: () => paints++, measureText: text => ({ width: text.length * 8 }),
  }, { get: (object, key) => object[key] ?? noop });
  function webgl() {
    contexts++;
    let released = false;
    return new Proxy({
      createShader: () => ({}), createProgram: () => ({}), createBuffer: () => ({}), createTexture: () => ({}),
      getShaderParameter: () => true, getProgramParameter: () => true, getUniformLocation: (_, name) => name,
      uniform1f: (name, value) => uniforms.set(name, value),
      uniform2f: (name, x, y) => uniforms.set(name, [x, y]),
      getExtension: name => name === 'WEBGL_lose_context' ? { loseContext() { if (!released) contexts--; released = true; } } : null,
    }, { get: (object, key) => object[key] ?? (key === key.toUpperCase() ? 1 : noop) });
  }
  class Element {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.style = {}; this.dataset = {}; this.events = new Map(); this.attributes = {}; this.classList = { add: noop, remove: noop, toggle: noop }; }
    get width() { return this._width ?? 0; }
    set width(value) { this._width = value; sizeWrites++; }
    get height() { return this._height ?? 0; }
    set height(value) { this._height = value; sizeWrites++; }
    append(...elements) { for (const element of elements) { element.parentElement = this; this.children.push(element); } }
    replaceChildren(...elements) { this.children = []; this.append(...elements); }
    setAttribute(name, value) { this.attributes[name] = value; }
    getBoundingClientRect() { return { left: 0, top: 0, width, height }; }
    getContext(type) { return type === '2d' ? drawing : (this.gl ||= webgl()); }
    addEventListener(name, callback) { this.events.set(name, callback); }
    removeEventListener(name) { this.events.delete(name); }
    setPointerCapture() {}
    matches() { return false; }
    contains(element) { return this.children.includes(element); }
    remove() { this.parentElement.children = this.parentElement.children.filter(element => element !== this); }
    querySelectorAll() { return []; }
  }
  class Observer {
    constructor(callback) { this.callback = callback; observers.add(this); }
    observe() {}
    disconnect() { observers.delete(this); }
  }
  const window = { IntersectionObserver: Observer, addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: name => listeners.delete(name) };
  const document = { createElement: tag => new Element(tag), head: new Element('head'), activeElement: null, hidden: false,
    addEventListener: (name, callback) => documentListeners.set(name, callback), removeEventListener: name => documentListeners.delete(name) };
  Object.assign(globalThis, {
    document, window,
    getComputedStyle: () => ({ position: 'relative' }), devicePixelRatio: 1, matchMedia: () => ({ matches: false }),
    ResizeObserver: Observer, IntersectionObserver: Observer, performance: { now: () => now },
    requestAnimationFrame: callback => { frames.set(++sequence, callback); return sequence; },
    cancelAnimationFrame: id => frames.delete(id),
    // Hint dismissal is unrelated to rendering; avoid a real timer holding the test process.
    setTimeout: noop,
  });
  const container = new Element('div');
  return {
    container, frames, observers, listeners, documentListeners, uniforms,
    contexts: () => contexts, paints: () => paints, sizeWrites: () => sizeWrites,
    visibility(hidden) { document.hidden = hidden; documentListeners.get('visibilitychange')?.(); },
    intersection(visible) { [...observers][1].callback([{ isIntersecting: visible }]); },
    size(w, h) { width = w; height = h; },
    frame(time) { now = time; const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(time)); },
    pointer(name, id, x, y) {
      const fx = container.children[0].children.find(element => element.className === 'ma-fx');
      fx.events.get(name)({ pointerId: id, clientX: x, clientY: y, pointerType: 'touch' });
    },
  };
}
const data = { categories: [{ id: 'note', name: 'Note', color: '#60d6ff' }], memories: [{ id: 'a', title: 'Original card', date: '2026-07-01', categoryId: 'note', understanding: .6, links: [] }], fragments: [] };
const options = { data, ui: { brand: false, card: false }, autoLink: false, loadFonts: false, idleDrift: false };

test('repeated mount/destroy releases the real animation, observers, keyboard listener and WebGL context', () => {
  const environment = browser();
  for (let cycle = 0; cycle < 10; cycle++) {
    const atlas = createMemoryAtlas(environment.container, options);
    environment.frame(cycle * 4000);
    assert.equal(environment.container.children.length, 1);
    assert.equal(environment.contexts(), 1);
    assert.equal(environment.frames.size, 1);
    atlas.destroy();
    assert.equal(environment.contexts(), 0);
    assert.equal(environment.frames.size, 0);
    assert.equal(environment.observers.size, 0);
    assert.equal(environment.listeners.size, 0);
    assert.equal(environment.documentListeners.size, 0);
    assert.equal(environment.container.children.length, 0);
    const before = environment.paints(); environment.frame(cycle * 4000 + 1000);
    assert.equal(environment.paints(), before);
  }
});

test('hidden tabs and offscreen hosts stop frames; resuming keeps the same instance and one animation loop', () => {
  const environment = browser();
  const atlas = createMemoryAtlas(environment.container, options);
  environment.frame(0); environment.frame(1000);
  const before = environment.paints();
  environment.visibility(true);
  assert.equal(environment.frames.size, 0);
  environment.frame(20000);
  assert.equal(environment.paints(), before);
  assert.equal(environment.contexts(), 1);
  environment.intersection(false);
  environment.visibility(false);
  assert.equal(environment.frames.size, 0, 'document visibility cannot override an offscreen host');
  environment.intersection(true);
  environment.visibility(false);
  assert.equal(environment.frames.size, 1, 'repeated resume events do not start another loop');
  environment.frame(20016);
  assert.equal(environment.paints(), before + 1);
  assert.equal(environment.contexts(), 1);
  atlas.destroy();
  environment.visibility(true); environment.visibility(false);
  assert.equal(environment.frames.size, 0);
  assert.equal(environment.documentListeners.size, 0);
});

test('mounting in a hidden tab schedules no rendering until it becomes visible', () => {
  const environment = browser(); environment.visibility(true);
  const atlas = createMemoryAtlas(environment.container, options);
  assert.equal(environment.frames.size, 0);
  environment.frame(5000);
  assert.equal(environment.paints(), 0);
  environment.visibility(false);
  assert.equal(environment.frames.size, 1);
  environment.frame(5016);
  assert.equal(environment.paints(), 1);
  atlas.destroy();
});

test('unchanged resize notifications keep canvas buffers; real dimensions and DPR changes still resize', () => {
  const environment = browser();
  const atlas = createMemoryAtlas(environment.container, options);
  const before = environment.sizeWrites();
  atlas.resize(); atlas.resize();
  assert.equal(environment.sizeWrites(), before);
  environment.size(500, 800); atlas.resize();
  assert.equal(environment.sizeWrites(), before + 4);
  const canvases = environment.container.children[0].children.filter(element => element.tagName === 'CANVAS');
  assert.deepEqual(canvases.map(canvas => [canvas.width, canvas.height]), [[500, 800], [500, 800]]);
  globalThis.devicePixelRatio = 2; atlas.resize();
  assert.deepEqual(canvases.map(canvas => [canvas.width, canvas.height]), [[1000, 1600], [1000, 1600]]);
  atlas.destroy();
});

test('selection returns the exact source object; scene transitions and empty data remain usable', () => {
  const environment = browser(); let selected;
  const atlas = createMemoryAtlas(environment.container, { ...options, onSelect: item => { selected = item; } });
  environment.frame(0); atlas.select('a');
  assert.equal(selected.source, data.memories[0]);
  atlas.setScene('galaxy'); environment.frame(600); environment.frame(1600);
  assert.equal(atlas.getScene(), 'galaxy');
  atlas.setData({ memories: [], fragments: [] }); environment.frame(2000);
  assert.equal(atlas.getSelected(), null);
  atlas.setScene('shore'); environment.frame(2600); environment.frame(3600);
  assert.equal(atlas.getScene(), 'shore'); atlas.destroy();
});

test('phone-width single-pointer stirring preserves the camera and a two-pointer pinch pans and zooms', () => {
  const environment = browser();
  const atlas = createMemoryAtlas(environment.container, options);
  for (let time = 0; time <= 6000; time += 50) environment.frame(time);
  const initial = environment.uniforms.get('uCam');
  environment.pointer('pointerdown', 1, 90, 300);
  environment.pointer('pointermove', 1, 120, 330);
  environment.frame(6050);
  assert.deepEqual(environment.uniforms.get('uCam'), initial);
  const zoom = environment.uniforms.get('uZoom');
  environment.pointer('pointerdown', 2, 220, 330);
  environment.pointer('pointermove', 2, 290, 360);
  environment.frame(6100);
  assert.ok(environment.uniforms.get('uZoom') > zoom);
  assert.notDeepEqual(environment.uniforms.get('uCam'), initial);
  environment.pointer('pointerup', 1, 120, 330);
  environment.pointer('pointerup', 2, 290, 360);
  atlas.destroy();
});
