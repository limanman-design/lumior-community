import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = ts.transpileModule(
  readFileSync(new URL('../app/pdf-translation-consent.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

function browserStorage() {
  const values = new Map(), writes = [];
  return {
    values,
    writes,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, String(value));
      writes.push([key, String(value)]);
    },
  };
}

// Each module context represents a separate tab or a fresh page load.
function loadConsent(localStorage) {
  const loadedModule = { exports: {} };
  vm.runInNewContext(source, { module: loadedModule, exports: loadedModule.exports, localStorage }, {
    filename: 'pdf-translation-consent.ts',
  });
  return loadedModule.exports;
}

test('opening or cancelling the notice without confirming leaves the document and preference unacknowledged', () => {
  const storage = browserStorage(), consent = loadConsent(storage);
  storage.values.set('unrelated-preference', 'unchanged');
  const before = [...storage.values];

  // Dismissing the dialog does not call acknowledgeTranslationConsent.
  assert.equal(consent.needsTranslationConsent('paper-a'), true);
  assert.equal(consent.needsTranslationConsent('paper-a'), true);
  assert.equal(consent.needsTranslationConsent('paper-b'), true);
  assert.deepEqual([...storage.values], before);
  assert.deepEqual(storage.writes, []);
});

test('confirming without remembering applies only to this document in the current tab', () => {
  const storage = browserStorage(), currentTab = loadConsent(storage);
  currentTab.acknowledgeTranslationConsent('paper-a', false);

  assert.equal(currentTab.needsTranslationConsent('paper-a'), false);
  assert.equal(currentTab.needsTranslationConsent('paper-b'), true);
  assert.deepEqual(storage.writes, []);
  assert.equal(loadConsent(storage).needsTranslationConsent('paper-a'), true);
  assert.equal(loadConsent(storage).needsTranslationConsent('paper-b'), true);
});

test('remembering confirmation suppresses notices across documents, tabs and module reloads', () => {
  const storage = browserStorage(), firstTab = loadConsent(storage);
  firstTab.acknowledgeTranslationConsent('paper-a', true);

  assert.equal(firstTab.needsTranslationConsent('paper-a'), false);
  assert.equal(firstTab.needsTranslationConsent('paper-b'), false);
  assert.equal(storage.writes.length, 1);
  const reloadedTab = loadConsent(storage);
  assert.equal(reloadedTab.needsTranslationConsent('paper-a'), false);
  assert.equal(reloadedTab.needsTranslationConsent('paper-c'), false);
  assert.equal(loadConsent(storage).needsTranslationConsent('paper-d'), false);
});

test('unavailable or blocked storage still allows confirmation for the current document', () => {
  const blocked = {
    getItem: () => { throw new Error('Storage access blocked'); },
    setItem: () => { throw new Error('Storage access blocked'); },
  };
  for (const storage of [undefined, blocked]) {
    const consent = loadConsent(storage);
    assert.equal(consent.needsTranslationConsent('paper-a'), true);
    assert.doesNotThrow(() => consent.acknowledgeTranslationConsent('paper-a', true));
    assert.equal(consent.needsTranslationConsent('paper-a'), false);
    assert.equal(consent.needsTranslationConsent('paper-b'), true);
    assert.equal(loadConsent(storage).needsTranslationConsent('paper-a'), true);
  }
});

test('a failed preference write does not prevent translation or silently acknowledge other documents', () => {
  const storage = browserStorage();
  storage.setItem = () => { throw new Error('Storage quota exceeded'); };
  const consent = loadConsent(storage);

  assert.doesNotThrow(() => consent.acknowledgeTranslationConsent('paper-a', true));
  assert.equal(consent.needsTranslationConsent('paper-a'), false);
  assert.equal(consent.needsTranslationConsent('paper-b'), true);
  assert.equal(storage.values.size, 0);
  assert.equal(loadConsent(storage).needsTranslationConsent('paper-a'), true);
});
