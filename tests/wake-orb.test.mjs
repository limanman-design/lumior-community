import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = ts.transpileModule(readFileSync(new URL('../app/wake-orb.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
}).outputText;

function mount(compact = true, reducedMotion = false, active = true) {
  let now = 0, next = 0, paints = 0, cleanup, observer, disconnected = false;
  const frames = new Map(), listeners = new Map(), preferenceListeners = new Map();
  const context = Object.fromEntries(['setTransform', 'save', 'beginPath', 'arc', 'clip', 'restore', 'fill'].map(name => [name, () => {}]));
  context.clearRect = () => paints++;
  const button = { addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 36, height: 40 }) };
  const canvas = { width: compact ? 86 : 172, height: compact ? 86 : 172, parentElement: button, getContext: () => context };
  const reduced = { matches: reducedMotion, addEventListener: (name, callback) => preferenceListeners.set(name, callback), removeEventListener: name => preferenceListeners.delete(name) };
  const document = { hidden: false, addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: name => listeners.delete(name) };
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, exports: module.exports,
    require: name => name === 'react' ? { useRef: () => ({ current: canvas }), useEffect: effect => { cleanup = effect(); } } : { jsx: (tag, props) => ({ tag, props }) },
    window: { matchMedia: () => reduced }, document, performance: { now: () => now },
    requestAnimationFrame: callback => { frames.set(++next, callback); return next; },
    cancelAnimationFrame: id => frames.delete(id),
    IntersectionObserver: class { constructor(callback) { observer = callback; } observe() {} disconnect() { disconnected = true; } },
  });
  const output = module.exports.WakeOrb({ compact, active });
  return {
    output, frames, paints: () => paints, disconnected: () => disconnected, cleanup: () => cleanup(), listeners,
    advance: time => { now = time; const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(time)); },
    hidden: hidden => { document.hidden = hidden; listeners.get('visibilitychange')(); },
    visible: visible => observer([{ isIntersecting: visible }]),
    reduced: matches => { reduced.matches = matches; preferenceListeners.get('change')(); },
  };
}

test('compact orb limits drawing to 30 fps and uses a smaller rendering buffer', () => {
  const orb = mount();
  for (let frame = 0; frame <= 60; frame++) orb.advance(frame * 1000 / 60);
  assert.ok(orb.paints() >= 29 && orb.paints() <= 32, `Unexpected frame count: ${orb.paints()}`);
  assert.equal(orb.output.props.width, 86);
  assert.equal(orb.output.props.height, 86);
  orb.cleanup();
});

test('offscreen/background pause, resume, reduced motion and unmount release animation work', () => {
  const orb = mount();
  orb.advance(0);
  orb.hidden(true);
  assert.equal(orb.frames.size, 0);
  const paused = orb.paints();
  orb.advance(1000);
  assert.equal(orb.paints(), paused);
  orb.hidden(false);
  assert.equal(orb.frames.size, 1);
  orb.visible(false);
  assert.equal(orb.frames.size, 0);
  orb.visible(true);
  assert.equal(orb.frames.size, 1);
  orb.reduced(true);
  assert.equal(orb.frames.size, 0);
  assert.ok(orb.paints() > paused);
  orb.reduced(false);
  assert.equal(orb.frames.size, 1);
  orb.cleanup();
  assert.equal(orb.frames.size, 0);
  assert.equal(orb.listeners.size, 0);
  assert.equal(orb.disconnected(), true);
});

test('default orb retains its original buffer and reduced motion draws only a static field', () => {
  const orb = mount(false, true);
  assert.equal(orb.output.props.width, 172);
  assert.equal(orb.paints(), 1);
  assert.equal(orb.frames.size, 0);
  orb.cleanup();
});

test('inactive card glyph remains painted and never resumes animation on visibility changes', () => {
  const orb = mount(true, false, false);
  assert.equal(orb.paints(), 1);
  assert.equal(orb.frames.size, 0);
  orb.advance(1000);
  assert.equal(orb.paints(), 1);
  orb.hidden(true);
  orb.hidden(false);
  orb.visible(false);
  orb.visible(true);
  orb.reduced(true);
  orb.reduced(false);
  assert.ok(orb.paints() > 1, 'static glyph repaints when it becomes visible');
  assert.equal(orb.frames.size, 0);
  orb.cleanup();
  assert.equal(orb.listeners.size, 0);
  assert.equal(orb.disconnected(), true);
});
