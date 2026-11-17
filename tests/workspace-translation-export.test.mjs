import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { addWorkspaceContent, syncWorkspaceFiles } from '../app/workspace-files.ts';
import { readWorkspace } from '../app/workspace-store.ts';

const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('page.tsx', page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler;
function findHandler(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === 'addTranslationFile') handler = node.initializer;
  ts.forEachChild(node, findHandler);
}
findHandler(parsed);
assert.ok(handler, 'file reader must supply its own translation save destination');
// Execute the actual page callback with real registry operations, without mounting
// the entire canvas. The save promise is controllable to verify export ordering.
const code = ts.transpileModule(`globalThis.saveTranslation = ${handler.getText(parsed)};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const source = { id: 'source', kind: 'pdf', title: 'Original paper', body: '', pdf: { url: 'lumior-file:original', name: 'original.pdf', size: 100, pages: 8 }, x: 0, y: 0, width: 360 };
const imported = { kind: 'pdf', title: 'Original paper · 中文译文', body: '', pdf: { url: 'lumior-file:translation', name: 'translation.pdf', size: 200, pages: 8 } };
function fixture(save = async () => {}) {
  const boards = [{ id: 'board', title: 'Unrelated whiteboard', cards: [], edges: [] }];
  const files = addWorkspaceContent({ version: 1, contents: [], entries: [], folders: [{ id: 'papers', title: 'Papers', parentId: null }] }, source, 'papers', 'literature');
  const workspaceFilesRef = { current: syncWorkspaceFiles(files, boards) }, events = [];
  let saved;
  const context = {
    syncWorkspaceFiles, addWorkspaceContent, workspaceFilesRef, savedBoards: { current: boards },
    crypto: { randomUUID: () => 'translation' },
    changeWorkspaceFiles(next) { workspaceFilesRef.current = next; events.push('changed'); },
    async saveWorkspace() { events.push('saving'); saved = JSON.stringify(workspaceFilesRef.current); await save(); events.push('saved'); },
    flash(message) { events.push(message); },
    t: english => english,
  };
  vm.runInNewContext(code, context);
  return { ...context, boards, events, get saved() { return saved; } };
}

void test('file reader exports a separate PDF in its source folder and waits for persistence', async () => {
  let release;
  const saving = new Promise(resolve => { release = resolve; });
  const app = fixture(() => saving), originalFiles = JSON.parse(JSON.stringify(app.workspaceFilesRef.current)), originalBoards = JSON.stringify(app.boards);
  let finished = false;
  const pending = app.saveTranslation(imported, source.id).then(() => { finished = true; });
  await Promise.resolve();
  assert.equal(finished, false, 'the panel must not download or announce success before the workspace is saved');
  assert.deepEqual(app.events, ['changed', 'saving']);
  release();
  await pending;
  assert.deepEqual(app.events, ['changed', 'saving', 'saved', 'Translation saved as a new PDF file']);
  assert.equal(JSON.stringify(app.boards), originalBoards);
  assert.deepEqual(app.workspaceFilesRef.current.contents.find(item => item.id === source.id), originalFiles.contents.find(item => item.id === source.id));
  const restored = readWorkspace(JSON.stringify({ version: 1, boards: app.boards, deletedBoards: [], activeId: 'board', nextUntitledIndex: 1, pdfMarks: {}, files: JSON.parse(app.saved) }));
  const translated = restored.files.contents.find(item => item.id === 'translation');
  assert.equal(translated.role, 'literature');
  assert.deepEqual(translated.card.pdf, imported.pdf);
  assert.equal(translated.card.title, imported.title);
  assert.equal(restored.files.entries.find(entry => entry.contentId === 'translation').folderId, 'papers');
});

void test('removed source and persistence failures never report successful export', async () => {
  const removed = fixture();
  await assert.rejects(removed.saveTranslation(imported, 'removed'), /original PDF was removed/);
  assert.equal(removed.workspaceFilesRef.current.contents.length, 1);
  assert.deepEqual(removed.events, []);
  const failed = fixture(async () => { throw new Error('disk unavailable'); });
  await assert.rejects(failed.saveTranslation(imported, source.id), /disk unavailable/);
  assert.deepEqual(failed.events, ['changed', 'saving']);
});

void test('the imported-file reader passes its save destination through to the translation panel', () => {
  assert.match(page, /<WorkspaceContentReader\b[^>]*onTranslationCreated=\{imported=>addTranslationFile\(imported,activeFile\.id\)\}/);
  for (const filename of ['workspace-content-reader.tsx', 'expanded-pdf.tsx']) {
    assert.match(readFileSync(new URL(`../app/${filename}`, import.meta.url), 'utf8'), /onTranslationCreated=\{onTranslationCreated\}/);
  }
  const viewer = readFileSync(new URL('../app/pdf-viewer.tsx', import.meta.url), 'utf8');
  assert.match(viewer, /onCreated=\{onTranslationCreated\}/);
});
