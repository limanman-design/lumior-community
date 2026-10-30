'use strict';
/* oxlint-disable typescript/no-require-imports -- Electron main uses CommonJS. */
const fs = require('node:fs/promises');
const path = require('node:path');

const behaviors = new Set(['ask', 'quit', 'minimize']);
function createWindowPreferences(directory, storage = fs) {
  const file = path.join(directory, 'window-preferences.json');
  let closeBehavior = 'ask', queue = Promise.resolve();
  return {
    async load() {
      try {
        const saved = JSON.parse(await storage.readFile(file, 'utf8'));
        if (behaviors.has(saved.closeBehavior)) closeBehavior = saved.closeBehavior;
      } catch { /* Missing or damaged preferences return to asking. */ }
    },
    get: () => ({ closeBehavior }),
    set(value) {
      if (!behaviors.has(value)) return Promise.reject(new Error('Unknown window close behavior.'));
      const save = queue.then(async () => {
        await storage.mkdir(directory, { recursive: true });
        await storage.writeFile(`${file}.tmp`, JSON.stringify({ closeBehavior: value }), { mode: 0o600 });
        await storage.rename(`${file}.tmp`, file);
        closeBehavior = value;
        return { closeBehavior };
      });
      queue = save.catch(() => {});
      return save;
    },
  };
}

async function chooseWindowClose({ window, preferences, dialog, english = false }) {
  const { closeBehavior } = preferences.get();
  if (closeBehavior !== 'ask') return closeBehavior;
  const answer = await dialog.showMessageBox(window, {
    type: 'question', title: 'Lumior',
    message: english ? 'Close Lumior?' : '关闭 Lumior？',
    detail: english ? 'Minimize keeps Lumior running in the taskbar. Exit saves your workspace and closes the app. You can change this in Settings.' : '最小化后仍在任务栏运行；退出会保存工作区并关闭应用。之后可在设置中更改。',
    buttons: english ? ['Exit Lumior', 'Minimize to taskbar', 'Cancel'] : ['退出 Lumior', '最小化到任务栏', '取消'],
    defaultId: 1, cancelId: 2,
    checkboxLabel: english ? 'Remember my choice' : '记住我的选择', checkboxChecked: false,
    noLink: true,
  });
  const behavior = answer.response === 0 ? 'quit' : answer.response === 1 ? 'minimize' : 'cancel';
  if (behavior !== 'cancel' && answer.checkboxChecked) {
    try { await preferences.set(behavior); }
    catch (error) { error.code = 'WINDOW_PREFERENCE_SAVE'; throw error; }
  }
  return behavior;
}

module.exports = { createWindowPreferences, chooseWindowClose };
