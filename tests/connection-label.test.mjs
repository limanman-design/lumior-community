import test from 'node:test';
import assert from 'node:assert/strict';
import { connectionGeometry, updateConnectionLabel, normalizeConnectionLabel, CONNECTION_LABEL_MAX_LENGTH, createConnectionLabelDraft, finishConnectionLabelDraft, connectionLabelKeyAction } from '../app/connection-label-model.ts';
import { readWorkspace } from '../app/workspace-store.ts';
import { createWorkspaceBackup, readWorkspaceBackup, mergeRestoredWorkspace } from '../app/workspace-backup.ts';

const card = (id, x, y, width = 300, height = 200) => ({ id, kind: 'note', title: id, body: 'Evidence', x, y, width, height });
const first = card('first', 100, 80), second = card('second', 700, 200);
const board = { id: 'label-board', title: 'Research', cards: [first, second], edges: [{ id: 'relation', from: first.id, to: second.id, color: '#8bd8ff' }, { id: 'other', from: second.id, to: first.id }], sections: [] };
const workspace = value => ({ version: 1, boards: [value], deletedBoards: [], activeId: value.id, nextUntitledIndex: 2 });

void test('editing, clearing and undo snapshots preserve every other connection, card and section', () => {
  const before = structuredClone(board);
  Object.freeze(before.edges[0]); Object.freeze(before.edges[1]); Object.freeze(before.edges); Object.freeze(before);
  const added = updateConnectionLabel(before, 'relation', '  支持\n这一观点  ');
  assert.equal(added.edges[0].label, '支持 这一观点');
  assert.equal(added.edges[0].color, '#8bd8ff');
  assert.equal(added.edges[1], before.edges[1]);
  assert.equal(added.cards, before.cards); assert.equal(added.sections, before.sections);
  assert.equal(Object.hasOwn(before.edges[0], 'label'), false);
  assert.equal(updateConnectionLabel(added, 'relation', '支持  这一观点'), added);
  assert.equal(updateConnectionLabel(added, 'missing', 'Unused'), added);
  const edited = updateConnectionLabel(added, 'relation', '进一步解释');
  const cleared = updateConnectionLabel(edited, 'relation', '\t  ');
  assert.equal(Object.hasOwn(cleared.edges[0], 'label'), false);
  assert.deepEqual([before, added, edited, cleared].map(version => version.edges[0].label), [undefined, '支持 这一观点', '进一步解释', undefined]);
});

void test('labels stay at the cubic midpoint for right, left, vertical and overlapping card layouts using measured heights', () => {
  const cases = [
    [first, second, { start: { x: 400, y: 205 }, end: { x: 700, y: 375 }, midpoint: { x: 550, y: 290 } }],
    [second, first, { start: { x: 700, y: 375 }, end: { x: 400, y: 205 }, midpoint: { x: 550, y: 290 } }],
    [first, card('second', 100, 500), { start: { x: 100, y: 205 }, end: { x: 100, y: 675 }, midpoint: { x: 100, y: 440 } }],
    [first, card('second', 200, 90), { start: { x: 100, y: 205 }, end: { x: 200, y: 265 }, midpoint: { x: 150, y: 235 } }],
  ];
  for (const [from, to, expected] of cases) {
    const geometry = connectionGeometry(from, to, { first: 250, second: 350 });
    assert.deepEqual(geometry.start, expected.start); assert.deepEqual(geometry.end, expected.end); assert.deepEqual(geometry.midpoint, expected.midpoint);
    const points = geometry.path.match(/-?\d+(?:\.\d+)?/g).map(Number);
    assert.equal((points[0] + 3 * points[2] + 3 * points[4] + points[6]) / 8, geometry.midpoint.x);
    assert.equal((points[1] + 3 * points[3] + 3 * points[5] + points[7]) / 8, geometry.midpoint.y);
  }
  const draft = connectionGeometry(first, { x: 900, y: 520 });
  assert.deepEqual(draft.start, { x: 400, y: 180 }); assert.deepEqual(draft.end, { x: 900, y: 520 });
  assert.equal(draft.path, 'M 400 180 C 625 180, 675 520, 900 520');
});

void test('Enter followed by blur saves once, Escape cancels without saving, and IME confirmation stays in the editor', () => {
  const session = createConnectionLabelDraft('Before'); session.value = 'After';
  assert.equal(finishConnectionLabelDraft(session, true), 'After');
  assert.equal(finishConnectionLabelDraft(session, true), null);
  const canceled = createConnectionLabelDraft('Discard');
  assert.equal(finishConnectionLabelDraft(canceled, false), null); assert.equal(finishConnectionLabelDraft(canceled, true), null);
  const cleared = createConnectionLabelDraft('   '); assert.equal(finishConnectionLabelDraft(cleared, true), '');
  assert.equal(connectionLabelKeyAction('Enter', false), 'save'); assert.equal(connectionLabelKeyAction('Escape', false), 'cancel');
  for (const key of ['Enter', 'Escape', 'Backspace', 'Delete', ' ', 'n', '+']) assert.equal(connectionLabelKeyAction(key, true), null);
  assert.equal(connectionLabelKeyAction('Enter', false, 229), null);
  for (const key of ['Backspace', 'Delete', ' ', 'n', '+']) assert.equal(connectionLabelKeyAction(key, false), null);
  assert.equal(Array.from(normalizeConnectionLabel('🧭'.repeat(150))).length, CONNECTION_LABEL_MAX_LENGTH);
});

void test('connection labels survive local reload, full backup verification and restored identity remapping', async () => {
  const labeled = updateConnectionLabel(board, 'relation', '支持这一观点');
  const saved = workspace(labeled);
  assert.equal(readWorkspace(JSON.stringify(saved)).boards[0].edges[0].label, '支持这一观点');
  const archive = await createWorkspaceBackup(saved, { getFile: async () => undefined, fetch: async () => { throw new Error('Labels must not request attachments'); } }, () => {});
  const verified = await readWorkspaceBackup(archive, () => {});
  assert.equal(verified.files.length, 0); assert.deepEqual(verified.snapshot.boards[0].edges, labeled.edges);
  const restored = mergeRestoredWorkspace(workspace({ ...board, id: 'existing' }), verified.snapshot);
  const copy = restored.boards[1];
  assert.notEqual(copy.id, labeled.id); assert.notEqual(copy.edges[0].id, labeled.edges[0].id);
  assert.equal(copy.edges[0].label, '支持这一观点'); assert.equal(copy.edges[0].color, '#8bd8ff');
  assert.equal(copy.edges[0].from, copy.cards[0].id); assert.equal(copy.edges[0].to, copy.cards[1].id);
  assert.deepEqual(restored.boards[0].edges, board.edges);
});

void test('malformed labels are refused during local-data and full-backup validation', async () => {
  const malformed = workspace({ ...board, edges: [{ ...board.edges[0], label: { text: 'Invalid' } }] });
  assert.equal(readWorkspace(JSON.stringify(malformed)), null);
  const archive = await createWorkspaceBackup(malformed, { getFile: async () => undefined, fetch: async () => undefined }, () => {});
  await assert.rejects(readWorkspaceBackup(archive, () => {}), /画板记录无效|Whiteboard records in the backup are invalid/);
});
