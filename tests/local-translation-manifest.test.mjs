import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('desktop/runtime/local-translation-manifest.json', root), 'utf8'));

test('local translation downloads are immutable official assets with integrity metadata', () => {
  assert.equal(manifest.version, 1);
  assert.match(manifest.id, /^[a-z0-9][a-z0-9.-]+$/);
  const modelUrl = new URL(manifest.model.url);
  assert.equal(modelUrl.origin, 'https://huggingface.co');
  assert.match(modelUrl.pathname, /^\/tencent\/Hy-MT2-1\.8B-GGUF\/resolve\/[a-f0-9]{40}\/Hy-MT2-1\.8B-Q4_K_M\.gguf$/);
  assert.equal(modelUrl.pathname.split('/')[4], manifest.model.revision);
  assert.equal(path.posix.basename(modelUrl.pathname), manifest.model.filename);
  assert.equal(manifest.model.id, 'hy-mt2-1.8b');
  for (const asset of [manifest.model, ...Object.values(manifest.runtimes)]) {
    const url = new URL(asset.url);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.username, '');
    assert.equal(url.password, '');
    assert.equal(url.search, '');
    assert.equal(url.hash, '');
    assert.match(asset.sha256, /^[a-f0-9]{64}$/);
    assert.ok(Number.isSafeInteger(asset.size) && asset.size > 0);
  }
});

test('each supported desktop has a safe relative server entry point and CPU-capable runtime', () => {
  assert.deepEqual(Object.keys(manifest.runtimes).sort(), ['darwin-arm64', 'darwin-x64', 'win32-x64']);
  for (const [platform, asset] of Object.entries(manifest.runtimes)) {
    const url = new URL(asset.url);
    assert.equal(url.origin, 'https://github.com');
    assert.match(asset.version, /^b\d+$/);
    assert.ok(url.pathname.startsWith(`/ggml-org/llama.cpp/releases/download/${asset.version}/`));
    assert.ok(!path.posix.isAbsolute(asset.executable));
    assert.ok(!path.win32.isAbsolute(asset.executable));
    assert.ok(!asset.executable.split(/[\\/]/).includes('..'));
    assert.ok(!asset.executable.includes('\\'));
    if (platform.startsWith('darwin-')) {
      assert.equal(asset.format, 'tar.gz');
      assert.ok(url.pathname.endsWith(`-macos-${platform.split('-')[1]}.tar.gz`));
      assert.equal(asset.executable, `llama-${asset.version}/llama-server`);
    } else {
      assert.equal(asset.format, 'zip');
      assert.ok(url.pathname.endsWith('-win-cpu-x64.zip'));
      assert.equal(asset.executable, 'llama-server.exe');
    }
  }
});

test('local translation preserves model, runtime and Windows dependency license notices', async () => {
  const required = new Map([
    ['Apache-2.0', /Copyright \(C\) 2026 Tencent/],
    ['MIT', /Copyright \(c\) 2023-2026 The ggml authors/],
    ['Apache-2.0 WITH LLVM-exception', /LLVM Exceptions/],
  ]);
  for (const [license, notice] of required) {
    const item = manifest.licenses.find(entry => entry.license === license);
    assert.ok(item, `Missing ${license} license record`);
    assert.match(item.file, /^licenses\/local-translation\/[a-z0-9.-]+\.txt$/);
    assert.match(await readFile(new URL(item.file, root), 'utf8'), notice);
    assert.equal(new URL(item.source).protocol, 'https:');
  }
});
