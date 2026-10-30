import test from 'node:test';
import assert from 'node:assert/strict';
import { newAiChat, restoredAiHistory } from '../app/ai-chat-store.ts';
import { aiSkills, aiSkillLabel, defaultAiSkillId, getAiSkill, isValidAiSkillId, skillForChat } from '../lib/ai-skills.ts';

const historyFor = chat => ({ version: 1, boardId: chat.boardId, activeId: chat.id, chats: [chat] });

void test('legacy conversations use the research assistant without rewriting their saved skill identity', () => {
  const legacy = newAiChat('board', ['paper'], 123);
  delete legacy.skill;
  legacy.draft = 'My unfinished question';
  const restored = restoredAiHistory(JSON.parse(JSON.stringify(historyFor(legacy))), 'board').chats[0];
  assert.equal(skillForChat(restored), defaultAiSkillId);
  assert.equal(Object.hasOwn(restored, 'skill'), false);
  assert.equal(restored.draft, legacy.draft);
  assert.deepEqual(restored.refs, ['paper']);
  assert.equal(aiSkillLabel(skillForChat(restored), 'zh'), '研究助手');
  assert.equal(aiSkillLabel(skillForChat(restored), 'en'), 'Research assistant');
});

void test('creating a new skill conversation keeps the original draft, evidence and messages separate', () => {
  const original = newAiChat('board', ['paper'], 1);
  original.draft = 'Keep this draft';
  original.messages = [{ id: 'question', role: 'user', text: 'Keep this question', createdAt: 1, live: true }];
  const before = structuredClone(original);
  const next = newAiChat('board', original.refs, 2, 'proposal');
  assert.notEqual(next.id, original.id);
  assert.equal(next.skill, 'proposal');
  assert.equal(next.draft, '');
  assert.deepEqual(next.messages, []);
  assert.deepEqual(next.refs, ['paper']);
  next.draft = 'New draft'; next.refs.push('another-paper');
  assert.deepEqual(original, before);
});

void test('unavailable skill conversations keep their identity through reload and never become research chats', () => {
  const future = newAiChat('board', [], 1, 'proposal-v2');
  future.draft = 'Unsent proposal question';
  const restored = restoredAiHistory(JSON.parse(JSON.stringify(historyFor(future))), 'board').chats[0];
  assert.equal(skillForChat(restored), 'proposal-v2');
  assert.equal(restored.draft, future.draft);
  assert.equal(getAiSkill(skillForChat(restored)), undefined);
  assert.deepEqual(aiSkills.map(skill => skill.id), [defaultAiSkillId, 'mba-topic', 'mba-lit', 'mba-review', 'mba-proposal']);
  assert.ok(aiSkills.slice(1).every(skill => skill.target === 'thesis'), 'MBA skills route to the isolated thesis runtime');
});

void test('saved skill IDs accept portable slugs and reject malformed values', () => {
  for (const skill of ['research', 'proposal-v2', 'a'.repeat(100)]) {
    assert.equal(isValidAiSkillId(skill), true);
    const chat = newAiChat('board', [], 1, skill);
    assert.equal(restoredAiHistory(historyFor(chat), 'board').chats[0].skill, skill);
  }
  for (const skill of ['', ' ', 'research assistant', 'Research', '-research', 'research-', 'research--v2', '../research', 'a'.repeat(101), null, 1, {}, []]) {
    assert.equal(isValidAiSkillId(skill), false);
    assert.throws(() => restoredAiHistory(historyFor({ ...newAiChat('board'), skill }), 'board'), /原记录已保留/);
    assert.throws(() => newAiChat('board', [], 1, skill), /Invalid AI skill/);
  }
});
