import assert from 'node:assert/strict';
import test from 'node:test';
import { initialNavigation, libraryModeFor, workspaceNavigation } from '../app/workspace-navigation.ts';

test('new sessions enter the all-files Home instead of opening the last board canvas', () => {
  assert.deepEqual(initialNavigation, { page: 'boards', librarySidebar: false });
});

test('any destination, including a future feature, leaves atlas without a destination cleanup list', () => {
  const atlas = workspaceNavigation(initialNavigation, { type: 'navigate', page: 'atlas' });
  for (const page of ['canvas', 'boards', 'library', 'future-feature']) {
    const next = workspaceNavigation(atlas, { type: 'navigate', page });
    assert.equal(next.page, page);
    assert.notEqual(next.page, 'atlas');
    assert.equal(next.librarySidebar, false);
  }
});

test('existing full-page controls replace atlas; unrelated resets cannot reopen the canvas', () => {
  const atlas = workspaceNavigation(initialNavigation, { type: 'navigate', page: 'atlas' });
  for (const page of ['boards']) {
    const next = workspaceNavigation(atlas, { type: 'page-visible', page, visible: true });
    assert.equal(next.page, page);
    assert.strictEqual(workspaceNavigation(atlas, { type: 'page-visible', page, visible: false }), atlas);
  }
  assert.equal(workspaceNavigation(atlas, { type: 'library', mode: 'page' }).page, 'library');
  assert.equal(workspaceNavigation(atlas, { type: 'library', mode: null }).page, 'atlas');
});

test('the retired observatory cannot be reopened by old navigation commands', () => {
  assert.deepEqual(workspaceNavigation(initialNavigation, { type: 'navigate', page: 'observatory' }), initialNavigation);
  const atlas = workspaceNavigation(initialNavigation, { type: 'navigate', page: 'atlas' });
  assert.strictEqual(workspaceNavigation(atlas, { type: 'page-visible', page: 'observatory', visible: true }), atlas);
});

test('library sidebar toggles and closing full pages preserve existing canvas behavior', () => {
  const canvas = { page: 'canvas', librarySidebar: false };
  const sidebar = workspaceNavigation(initialNavigation, { type: 'library', mode: previous => previous === 'sidebar' ? null : 'sidebar' });
  assert.equal(sidebar.page, 'canvas');
  assert.equal(libraryModeFor(sidebar), 'sidebar');
  assert.deepEqual(workspaceNavigation(sidebar, { type: 'library', mode: previous => previous === 'sidebar' ? null : 'sidebar' }), canvas);
  const library = workspaceNavigation(sidebar, { type: 'library', mode: 'page' });
  assert.equal(libraryModeFor(library), 'page');
  assert.deepEqual(workspaceNavigation(library, { type: 'library', mode: null }), canvas);
  const boards = workspaceNavigation(initialNavigation, { type: 'navigate', page: 'boards' });
  assert.deepEqual(workspaceNavigation(boards, { type: 'page-visible', page: 'boards', visible: false }), canvas);
});

test('content pages replace full-page navigation while leaving content identity intact', () => {
  const content = workspaceNavigation(initialNavigation, { type: 'navigate', page: 'content:standalone-note' });
  assert.deepEqual(content, { page: 'content:standalone-note', librarySidebar: false });
  assert.equal(workspaceNavigation(content, { type: 'navigate', page: 'boards' }).page, 'boards');
  assert.strictEqual(workspaceNavigation(content, { type: 'page-visible', page: 'boards', visible: false }), content);
});
