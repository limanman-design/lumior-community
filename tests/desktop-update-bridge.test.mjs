import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const preloadSource = readFileSync(new URL('../desktop/preload.cjs', import.meta.url), 'utf8');

function loadBridge() {
  const ipc = new EventEmitter();
  const invocations = [];
  const sent = [];
  const body = { inert: false, isConnected: true };
  const state = { status: 'downloaded', currentVersion: '0.1.1', version: '0.1.2' };
  let bridge;
  ipc.invoke = async (...args) => { invocations.push(args); return state; };
  ipc.send = (channel, payload) => { sent.push({ channel, payload }); };
  runInNewContext(preloadSource, {
    require(name) {
      assert.equal(name, 'electron');
      return {
        contextBridge: {
          exposeInMainWorld(name, value) {
            assert.equal(name, 'lumiorDesktop');
            bridge = value;
          },
        },
        ipcRenderer: ipc,
      };
    },
    process: { platform: 'darwin' },
    document: { body },
  }, { filename: 'desktop/preload.cjs' });
  return { bridge, ipc, invocations, sent, body, state };
}

void test('renderer update methods use fixed channels with no update configuration or extra payload', async () => {
  const { bridge, invocations, state } = loadBridge();
  const unwantedOptions = { url: 'https://untrusted.example/update', path: '/tmp/update.zip' };
  for (const method of ['getUpdateState', 'checkForUpdates', 'installUpdate']) {
    assert.equal(await bridge[method](unwantedOptions, 'extra'), state);
  }
  assert.deepEqual(invocations, [
    ['lumior:update:get'],
    ['lumior:update:check'],
    ['lumior:update:install'],
  ]);
  assert.equal(Object.isFrozen(bridge), true);
  for (const capability of ['invoke', 'send', 'require', 'setFeedURL', 'downloadUpdate'])
    assert.equal(bridge[capability], undefined);
});

void test('system locale query uses its fixed read-only IPC channel with no renderer arguments', async () => {
  const { bridge, invocations, state } = loadBridge();
  assert.equal(await bridge.getSystemLocale({ command: 'ignored' }, 'ignored'), state);
  assert.deepEqual(invocations, [['lumior:locale:get']]);
});

void test('settings and notice subscriptions are independent and remove exactly their own listener', () => {
  const { bridge, ipc, state } = loadBridge();
  const calls = [];
  const handler = (...args) => calls.push(args);
  const stopSettings = bridge.onUpdateState(handler);
  const stopNotice = bridge.onUpdateState(handler);
  assert.equal(ipc.listenerCount('lumior:update-state'), 2);
  ipc.emit('lumior:update-state', { privilegedEvent: true }, state);
  assert.deepEqual(calls, [[state], [state]]);
  stopSettings();
  stopSettings();
  assert.equal(ipc.listenerCount('lumior:update-state'), 1);
  ipc.emit('lumior:update-state', { privilegedEvent: true }, state);
  assert.equal(calls.length, 3);
  stopNotice();
  assert.equal(ipc.listenerCount('lumior:update-state'), 0);
  const stopReopenedSettings = bridge.onUpdateState(handler);
  stopSettings();
  assert.equal(ipc.listenerCount('lumior:update-state'), 1);
  stopReopenedSettings();
  assert.equal(ipc.listenerCount('lumior:update-state'), 0);
});

void test('invalid update callbacks fail without adding a listener', () => {
  const { bridge, ipc } = loadBridge();
  for (const value of [undefined, null, 'callback', {}, 1]) {
    assert.throws(() => bridge.onUpdateState(value), /An update handler is required/);
  }
  assert.equal(ipc.listenerCount('lumior:update-state'), 0);
});

void test('upgrade save gate locks editing until save resolves and restores editing when quit is cancelled', async () => {
  const { bridge, ipc, sent, body, state } = loadBridge();
  let resolveSave;
  let update;
  const save = new Promise(resolve => { resolveSave = resolve; });
  bridge.onBeforeClose(() => save);
  const stopUpdates = bridge.onUpdateState(value => { update = value; });
  const prepareClose = ipc.listeners('lumior:prepare-close')[0];
  const pending = prepareClose({}, 'first-save');
  assert.equal(body.inert, true);
  assert.equal(sent.length, 0);
  ipc.emit('lumior:update-state', {}, state);
  assert.equal(update, state);
  resolveSave();
  await pending;
  assert.equal(sent.length, 1);
  assert.equal(sent[0].channel, 'lumior:close-ready');
  assert.equal(sent[0].payload.requestId, 'first-save');
  assert.equal(sent[0].payload.saved, true);
  assert.equal(body.inert, true);
  // A second save request must preserve the original unlocked state, so an
  // asynchronous installation failure can still restore the workspace.
  await prepareClose({}, 'second-save');
  ipc.emit('lumior:close-cancelled');
  assert.equal(body.inert, false);
  assert.equal(ipc.listenerCount('lumior:update-state'), 1);
  stopUpdates();
});

void test('save refusal and a reloading workspace report failure and remain editable', async () => {
  const { bridge, ipc, sent, body } = loadBridge();
  const prepareClose = ipc.listeners('lumior:prepare-close')[0];
  const stopSave = bridge.onBeforeClose(async () => { throw new Error('Save failed'); });
  await prepareClose({}, 'save-refused');
  assert.equal(sent[0].payload.saved, false);
  assert.equal(body.inert, false);
  stopSave();
  await prepareClose({}, 'workspace-reloading');
  assert.equal(sent[1].payload.saved, false);
  assert.equal(body.inert, false);
  await prepareClose({}, { notARequestId: true });
  assert.equal(sent.length, 2);
});
