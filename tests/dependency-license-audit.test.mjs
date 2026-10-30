import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { auditDependencyLicenses } from '../scripts/audit-dependency-licenses.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'lumior-license-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'node_modules/.pnpm'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'synthetic-project', dependencies: { app: '1' }, devDependencies: { tool: '1', electron: '1' }, optionalDependencies: { 'absent-platform': '1' } }));
  const add = async (name, metadata, files = {}) => {
    const directory = path.join(root, 'node_modules/.pnpm', name + '@1/node_modules', name);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name, version: '1.0.0', ...metadata }));
    for (const [file, text] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(directory, file)), { recursive: true });
      await writeFile(path.join(directory, file), text);
    }
    await symlink(directory, path.join(root, 'node_modules', name), 'dir');
  };
  await add('app', { license: 'MPL-2.0', dependencies: { shared: '1' }, repository: { url: 'git+https://user:secret@example.test/app.git?credential=secret#private' } }, { 'LICENSE': 'Synthetic MPL evidence', 'dist/NOTICE.txt': 'Synthetic attribution', 'source.js': 'must not copy this source' });
  await add('tool', { license: 'MIT', dependencies: { shared: '1' } }, { 'license': 'Synthetic MIT evidence' });
  await add('shared', {}, { 'COPYING': 'Synthetic supplied license without a metadata field' });
  await add('electron', { license: 'MIT' }, { 'LICENSE': 'Synthetic shell license', 'dist/LICENSES.chromium.html': '<html>Synthetic bundled notices</html>' });
  await add('stale', { license: 'MIT', os: ['!'+process.platform] });
  return { root, destination: path.join(root, 'evidence') };
}

void test('dependency evidence distinguishes manifest scope, transitive reachability, stale and platform packages', async t => {
  const options = await fixture(t), report = await auditDependencyLicenses(options);
  const byName = new Map(report.packages.map(item => [item.name, item]));
  assert.deepEqual(byName.get('app').direct, ['root:runtime']);
  assert.deepEqual(byName.get('tool').direct, ['root:development']);
  assert.deepEqual(byName.get('shared').reachableFrom, ['root:development', 'root:runtime']);
  assert.equal(byName.get('shared').relationship, 'transitive');
  assert.equal(byName.get('stale').relationship, 'not-reached-from-current-manifests');
  assert.equal(byName.get('stale').platform.osAndCpuMatchAuditHost, false);
  assert.ok(report.packages.every(item => item.distribution === 'not-determined-from-installation'));
  assert.ok(byName.get('electron').review.some(item => item.includes('runtime is redistributed')));
  assert.equal(report.unresolvedDependencies[0].optional, true);
});

void test('license evidence retains unresolved metadata and verbatim notices without copying package source or machine paths', async t => {
  const options = await fixture(t), report = await auditDependencyLicenses(options);
  assert.equal(report.summary.missingLicenseMetadata, 1);
  assert.equal(report.summary.withoutLicenseFiles, 1);
  assert.equal(report.summary.sourceLicenseReview, 1);
  const app = report.packages.find(item => item.name === 'app');
  assert.equal(app.repository, 'https://example.test/app.git');
  assert.deepEqual(app.licenseFiles.map(item => item.path), ['dist/NOTICE.txt', 'LICENSE']);
  assert.ok(app.licenseFiles.every(item => /^[a-f0-9]{64}$/.test(item.sha256)));
  const json = await readFile(path.join(options.destination, 'dependency-licenses.json'), 'utf8');
  const text = await readFile(path.join(options.destination, 'THIRD-PARTY-LICENSE-TEXTS.txt'), 'utf8');
  assert.ok(!json.includes(options.root)); assert.ok(!json.includes('credential=secret'));
  assert.ok(text.includes('Synthetic supplied license without a metadata field'));
  assert.ok(text.includes('<html>Synthetic bundled notices</html>'));
  assert.ok(!text.includes('must not copy this source'));
});
