import test from 'node:test';
import assert from 'node:assert/strict';
import { detectLanguage, getLanguage, initializeLanguage, languageStorageKey, setLanguage } from '../app/i18n-core.ts';

async function withStorage(run, { unavailable = false } = {}) {
  const previousWindow = globalThis.window;
  const stored = new Map();
  globalThis.window = { localStorage: {
    getItem(key) { if (unavailable) throw new Error('Unavailable'); return stored.get(key) ?? null; },
    setItem(key, value) { if (unavailable) throw new Error('Unavailable'); stored.set(key, value); },
  } };
  setLanguage('en', false);
  try { await run(stored); }
  finally { globalThis.window = previousWindow; setLanguage('en', false); }
}

test('supported preferred languages beat region, preserving order and Chinese variants', () => {
  for (const locale of ['zh', 'zh-CN', 'zh-Hant-TW', 'ZH_hans_CN'])
    assert.equal(detectLanguage([locale]), 'zh');
  assert.equal(detectLanguage(['en-GB', 'zh-CN'], 'CN'), 'en');
  assert.equal(detectLanguage(['zh-HK', 'en-US'], 'US'), 'zh');
  assert.equal(detectLanguage(['fr-CA', 'en-CA', 'zh']), 'en');
  assert.equal(detectLanguage(['ja-JP', 'zh-TW']), 'zh');
});

test('OS region supplies a local fallback when no supported language is available', () => {
  for (const region of ['CN', 'TW', 'HK', 'MO', ' cn '])
    assert.equal(detectLanguage(['fr-FR'], region), 'zh');
  assert.equal(detectLanguage(['ja-JP'], 'JP'), 'en');
  assert.equal(detectLanguage([], ''), 'en');
  assert.equal(detectLanguage(['invalid', null, 12]), 'en');
});

test('saved manual preference wins at startup without querying system settings', async () => {
  await withStorage(async stored => {
    stored.set(languageStorageKey, 'en');
    let systemCalls = 0;
    await initializeLanguage({ languages: ['zh-CN'], getSystemLocale: async () => {
      systemCalls++; return { languages: ['zh-CN'], region: 'CN' };
    } });
    assert.equal(getLanguage(), 'en');
    assert.equal(systemCalls, 0);
    assert.equal(stored.get(languageStorageKey), 'en');
  });
});

test('first desktop launch uses OS preferences before Chromium and persists the detected choice', async () => {
  await withStorage(async stored => {
    assert.equal(await initializeLanguage({ languages: ['en-US'], getSystemLocale: async () => ({ languages: ['zh-Hans-CN'], region: 'CN' }) }), 'zh');
    assert.equal(stored.get(languageStorageKey), 'zh');
    await initializeLanguage({ languages: ['en-US'], getSystemLocale: async () => { throw new Error('Should not run after saved'); } });
    assert.equal(getLanguage(), 'zh');
  });
});

test('older desktop or browser startup uses preferred browser language, replacing unsupported saved values', async () => {
  await withStorage(async stored => {
    stored.set(languageStorageKey, 'fr');
    await initializeLanguage({ languages: ['fr-FR', 'zh-TW'], language: 'en-US', getSystemLocale: async () => { throw new Error('Older desktop'); } });
    assert.equal(getLanguage(), 'zh');
    assert.equal(stored.get(languageStorageKey), 'zh');
  });
});

test('manual language choice while native detection is pending wins even when unchanged and storage is unavailable', async () => {
  await withStorage(async () => {
    let resolveSystem;
    const pending = initializeLanguage({ getSystemLocale: () => new Promise(resolve => { resolveSystem = resolve; }) });
    setLanguage('en');
    resolveSystem({ languages: ['zh-CN'], region: 'CN' });
    assert.equal(await pending, 'en');
    assert.equal(getLanguage(), 'en');
  }, { unavailable: true });
});

test('a preference saved by another window while detection is pending wins', async () => {
  await withStorage(async stored => {
    let resolveSystem;
    const pending = initializeLanguage({ getSystemLocale: () => new Promise(resolve => { resolveSystem = resolve; }) });
    stored.set(languageStorageKey, 'en');
    resolveSystem({ languages: ['zh-CN'], region: 'CN' });
    assert.equal(await pending, 'en');
    assert.equal(getLanguage(), 'en');
  });
});

test('clearing the preference detects current system settings again without changing previous saves', async () => {
  await withStorage(async stored => {
    await initializeLanguage({ languages: ['zh-CN'] });
    assert.equal(getLanguage(), 'zh');
    await initializeLanguage({ languages: ['en-GB'] });
    assert.equal(getLanguage(), 'zh');
    stored.delete(languageStorageKey);
    await initializeLanguage({ languages: ['en-GB'] });
    assert.equal(getLanguage(), 'en');
    assert.equal(stored.get(languageStorageKey), 'en');
  });
});

test('storage failure still allows automatic language to apply in this session', async () => {
  await withStorage(async () => {
    assert.equal(await initializeLanguage({ languages: ['zh-Hant-HK'] }), 'zh');
    assert.equal(getLanguage(), 'zh');
  }, { unavailable: true });
});
