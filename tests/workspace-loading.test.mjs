import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the real component with a controlled hook clock, without starting WebGL.
async function mount(initial) {
  let now = 0, cursor = 0, nextId = 0, result, props = initial;
  const slots = [], pending = [], timers = new Map();
  const react = {
    useState(value) {
      const index = cursor++;
      slots[index] ??= { value };
      return [slots[index].value, value => { slots[index].value = value; render(); }];
    },
    useEffect(callback, deps) {
      const index = cursor++, previous = slots[index];
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
        previous?.cleanup?.();
        slots[index] = { deps };
        pending.push(() => { slots[index].cleanup = callback(); });
      }
    },
  };
  const source = await readFile(new URL('../app/workspace-loading.tsx', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const context = {
    exports: {},
    window: { setTimeout(callback, delay) { const id = ++nextId; timers.set(id, { at: now + delay, callback }); return id; }, clearTimeout(id) { timers.delete(id); } },
    require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
      if (name === './i18n') return { useI18n() {} };
      if (name === './i18n-core') return { translate: en => en, translateSystemMessage: text => text };
      if (name.includes('lumior-split-loader')) return { LumiorSplitLoader: 'loader' };
      if (name.endsWith('.css')) return {};
      throw new Error(name);
    },
  };
  vm.runInNewContext(code, context);
  function render() { cursor = 0; result = context.exports.WorkspaceLoading({ onRetry() {}, ...props }); while (pending.length) pending.shift()(); }
  render();
  return {
    get view() { return result; },
    get timerCount() { return timers.size; },
    update(next) { props = next; render(); },
    advance(ms) {
      const end = now + ms;
      while (true) {
        const next = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at; timers.delete(next[0]); next[1].callback();
      }
      now = end;
    },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

void test('fast hydration keeps splash for 3 seconds, then exits with its normal transition', async () => {
  const component = await mount({ ready: true });
  component.advance(2999);
  assert.doesNotMatch(component.view.props.className, /is-ready/);
  const target = {};
  component.view.props.onAnimationEnd({ target, currentTarget: target, animationName: 'workspace-loading-exit' });
  assert.ok(component.view);
  component.advance(1);
  assert.match(component.view.props.className, /is-ready/);
  component.advance(240);
  assert.equal(component.view, null);
});

void test('slow hydration waits for data without starting another three-second wait', async () => {
  const component = await mount({ ready: false });
  component.advance(5000);
  assert.doesNotMatch(component.view.props.className, /is-ready/);
  component.update({ ready: true });
  assert.match(component.view.props.className, /is-ready/);
  component.advance(240);
  assert.equal(component.view, null);
});

void test('errors keep retry visible and unmount clears all pending timers', async () => {
  const component = await mount({ ready: true, error: 'Read failed' });
  component.advance(4000);
  assert.match(component.view.props.className, /has-error/);
  assert.doesNotMatch(component.view.props.className, /is-ready/);
  component.update({ ready: true });
  assert.equal(component.timerCount, 1);
  component.unmount();
  assert.equal(component.timerCount, 0);
  const early = await mount({ ready: false });
  early.unmount();
  assert.equal(early.timerCount, 0);
});
