import { readdir, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

// These suites stay in the private integration/deployment project. Exclusions
// are explicit, reviewed boundaries, never guesses based on a failing import.
// Application tests are discovered automatically, so new regressions run by default.
export const privateTestSuites = Object.freeze({
  'open-source-assets.test.mjs': 'Private preparation asset transforms; candidate sound behavior is tested in sound.test.mjs.',
  'open-source-export.test.mjs': 'Private allowlist exporter; never included in the public application.',
  'private-workspace-migration.test.mjs': 'Private historical source-pair IDs; public normalization tests use synthetic identities.',
  'open-source-transforms.test.mjs': 'Private-source export anchors; candidate output is validated by the public application suite.',
  'ai-runtime.test.mjs': 'Actual gateway/ledger integration. Public runtime protocol coverage is in public-ai-runtime.test.mjs and ai-trial.test.mjs.',
  'trial-gateway.test.mjs': 'Private gateway implementation and operations.',
  'trial-gateway-workerd.test.mjs': 'Private gateway on its actual deployment runtime.',
  'project-admin.test.mjs': 'Private operations UI and internal document inventory.',
  'thesis-gateway-catalog.test.mjs': 'Official server pricing configuration; public prompt baselines remain enabled.',
  'private-document-report.test.mjs': 'Internal historical report and its screenshots.',
  'private-demo-integration.test.mjs': 'Official hosted Demo examples and packaging.',
  'public-demo.test.mjs': 'Hosted Demo export and deployment scripts.',
  'public-demo-mba.test.mjs': 'Hosted Demo source papers and attribution inventory.',
  'public-demo-seed.test.mjs': 'Hosted Demo example workspace and organization.',
  'public-demo-drawer.test.mjs': 'Hosted Demo-only transformation and bundle.',
  'research-board-compatibility.test.mjs': 'Private research workspace migration fixtures; generic workspace persistence tests remain enabled.',
  'research-board-reorganization.test.mjs': 'Private research workspace reorganization fixtures.',
  'demo-layout.test.mjs': 'Historical Game Studies example geometry and assets.',
});

export function selectPublicTests(files) {
  return [...new Set(files)].filter(file => /^[a-zA-Z0-9._-]+\.test\.mjs$/.test(file) && !Object.hasOwn(privateTestSuites, file)).sort((a, b) => a.localeCompare(b, 'en'));
}

export async function publicTestFiles(root = fileURLToPath(new URL('../', import.meta.url))) {
  const files = selectPublicTests(await readdir(path.join(root, 'tests')));
  if (!files.length) throw new Error('No public application tests found.');
  for (const file of files) {
    const source = await readFile(path.join(root, 'tests', file), 'utf8');
    // Fail on accidental recoupling instead of silently dropping a test. This
    // checks literal private dependencies; clean-export validation checks the
    // complete transitive dependency graph by actually running the suite.
    let privateDependency = false;
    const visit = node => {
      const specifier = ts.isImportDeclaration(node) || ts.isExportDeclaration(node) ? node.moduleSpecifier
        : (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText() === 'require'))
          || (ts.isNewExpression(node) && node.expression.getText() === 'URL') ? node.arguments?.[0] : undefined;
      if (specifier && ts.isStringLiteralLike(specifier) && /^\.\.\/(?:gateway|admin)\//.test(specifier.text)) privateDependency = true;
      ts.forEachChild(node, visit);
    };
    visit(ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS));
    if (privateDependency) {
      throw new Error(`Public test ${file} depends on a private service. Split its protocol and integration assertions.`);
    }
  }
  return files;
}

async function main() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const arguments_ = process.argv.slice(2);
  if (arguments_.length && (arguments_.length !== 1 || arguments_[0] !== '--list')) throw new Error('Usage: node scripts/test-public.mjs [--list]');
  const files = await publicTestFiles(root);
  if (arguments_[0] === '--list') {
    console.log(JSON.stringify({ public: files, private: privateTestSuites }, null, 2));
    return;
  }
  console.log(`Running ${files.length} public application test files. Private service/deployment suites remain separate.`);
  const child = spawn(process.execPath, ['--experimental-strip-types', '--test', '--test-concurrency=4', ...files.map(file => `tests/${file}`)], { cwd: root, stdio: 'inherit' });
  child.once('error', error => { console.error(error.message); process.exitCode = 1; });
  child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
