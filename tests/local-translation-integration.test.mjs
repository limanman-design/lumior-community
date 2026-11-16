import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import * as translations from '../lib/pdf-translation.ts';
import { sseData } from '../lib/ai-stream.ts';

const require = createRequire(import.meta.url);
const { cleanBackendEnvironment } = require('../desktop/runtime/security.cjs');
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const compile = file => ts.transpileModule(read(file), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

test('desktop launch drops inherited local runner configuration in production and development', () => {
  const inherited = {
    PATH: '/bin', LUMIOR_LOCAL_TRANSLATION_CONFIG: JSON.stringify({ baseUrl: 'https://untrusted.example/v1', token: 'inherited-fixture' }),
    lumior_local_translation_config: 'case-insensitive-fixture', CUSTOM_API_KEY: 'cloud-fixture', NODE_OPTIONS: '--import injected.mjs',
  };
  for (const development of [false, true]) {
    const cleaned = cleanBackendEnvironment(inherited, 'launch-token'.repeat(4), '/trusted/web', development);
    assert.equal(cleaned.PATH, '/bin');
    assert.equal(cleaned.LUMIOR_LOCAL_TRANSLATION_CONFIG, undefined);
    assert.equal(cleaned.lumior_local_translation_config, undefined);
    assert.equal(cleaned.CUSTOM_API_KEY, undefined);
    assert.equal(cleaned.NODE_OPTIONS, undefined);
    assert.equal(cleaned.LUMIOR_DESKTOP_TOKEN, 'launch-token'.repeat(4));
  }
  assert.ok(inherited.LUMIOR_LOCAL_TRANSLATION_CONFIG, 'sanitizing does not mutate the caller environment');
});

test('both desktop backends receive local config only through parent messages and acknowledge clearing', () => {
  for (const file of ['desktop/runtime/backend.mjs', 'desktop/runtime/dev-backend.mjs']) {
    const source = read(file), env = {}, replies = [];
    assert.ok(source.indexOf('delete process.env.LUMIOR_LOCAL_TRANSLATION_CONFIG') < source.indexOf("process.parentPort?.on('message'"));
    let receive;
    const start = source.indexOf("process.parentPort?.on('message'"), end = source.indexOf("process.once('SIGTERM'", start);
    assert.ok(start >= 0 && end > start);
    vm.runInNewContext(source.slice(start, end), {
      process: { env, parentPort: { on: (_event, handler) => { receive = handler; }, postMessage: message => replies.push(message) } },
      stop() {}, applyBackendAiSettings() {},
    });
    const config = { baseUrl: 'http://127.0.0.1:43275/v1', token: 'isolated-fixture-token'.repeat(2), model: 'hy-mt2-1.8b' };
    receive({ data: { type: 'local-translation-settings', requestId: 'enable', config } });
    assert.deepEqual(JSON.parse(env.LUMIOR_LOCAL_TRANSLATION_CONFIG), config);
    assert.equal(replies.at(-1).requestId, 'enable');
    assert.equal(replies.at(-1).config, undefined, 'acknowledgement does not echo credentials');
    receive({ data: { type: 'local-translation-settings', requestId: 'disable' } });
    assert.equal(env.LUMIOR_LOCAL_TRANSLATION_CONFIG, undefined);
    assert.equal(replies.at(-1).requestId, 'disable');
  }
});

test('PDF API route passes the desktop environment as a separate trusted config callback', () => {
  const env = { LUMIOR_LOCAL_TRANSLATION_CONFIG: 'trusted-parent-config' }, module = { exports: {} };
  let callbacks;
  vm.runInNewContext(compile('app/api/translate/route.ts'), {
    module, exports: module.exports, fetch() {},
    require: name => {
      if (name === 'cloudflare:workers') return { env };
      if (name === '@/lib/ai-providers') return { aiSettingsFromEnv: values => ({ source: values }) };
      if (name === '@/lib/pdf-translation-service') return { sharedTranslationRegistry: () => ({}), createPdfTranslationService: (...args) => { callbacks = args; return () => {}; } };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  assert.equal(callbacks[0]().source, env);
  assert.equal(callbacks[3](), 'trusted-parent-config');
  delete env.LUMIOR_LOCAL_TRANSLATION_CONFIG;
  assert.equal(callbacks[3](), undefined, 'stopping the runner revokes the next request');
});

test('desktop packages optional installer code and licenses without embedding model weights or runner archives', () => {
  const metadata = JSON.parse(read('desktop/package.json'));
  for (const file of ['runtime/local-translation.cjs', 'runtime/local-translation-manifest.json']) assert.ok(metadata.build.files.includes(file));
  const packagedInputs = [...metadata.build.files, ...metadata.build.extraResources.map(item => item.from)];
  assert.ok(packagedInputs.every(file => !/(?:\.gguf$|\.tar\.gz$|\.zip$|hy-mt-eval|local-translation-dev|extensions\/)/i.test(file)));
  const build = read('desktop/scripts/build.mjs');
  assert.match(build, /cp\(path\.join\(root, 'licenses\/local-translation'\), path\.join\(generated, 'licenses\/local-translation'\), \{ recursive: true \}\)/);
  assert.ok(metadata.build.extraResources.some(item => item.from === 'generated' && item.to === 'lumior-runtime'));
  const manifest = JSON.parse(read('desktop/runtime/local-translation-manifest.json'));
  assert.deepEqual(Object.keys(manifest.runtimes).sort(), ['darwin-arm64', 'darwin-x64', 'win32-x64']);
  for (const item of manifest.licenses) assert.ok(read(item.file).length > 500);
});

test('local PDF preference is opt-in, desktop-only and defaults to cloud if storage is unavailable', () => {
  const source = compile('app/local-translation-settings.tsx');
  for (const [saved, desktop, blocked, expected] of [[null, true, false, 'cloud'], ['local', true, false, 'local'], ['cloud', true, false, 'cloud'], ['other', true, false, 'cloud'], ['local', false, false, 'cloud'], ['local', true, true, 'cloud']]) {
    const module = { exports: {} };
    vm.runInNewContext(source, {
      module, exports: module.exports,
      localStorage: { getItem: () => { if (blocked) throw new Error('Storage blocked'); return saved; } },
      require: name => name === './desktop-bridge' ? { getDesktopBridge: () => desktop ? { startLocalTranslation() {} } : undefined } : {},
    });
    assert.equal(module.exports.selectedTranslationEngine(), expected);
  }
});

function pdfReader({ engine = 'local', saved, failure = false } = {}) {
  const module = { exports: {} }, sent = [], started = [], stopped = [], changes = [], stateWrites = [];
  const page = { page: 1, text: 'Source sentence.', paragraphs: [{ start: 0, end: 16, rects: [] }] };
  const card = { id: 'current-source', pdf: { url: 'blob:current-source', translation: saved } };
  const bridge = { startLocalTranslation: async lease => { started.push(lease); }, stopLocalTranslation: async lease => { stopped.push(lease); } };
  const dependencies = {
    './feature-flags': { PDF_TRANSLATION_ENABLED: false },
    './local-translation-settings': { selectedTranslationEngine: () => engine },
    './desktop-bridge': { getDesktopBridge: () => bridge },
    './i18n': { useI18n: () => ({ t: english => english }) },
    './pdf-system-messages': { pdfSystemMessage: value => value },
    react: { useEffect() {}, useRef: value => ({ current: value }), useState: value => [typeof value === 'function' ? value() : value, next => stateWrites.push(next)] },
    './document-reading-store': { readingKey: value => value.id, readDocument: async () => ({ pages: [page], total: 1, emptyPages: [] }) },
    '../lib/ai-stream': { sseData }, '../lib/pdf-translation': translations,
    './pdf-translation-session': { cancelTranslationJob: async () => {}, translationOwner: () => 'reader', nextTranslationGeneration: () => 1, waitForTranslationCancellation: async () => {} },
    './pdf-layout-client': { preparePdfLayout: () => assert.fail('Local opt-in must use reflow'), finishPdfLayout: () => assert.fail('Local opt-in must not call layout service') },
  };
  const leaseModule = { exports: {} };
  vm.runInNewContext(compile('app/local-translation-session.ts'), { exports: leaseModule.exports, require: name => dependencies[name] });
  dependencies['./local-translation-session'] = leaseModule.exports;
  vm.runInNewContext(compile('app/use-pdf-translation.ts'), {
    module, exports: module.exports, require: name => { assert.ok(name in dependencies, name); return dependencies[name]; },
    AbortController, crypto: { randomUUID }, setInterval: () => 1, clearInterval() {},
    fetch: async (url, options) => {
      sent.push({ url, body: JSON.parse(options.body) });
      if (failure) return Response.json({ error: 'Local runner unavailable' }, { status: 503 });
      const units = sent.at(-1).body.units.map(unit => ({ ...unit, text: '本地译文。', parts: unit.parts?.map(part => ({ ...part, text: '本地译文。' })) }));
      const events = [{ type: 'start', model: 'local:hy-mt2-1.8b' }, { type: 'translated', units, sourceLanguage: '英语', glossary: [] }, { type: 'done' }];
      return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
    },
  });
  return { hook: module.exports.usePdfTranslation(card, translation => changes.push(translation)), sent, started, stopped, changes, stateWrites };
}
const snapshot = (model, sourceKey = 'current-source:zh-CN:1') => ({ version: 1, sourceKey, target: 'zh-CN', sourceLanguage: '英语', mode: 'reflow', model, units: [{ id: '1:0', page: 1, text: 'Saved text', parts: [{ id: '1:0:0', text: 'Saved text', rects: [] }] }], glossary: [], totalPages: 1, emptyPages: [], complete: true, updatedAt: 1 });

test('paused cloud translation does not block explicit local reflow and always releases the reader lease', async () => {
  assert.match(read('app/feature-flags.ts'), /PDF_TRANSLATION_ENABLED\s*=\s*false/);
  const cloud = pdfReader({ engine: 'cloud' });
  await cloud.hook.start();
  assert.equal(cloud.sent.length + cloud.started.length, 0);
  const local = pdfReader();
  await local.hook.start('original-layout');
  assert.equal(local.sent.length, 1);
  assert.equal(local.sent[0].url, '/api/translate');
  assert.equal(local.sent[0].body.engine, 'local');
  assert.match(local.started[0], /^[a-f0-9]{32}$/);
  assert.deepEqual(local.stopped, local.started);
  assert.equal(local.changes.at(-1).complete, true);
  assert.equal(local.changes.at(-1).mode, 'reflow');
  const failed = pdfReader({ failure: true });
  await failed.hook.start();
  assert.equal(failed.sent.length, 1, 'no retry or cloud fallback');
  assert.deepEqual(failed.stopped, failed.started);
  assert.ok(failed.stateWrites.includes('Local runner unavailable'));
});

test('PDF reuse requires both matching source identity and local engine; cloud cache is never resumed locally', async () => {
  for (const saved of [snapshot('deepseek-flash'), snapshot('local:hy-mt2-1.8b', 'different-source:zh-CN:1')]) {
    const reader = pdfReader({ saved });
    await reader.hook.start();
    assert.equal(reader.sent.length, 1);
    assert.equal(reader.sent[0].body.units[0].text, 'Source sentence.');
    assert.equal(reader.sent[0].body.units[0].referenceText, undefined);
    assert.equal(reader.changes.at(-1).model, 'local:hy-mt2-1.8b');
    assert.equal(reader.changes.at(-1).sourceKey, 'current-source:zh-CN:1');
  }
  const same = pdfReader({ saved: snapshot('local:hy-mt2-1.8b') });
  await same.hook.start();
  assert.equal(same.sent.length + same.started.length, 0, 'completed matching local cache needs no runner');
  assert.equal(same.changes.at(-1).units[0].text, 'Saved text');
});
