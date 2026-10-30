import test from 'node:test';
import assert from 'node:assert/strict';
import { thesisStageStatus } from '../app/thesis-stage-status.ts';
import { enableBoardThesis, createThesisArtifact, reconcileThesisEdits } from '../app/thesis-board.ts';
import { thesisChat } from '../app/thesis-chat.ts';

const initial = () => enableBoardThesis({ id: 'a', title: '论文', cards: [], edges: [] });
const chat = (skill, status = 'complete', at = 10) => ({ id: skill, boardId: 'a', skill, live: true, messages: [
  { id: 'q', role: 'user', text: '继续', createdAt: at },
  { id: 'r', role: 'assistant', text: '答复', status, error: status === 'error' ? '连接中断' : undefined, createdAt: at },
] });
const topic = () => createThesisArtifact(initial(), 'thesis/topic.md', '研究用户持续使用意愿');

test('opening a stage is not progress, and another board cannot affect its status', () => {
  const b = initial();
  assert.equal(thesisStageStatus(b, [thesisChat(b, [], 'mba-topic')], 'mba-topic').kind, 'idle');
  assert.equal(thesisStageStatus(b, [{ ...chat('mba-topic', 'error'), boardId: 'other' }], 'mba-topic').kind, 'idle');
});
test('a blank card is not an artifact; a written outline is an artifact, not a claim of completion', () => {
  const blank = createThesisArtifact(initial(), 'thesis/topic.md', '# 选题卡\n\n');
  assert.equal(thesisStageStatus(blank, [], 'mba-topic').kind, 'progress');
  const outline = createThesisArtifact(topic(), 'thesis/review-outline.md', '先介绍概念，再比较相关研究');
  const status = thesisStageStatus(outline, [], 'mba-review');
  assert.equal(status.kind, 'result');
  assert.match(status.reason, /综述提纲/);
  assert.match(status.reason, /不代表整个阶段已结束/);
});
test('starting without source material is attention, not a failure or navigation lock', () => {
  assert.equal(thesisStageStatus(topic(), [chat('mba-lit')], 'mba-lit').kind, 'attention');
  assert.match(thesisStageStatus(topic(), [chat('mba-review')], 'mba-review').reason, /文献矩阵/);
  assert.equal(thesisStageStatus(topic(), [], 'mba-review').kind, 'idle');
});
test('editing upstream cards changes existing results to review without altering their content', () => {
  const b = createThesisArtifact(topic(), 'thesis/review-draft.md', '用户已有综述');
  const changed = reconcileThesisEdits(b, { ...b, cards: b.cards.map(card => card.id === b.thesis.artifacts['thesis/topic.md'].cardId ? { ...card, body: '研究企业知识共享' } : card) });
  const status = thesisStageStatus(changed, [], 'mba-review');
  assert.equal(status.kind, 'attention');
  assert.match(status.reason, /选题卡已修改/);
  assert.equal(changed.cards[1].body, '用户已有综述');
  changed.thesis.artifacts['thesis/review-draft.md'].needsReview = undefined;
  assert.equal(thesisStageStatus(changed, [], 'mba-review').kind, 'result');
});
test('a deleted card and an unapplied suggestion each explain the actual action needed', () => {
  const b = topic();
  assert.match(thesisStageStatus({ ...b, cards: [] }, [], 'mba-topic').reason, /已移除.*恢复/);
  b.thesis.proposals['thesis/topic.md'] = { text: '建议' };
  assert.equal(thesisStageStatus(b, [], 'mba-topic').label, '待采纳');
});
test('failure is red, a running retry is green, and a successful retry clears stale errors', () => {
  const b = topic(), failed = chat('mba-topic', 'error');
  assert.match(thesisStageStatus(b, [failed], 'mba-topic').reason, /连接中断/);
  assert.equal(thesisStageStatus(b, [failed], 'mba-topic').kind, 'error');
  const retry = chat('mba-topic', 'pending', 20);
  retry.messages[1].progress = '正在读取选题卡';
  assert.equal(thesisStageStatus(b, [failed, retry], 'mba-topic').reason, '正在读取选题卡');
  assert.equal(thesisStageStatus(b, [failed, chat('mba-topic', 'complete', 30)], 'mba-topic').kind, 'result');
  assert.notEqual(thesisStageStatus(b, [chat('mba-topic', 'stopped')], 'mba-topic').kind, 'error');
});
test('saved sessions retain pending questions and errors even without chat history', () => {
  const b = initial();
  b.thesis.sessions.s = { id: 's', skill: 'mba-topic', turns: [{ role: 'assistant', text: '问题', createdAt: 10 }], pending: { question: '你在哪个行业工作？' } };
  assert.equal(thesisStageStatus(b, [], 'mba-topic').kind, 'progress');
  assert.match(thesisStageStatus(b, [], 'mba-topic').reason, /你在哪个行业工作/);
  b.thesis.sessions.s.turns[0].error = '处理失败';
  assert.equal(thesisStageStatus(b, [], 'mba-topic').kind, 'error');
});
