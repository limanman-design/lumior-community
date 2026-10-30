import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { privateTestSuites, publicTestFiles, selectPublicTests } from '../scripts/test-public.mjs';

void test('public test discovery includes new application suites and explains exact private exclusions', () => {
  assert.deepEqual(selectPublicTests(['new-feature.test.mjs', 'thesis-original-baseline.test.mjs', 'new-feature.test.mjs', 'fixtures.mjs', ...Object.keys(privateTestSuites)]), ['new-feature.test.mjs', 'thesis-original-baseline.test.mjs']);
  for (const reason of Object.values(privateTestSuites)) assert.ok(reason.length > 20);
});

void test('public test runner fails on accidentally reintroduced private imports instead of skipping them', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'lumior-public-tests-'));
  try {
    await mkdir(path.join(root, 'tests'));
    await writeFile(path.join(root, 'tests/new-feature.test.mjs'), "import { privateCode } from '../gateway/src/core.mjs';");
    await assert.rejects(publicTestFiles(root), /depends on a private service/);
    await writeFile(path.join(root, 'tests/new-feature.test.mjs'), "test('public fixture', () => {});");
    assert.deepEqual(await publicTestFiles(root), ['new-feature.test.mjs']);
  } finally { await rm(root, { recursive: true, force: true }); }
});
