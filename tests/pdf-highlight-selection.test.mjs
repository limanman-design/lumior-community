import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const script = ts.transpileModule(readFileSync(new URL('../app/pdf-sheet.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const mark = { id: 'highlight', text: 'Highlighted source text', color: '#f5d84a', fragments: [{ page: 1, rects: [{ x: 10, y: 20, width: 60, height: 5 }] }] };
const flatten = node => !node ? [] : Array.isArray(node) ? node.flatMap(flatten) : typeof node === 'object' ? [node, ...flatten(node.props?.children)] : [];
function fixture(marks = [mark]) {
  const activated = [], dragged = [], selection = {
    isCollapsed: true, anchorNode: {}, cleared: 0,
    removeAllRanges() { this.isCollapsed = true; this.cleared++; },
  };
  const jsx = (type, props) => ({ type, props });
  const dependencies = {
    react: {
      memo: component => component, useRef: current => ({ current }), useMemo: fn => fn(),
      useState: value => [value, () => {}], useEffect() {},
    },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    './i18n': { useI18n: () => ({ t: english => english }) },
    './i18n-core': {}, './pdf-system-messages': {}, './pdf-page-paint': {},
    './pdf-text-selection': { repairPdfSelectionGap() {} },
  };
  const loaded = { exports: {} };
  vm.runInNewContext(script, { exports: loaded.exports, require: name => {
    assert.ok(name in dependencies, name); return dependencies[name];
  } });
  const tree = loaded.exports.PdfPage({
    pdf: {}, number: 1, width: 600, zoom: 1, rasterZoom: 1, hits: [], root: { current: null }, marks,
    onMarkActivate: (point, mark) => activated.push({ point: { ...point }, mark }),
    onMarkDown: (_event, mark) => dragged.push(mark), onMarkMove() {}, onMarkUp() {},
  });
  const surface = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }),
    ownerDocument: { getSelection: () => selection },
    contains: node => node === selection.anchorNode,
  };
  const event = (patch = {}) => ({
    pointerId: 1, button: 0, buttons: 1, detail: 0, pointerType: 'mouse', clientX: 200, clientY: 225,
    target: { closest: selector => selector === '.pdf-selectable-text' }, currentTarget: surface,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; },
    ...patch,
  });
  return { page: tree.props, nodes: flatten(tree), activated, dragged, selection, event };
}

void test('highlighted words allow native selection and only a stationary click opens the saved mark', () => {
  const app = fixture(), down = app.event(), up = app.event({ buttons: 0 });
  const overlay = app.nodes.find(node => node.props?.['data-pdf-mark']);
  assert.equal(overlay.props.onPointerDown, undefined, 'the word overlay must not start an excerpt drag');
  app.page.onPointerDown(down);
  assert.equal(down.defaultPrevented, undefined, 'native text selection must stay enabled');
  assert.equal(app.activated.length + app.dragged.length, 0);
  app.page.onPointerUp(up);
  assert.equal(up.stopped, true);
  assert.deepEqual(app.activated, [{ point: { x: 200, y: 225 }, mark }]);
  assert.equal(app.dragged.length, 0);
});

void test('dragging across a highlight or returning to its origin never opens the old whole annotation', () => {
  for (const returnToOrigin of [false, true]) {
    const app = fixture();
    app.page.onPointerDown(app.event());
    app.page.onPointerMove(app.event({ clientX: 500 }));
    app.page.onPointerUp(app.event({ clientX: returnToOrigin ? 200 : 500, buttons: 0 }));
    assert.equal(app.activated.length + app.dragged.length, 0);
  }
});

void test('a noncollapsed selection wins even over a tiny click movement, including shift and double click selection', () => {
  const app = fixture();
  app.page.onPointerDown(app.event());
  app.selection.isCollapsed = false;
  app.page.onPointerUp(app.event({ clientX: 202, buttons: 0 }));
  assert.equal(app.activated.length + app.dragged.length, 0);
});

void test('starting a fresh drag within blue selected text clears the old anchor without blocking native selection', () => {
  const app = fixture(), down = app.event();
  app.selection.isCollapsed = false;
  app.page.onPointerDown(down);
  assert.equal(app.selection.cleared, 1);
  assert.equal(down.defaultPrevented, undefined);
  app.selection.isCollapsed = false; // The browser establishes the new text range.
  app.page.onPointerMove(app.event({ clientX: 400 }));
  app.page.onPointerUp(app.event({ clientX: 400, buttons: 0 }));
  assert.equal(app.selection.cleared, 1);
  assert.equal(app.activated.length + app.dragged.length, 0);
});

void test('modifier extension, double click and touch keep their native selected-text anchors', () => {
  for (const patch of [{ shiftKey: true }, { metaKey: true }, { ctrlKey: true }, { detail: 2 }, { pointerType: 'touch' }]) {
    const app = fixture(); app.selection.isCollapsed = false;
    app.page.onPointerDown(app.event(patch));
    assert.equal(app.selection.cleared, 0, JSON.stringify(patch));
  }
});

void test('cancel, leaving the page, right button and a second pointer cannot activate a saved highlight', () => {
  for (const reason of ['cancel', 'leave', 'right', 'second']) {
    const app = fixture();
    app.page.onPointerDown(app.event({ button: reason === 'right' ? 2 : 0 }));
    if (reason === 'cancel') app.page.onPointerCancel();
    if (reason === 'leave') app.page.onPointerLeave();
    app.page.onPointerUp(app.event({ pointerId: reason === 'second' ? 2 : 1, buttons: 0 }));
    assert.equal(app.activated.length + app.dragged.length, 0, reason);
  }
});

void test('comment badges and image regions keep their explicit excerpt drags; text marks retain keyboard activation', () => {
  const noted = { ...mark, note: 'Saved note' }, region = { ...mark, id: 'region', image: 'data:image/png;base64,image' };
  const app = fixture([noted, region]);
  const badge = app.nodes.find(node => node.props?.className === 'pdf-note-marker');
  const image = app.nodes.find(node => node.props?.className?.includes('pdf-region-mark'));
  badge.props.onPointerDown(app.event()); image.props.onPointerDown(app.event());
  assert.deepEqual(app.dragged, [noted, region]);
  const text = app.nodes.find(node => node.props?.['data-pdf-mark'] === mark.id);
  const key = app.event({ key: 'Enter' }); text.props.onKeyDown(key);
  assert.equal(key.defaultPrevented, true); assert.equal(app.activated[0].mark, noted);
  assert.equal(app.dragged.length, 2, 'keyboard activation is not a synthetic pointer drag');
});

void test('native text drag is suppressed without suppressing the explicit excerpt handle', () => {
  const app = fixture(), textDrag = app.event(), handleDrag = app.event({ target: { closest: () => false } });
  app.page.onDragStart(textDrag); app.page.onDragStart(handleDrag);
  assert.equal(textDrag.defaultPrevented, true); assert.equal(handleDrag.defaultPrevented, undefined);
});
