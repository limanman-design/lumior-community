import test from 'node:test';
import assert from 'node:assert/strict';
import { addWorkspaceContent } from '../app/workspace-files.ts';
import { createInitialWorkspace, readWorkspace } from '../app/workspace-store.ts';
import { serializeWorkspace } from '../app/workspace-assets.ts';
import { createWorkspaceBackup, readWorkspaceBackup, mergeRestoredWorkspace } from '../app/workspace-backup.ts';

const text = (value, styles = {}) => [{ type: 'text', text: value, styles }];
const document = [
  { id: 'table', type: 'table', props: { textColor: 'default' }, children: [], content: {
    type: 'tableContent', headerRows: 1, columnWidths: [180, 260], rows: [
      { cells: [text('项目', { bold: true }), text('内容')] },
      { cells: [text('表格'), text('保留单元格与格式', { italic: true })] },
    ],
  } },
  { id: 'toggle', type: 'toggleListItem', props: {}, content: text('折叠主题'), children: [
    { id: 'nested-heading', type: 'heading', props: { level: 2, isToggleable: true }, content: text('嵌套标题'), children: [
      { id: 'nested-text', type: 'paragraph', props: {}, content: text('收起时也不能丢失的正文'), children: [] },
    ] },
  ] },
  ...[5, 6].map(level => ({ id: `legacy-h${level}`, type: 'heading', props: { level, isToggleable: false }, content: text(`历史 H${level}`), children: [] })),
];
const noteFrom = snapshot => snapshot.files.contents.find(entry => entry.card.title === '结构往返验证').card;

test('tables, nested toggle content and legacy headings survive reopen and a real backup/restore round trip', async () => {
  const snapshot = createInitialWorkspace();
  snapshot.files = addWorkspaceContent(snapshot.files, {
    id: 'structure-note', kind: 'note', contentRole: 'notePage', title: '结构往返验证',
    body: '正文缓存不能取代完整块结构', x: 20, y: 40, width: 420, blocks: structuredClone(document),
  });
  const reopened = readWorkspace(JSON.stringify(serializeWorkspace(snapshot)));
  assert.ok(reopened);
  assert.deepEqual(noteFrom(reopened).blocks, document);
  const unexpectedRead = async () => { throw new Error('This document has no attachments or external resources.'); };
  const archive = await createWorkspaceBackup(reopened, { getFile: unexpectedRead, fetch: unexpectedRead }, () => {});
  const prepared = await readWorkspaceBackup(archive, () => {});
  assert.equal(prepared.files.length, 0);
  assert.deepEqual(noteFrom(prepared.snapshot).blocks, document);
  const restored = mergeRestoredWorkspace(createInitialWorkspace(), prepared.snapshot);
  assert.notEqual(noteFrom(restored).id, 'structure-note');
  assert.deepEqual(noteFrom(restored).blocks, document);
});
