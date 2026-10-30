import test from 'node:test';
import assert from 'node:assert/strict';
import { boardActionReferences } from '../app/ai-board-action-references.ts';

const actions = (fields = {}) => ({ id: 'q', boardId: 'board', notes: [{ id: 'new:1', title: '结论', body: '带条件的结论 [Lumior:2]。' }], connections: [], ...fields });
const context = { scope: 'board', eligible: 2, characters: 20, sources: [
  { id: 'a', kind: 'pdf', title: '研究 A', text: 'A', location: 'PDF 第 2 页', truncated: false },
  { id: 'b', kind: 'pdf', title: '研究 B', text: 'B', page: 7, truncated: false },
] };

test('saved notes carry source names and actual locations after leaving the AI message citation table', () => {
  const original = actions({ notes: [{ id: 'new:1', title: '结论 [Lumior:1]', body: '带条件的结论 [Lumior:2]。\n\n`[Lumior:99]` 是代码示例。' }] });
  const before = JSON.stringify(original);
  const saved = boardActionReferences(original, context);
  assert.equal(saved.notes[0].title, '结论 [1]');
  assert.match(saved.notes[0].body, /结论 \[2\]/);
  assert.match(saved.notes[0].body, /\[1\] 研究 A · PDF 第 2 页/);
  assert.match(saved.notes[0].body, /\[2\] 研究 B · PDF 第 7 页/);
  assert.match(saved.notes[0].body, /`\[Lumior:99\]`/);
  assert.equal(JSON.stringify(original), before);
});

test('source metadata is never invented when no location is available and normal notes remain unchanged', () => {
  const saved = boardActionReferences(actions(), { ...context, sources: context.sources.map(source => ({ ...source, page: undefined, location: undefined })) }, 'Sources');
  assert.match(saved.notes[0].body, /Sources/);
  assert.doesNotMatch(saved.notes[0].body, /PDF 第/);
  const plain = actions({ notes: [{ id: 'new:1', title: '我的问题', body: '下一步先确认研究范围。' }] });
  assert.deepEqual(boardActionReferences(plain, context), plain);
});

test('standalone connection labels retain their cited source description', () => {
  const saved = boardActionReferences(actions({ notes: [], connections: [{ from: 'a', to: 'b', label: '补充证据 [Lumior:1]' }] }), context);
  assert.equal(saved.connections[0].label, '补充证据 [1] · [1] 研究 A · PDF 第 2 页');
});

test('unresolvable or encoded source tokens fail before a card or edge can be saved', () => {
  for (const invalid of [
    actions({ notes: [{ id: 'new:1', title: '结论 [Lumior:88]', body: '内容' }] }),
    actions({ notes: [{ id: 'new:1', title: '结论', body: '内容 [Lumior:88]' }] }),
    actions({ notes: [], connections: [{ from: 'a', to: 'b', label: '关联 [Lumior:88]' }] }),
    actions({ notes: [{ id: 'new:1', title: '结论', body: '内容 &#91;Lumior:1&#93;' }] }),
  ]) assert.throws(() => boardActionReferences(invalid, context), /来源无法核对/);
});
