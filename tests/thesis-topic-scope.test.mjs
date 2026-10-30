// Historical helper tests; these helpers no longer gate the product runtime.
import test from 'node:test';
import assert from 'node:assert/strict';
import {newThesisSession} from '../lib/thesis/model.ts';
import {scopeEvidence,topicStudentEvidence} from '../lib/thesis/topic-scope.ts';
const ev=(value,turn,quote,basis='direct')=>({value,turn,quote,basis});
const user=(text,id='u')=>({id,role:'user',text,createdAt:1});
const assistant=(text,props={})=>({id:crypto.randomUUID(),role:'assistant',text,createdAt:1,...props});


test('scope evidence requires actual student words and explicit object intent, not background or old agreement',()=>{
 const turns=[user('我是配送项目负责人，可以访谈。'),assistant('五人都已同意；研究对象确认是配送项目。')];
 assert.equal(scopeEvidence(ev('五人都已同意',1,'五人都已同意'),'object',turns),undefined);
 assert.equal(scopeEvidence(ev('配送项目',1,turns[0].text),'object',turns),undefined);
 const old=[assistant('本质是成本控制。',{question:{id:'q',question:'都对吗？',options:['符合实际','不对']}}),user('符合实际')];
 assert.equal(scopeEvidence(ev('成本控制',1,'符合实际','scope_choice'),'object',old),undefined);
 assert.ok(scopeEvidence(ev('建设项目',1,'我想研究建设项目'),'object',[user('我想研究建设项目')]));
});
test('student ledger preserves option context, but drops old assertions and reasoning',()=>{
 const turns=[assistant('没有证据的断言：数据就是成本基线。',{question:{id:'q',question:'选择哪一个？',options:['建设项目','配送业务']}}),user('选A')];
 const ledger=topicStudentEvidence(turns);
 assert.equal(ledger[0].statement,'选A');assert.deepEqual(ledger[0].replyContext.options,['建设项目','配送业务']);
 assert.equal(ledger[0].replyContext.purpose,'legacy_question');
 assert.doesNotMatch(JSON.stringify(ledger),/数据就是成本基线/);
});
test('explicit checklist acceptance retains scoped facts and choices, not academic judgments',async()=>{
 const {acceptedClaims}=await import('../lib/thesis/topic-scope.ts');
 const s=newThesisSession('mba-topic');
 const clause='研究对象：N公司系统建设项目。';
 s.turns=[assistant(`1. ${clause}\n2. 出报告需要1天。\n3. 样本足够、数据风险可控。`,{question:{id:'q',question:'这三条符合实际吗？',options:['符合实际','需要改']}}),user('符合实际，3条都对','confirm')];
 const receipt=(value,clause,kind='fact')=>({...ev(value,1,'符合实际，3条都对','confirmed_clause'),clause,kind});
 const entries=[receipt('N公司系统建设项目',clause,'choice'),receipt('出报告需要1天','出报告需要1天。'),receipt('样本足够','样本足够、数据风险可控。'),receipt('数据风险可控','样本足够、数据风险可控。')];
 assert.deepEqual(acceptedClaims(entries,s.turns).map(c=>c.value),['N公司系统建设项目','出报告需要1天']);
 assert.equal(scopeEvidence(entries[0],'object',s.turns).turnId,'confirm');
 // Only selected clauses can survive a partial confirmation.
 s.turns[1].text='只确认第1条';
 assert.equal(acceptedClaims([{...entries[1],quote:'只确认第1条'}],s.turns).length,0);
 assert.equal(acceptedClaims([{...entries[0],quote:'只确认第1条'}],s.turns).length,1);
});
test('display numbering follows visible questions for both free replies and option questions',async()=>{
 const {numberTopicReply}=await import('../lib/thesis/topic-guidance.ts');
 const turns=[assistant('Q3 — 事件是什么？\n内部曾错误提到Q8已通过。'),user('已说明')];
 assert.equal(numberTopicReply('Q1 — 下一个问题？',undefined,turns).text,'Q4 — 下一个问题？');
 const r=numberTopicReply('保持已有事实。\n\n选择哪个对象？',{id:'q',question:'选择哪个对象？',options:['对象A','对象B']},turns);
 assert.match(r.text,/Q4 — 选择哪个对象/);assert.equal(r.question.question,'Q4 — 选择哪个对象？');
});
test('an unnumbered final question receives the next visible number without numbering explanatory prose',async()=>{
 const {numberTopicReply}=await import('../lib/thesis/topic-guidance.ts');
 const r=numberTopicReply('方向和对象沿用。\n\n**这个项目最想解决什么问题？** 说一次具体经历即可。',undefined,[assistant('Q4 — 研究哪个项目？')]);
 assert.equal(r.text,'方向和对象沿用。\n\nQ5 — **这个项目最想解决什么问题？** 说一次具体经历即可。');
 assert.equal(numberTopicReply('对象保持不变。',undefined,[]).text,'对象保持不变。');
});
test('extraction that omits a grammatical particle preserves the actual quoted object instead of asking again',()=>{
 const text='我想研究N公司的订单系统建设项目。';
 assert.equal(scopeEvidence(ev('N公司订单系统建设项目',1,text),'object',[user(text)]).value,'N公司的订单系统建设项目');
 assert.equal(scopeEvidence(ev('N公司销售系统建设项目',1,text),'object',[user(text)]),undefined);
});
