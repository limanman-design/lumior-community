import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const script = ts.transpileModule(readFileSync(new URL('../app/pdf-annotation-editor.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function fixture({ note, contentHeight }) {
  let hidden = false, width = 260;
  const effects = [], observers = [], listeners = new Map();
  const textarea = {
    style: {},
    getClientRects: () => hidden ? [] : [{}],
    get scrollHeight() { return hidden ? 0 : contentHeight(width); },
  };
  const form = { dataset: {}, getBoundingClientRect: () => ({ width: hidden ? 0 : width }) };
  const jsx = (type, props) => {
    if (type === 'textarea') props.ref.current = textarea;
    if (type === 'form') props.ref.current = form;
    return { type, props };
  };
  const dependencies = {
    react: {
      useRef: current => ({ current }), useState: value => [value, () => {}],
      useLayoutEffect: effect => effects.push(effect),
    },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    './i18n': { useI18n: () => ({ t: value => value }) },
    './pdf-selection-position': {}, './pdf-selection-translation': {}, './pdf-annotation-editor.css': {},
  };
  const loaded = { exports: {} };
  vm.runInNewContext(script, {
    exports: loaded.exports,
    require: name => { assert.ok(name in dependencies, name); return dependencies[name]; },
    clearTimeout,
    window: {
      addEventListener: (type, fn) => listeners.set(type, fn),
      removeEventListener: type => listeners.delete(type),
    },
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe(target) { this.target = target; }
      disconnect() { this.disconnected = true; }
    },
  });
  loaded.exports.PdfAnnotationEditor({ anchor: { x: 100, y: 100 }, note });
  const cleanups = effects.map(effect => effect());
  const notifySize = () => {
    for (const observer of observers) if (!observer.disconnected) {
      observer.callback([{ target: form, contentRect: { width: hidden ? 0 : width } }]);
    }
  };
  return {
    textarea, form, observers,
    hide() { hidden = true; notifySize(); },
    resize(next) { width = next; listeners.get('resize')?.(); notifySize(); },
    show() { hidden = false; notifySize(); },
    close() { cleanups.forEach(cleanup => cleanup?.()); },
    listeners,
  };
}

test('resizing while translation hides the note preserves multiline height and scrolling', () => {
  const app = fixture({ note: 'Original note\nAlready saved translation', contentHeight: () => 180 });
  assert.equal(app.textarea.style.height, '120px');
  assert.equal(app.textarea.style.overflowY, 'auto');
  app.hide(); app.resize(200);
  assert.equal(app.textarea.style.height, '120px', 'hidden zero-height measurement must not replace the note layout');
  assert.equal(app.textarea.style.overflowY, 'auto');
  app.show();
  assert.equal(app.textarea.style.height, '120px');
  assert.equal(app.form.dataset.multiline, 'true');
  app.close();
  assert.ok(app.observers.every(observer => observer.disconnected));
  assert.equal(app.listeners.size, 0);
});

test('returning from translation reflows a note when the hidden toolbar became narrower', () => {
  const app = fixture({ note: 'A note that fits on one wide line.', contentHeight: width => width < 240 ? 84 : 44 });
  assert.equal(app.textarea.style.height, '44px');
  app.hide(); app.resize(200);
  assert.equal(app.textarea.style.height, '44px');
  app.show();
  assert.equal(app.textarea.style.height, '84px', 'visible width change must trigger remeasurement without editing the note');
  assert.equal(app.form.dataset.multiline, 'true');
  app.resize(260);
  assert.equal(app.textarea.style.height, '44px');
  assert.equal(app.form.dataset.multiline, 'false');
  app.close();
});
