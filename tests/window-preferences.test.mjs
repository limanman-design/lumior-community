import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createWindowPreferences, chooseWindowClose } from '../desktop/runtime/window-preferences.cjs';

void test('window preference survives restart, resets to ask, and rejects malformed values', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'lumior-window-test-'));
  try {
    const first = createWindowPreferences(directory);
    await first.load();
    assert.equal(first.get().closeBehavior, 'ask');
    await first.set('minimize');
    const restart = createWindowPreferences(directory);
    await restart.load();
    assert.equal(restart.get().closeBehavior, 'minimize');
    await assert.rejects(restart.set({ closeBehavior: 'quit' }));
    await Promise.all([restart.set('quit'), restart.set('ask')]);
    assert.equal(JSON.parse(await readFile(path.join(directory, 'window-preferences.json'))).closeBehavior, 'ask');
    await writeFile(path.join(directory, 'window-preferences.json'), '{"closeBehavior":"hide"}');
    const damaged = createWindowPreferences(directory);
    await damaged.load();
    assert.equal(damaged.get().closeBehavior, 'ask');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

void test('cancelling never remembers; unremembered decisions ask again; failed writes do not change behavior', async () => {
  const preferences = createWindowPreferences('/synthetic', { mkdir: async () => {}, writeFile: async () => { throw new Error('Full disk'); } });
  let answer = { response: 2, checkboxChecked: true }, prompts = 0;
  const dialog = { showMessageBox: async () => { prompts++; return answer; } };
  assert.equal(await chooseWindowClose({ preferences, dialog }), 'cancel');
  answer = { response: 1, checkboxChecked: false };
  assert.equal(await chooseWindowClose({ preferences, dialog }), 'minimize');
  assert.equal(await chooseWindowClose({ preferences, dialog }), 'minimize');
  assert.equal(prompts, 3);
  answer.checkboxChecked = true;
  await assert.rejects(chooseWindowClose({ preferences, dialog }), /Full disk/);
  assert.equal(preferences.get().closeBehavior, 'ask');
});
