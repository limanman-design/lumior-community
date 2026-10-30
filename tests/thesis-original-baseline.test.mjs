import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { thesisSkillContent } from '../lib/thesis/skill-content.generated.ts';
import { newThesisSession } from '../lib/thesis/model.ts';
import { runThesis } from '../lib/thesis/run.ts';
import { ThesisTools } from '../lib/thesis/tools.ts';
import { base, topic } from './thesis-fixtures.mjs';
const baseline=JSON.parse(readFileSync(new URL('./fixtures/thesis-original-baseline.json',import.meta.url)));
const response=content=>({message:{role:'assistant',content},reason:'stop'});
const call=(name,args,id=name)=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});

test('four shipped and bundled Skills exactly match the original 6e8c14f baseline',()=>{
 for(const [id,expected] of Object.entries(baseline.skills)){
  const raw=readFileSync(new URL(`../skills/${id}/SKILL.md`,import.meta.url));assert.equal(createHash('sha256').update(raw).digest('hex'),expected.sha256,id);assert.equal(thesisSkillContent[id],raw.toString());
 }
 assert.match(thesisSkillContent['mba-topic'],/好答案/);
});
test('each runtime prompt starts with the unmodified Skill and only adds product facilities',async()=>{
 for(const id of Object.keys(baseline.skills)){
  let captured,tools;const r=await runThesis({snapshot:base(),session:newThesisSession(id),question:'开始'},async(m,t)=>{captured=m;tools=t;return response('请描述背景。');},new AbortController().signal);
  assert.equal(r.error,undefined);assert.ok(captured[0].content.startsWith(thesisSkillContent[id]+'\n\n---\n'));
  const adapter=captured[0].content.slice(thesisSkillContent[id].length);assert.doesNotMatch(adapter,/题号由产品|本轮已核对|答辩阶段|降为具体事实|第二次拒绝/);assert.match(adapter,/旧助手的说法不等同/);assert.ok(tools.every(t=>t.function.name!=='CheckResearchScope'));
 }
});
test('original Skill paths are readable and original topic cards need no hidden scope verdict',()=>{
 const session=newThesisSession('mba-topic');const t=new ThesisTools(base(),session,{now:1,userText:'继续',userEvidence:[]});
 for(const id of Object.keys(baseline.skills))assert.equal(t.execute('Read',{path:`~/.claude/skills/${id}/SKILL.md`},'read').result,thesisSkillContent[id]);
 assert.doesNotThrow(()=>t.execute('Write',{path:'thesis/topic.md',content:topic},'write'));
 assert.throws(()=>t.execute('Read',{path:'../other-board/secret'},'bad'),/路径/);
});
test('old scope and defense state cannot insert extra questions, repair loops or hide examples',async()=>{
 const s=newThesisSession('mba-topic');s.defensePhase='followup';s.topicScope={object:{value:'旧助手推测的对象',quote:'旧',turnId:'x',basis:'direct'}};
 s.turns=[{id:'u',role:'user',text:'我想从项目管理角度写',createdAt:1},{id:'a',role:'assistant',text:'之前的可见回答',createdAt:2}];s.modelMessages=[{role:'user',content:'隐藏范围检查要求重复确认'}];
 let count=0;const before=structuredClone(s),text='Q6 — 最近发生了什么？\n\n一个好答案是什么样：一次延期。';
 const r=await runThesis({snapshot:base(),session:s,question:'继续'},async messages=>{count++;assert.doesNotMatch(JSON.stringify(messages),/隐藏范围检查|旧助手推测的对象/);assert.ok(messages.some(m=>m.content==='之前的可见回答'));return response(text);},new AbortController().signal);
 assert.equal(count,1);assert.equal(r.text,text);assert.equal(r.error,undefined);assert.deepEqual(s,before);
});
test('examples before a file read survive into the displayed response',async()=>{
 let n=0;const r=await runThesis({snapshot:base(),session:newThesisSession('mba-topic'),question:'开始'},async()=>++n===1?{message:{role:'assistant',content:'好答案例子：一次延期。',tool_calls:[call('Read',{path:'thesis/topic.md'})]},reason:'tool_calls'}:response('Q1 — 请说一件具体的事。'),new AbortController().signal);
 assert.equal(r.text,'好答案例子：一次延期。\n\nQ1 — 请说一件具体的事。');
});
