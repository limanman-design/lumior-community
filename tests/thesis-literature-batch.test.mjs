import test from 'node:test';
import assert from 'node:assert/strict';
import { newThesisSession } from '../lib/thesis/model.ts';
import { runThesis } from '../lib/thesis/run.ts';
import { ThesisTools } from '../lib/thesis/tools.ts';
import { guardThesisWrite, literatureCards } from '../lib/thesis/guards.ts';
import { enableBoardThesis, createThesisArtifact, boardThesisSnapshot, boardThesisSession, thesisInputSignature, applyThesisResult, resolveThesisProposal, setThesisSource } from '../app/thesis-board.ts';
import { thesisChat } from '../app/thesis-chat.ts';
import { batchPapers, batchMatrixCard } from './fixtures/thesis-batch-scenarios.mjs';
import { topic } from './thesis-fixtures.mjs';
const matrixPath='thesis/lit-matrix.md';
const tools = calls => ({message:{role:'assistant',content:'',tool_calls:calls.map(([name,args],i)=>({id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}))},reason:'tool_calls'});
const say = text => ({message:{role:'assistant',content:text},reason:'stop'});
const context={now:1,userText:'继续',userEvidence:[]};
function board(){return createThesisArtifact(enableBoardThesis({id:'batch-board',title:'合成批次测试',cards:[],edges:[]}), 'thesis/topic.md', topic);}
function addPapers(b,start,end){
  for(let i=start;i<end;i++) {b.cards.push({id:`batch-${i+1}`,kind:'note',title:batchPapers[i].title,body:batchPapers[i].text,x:0,y:0,width:440});b=setThesisSource(b,`batch-${i+1}`,'refs');}
  return b;
}
function snapshot(b){
  const s=boardThesisSnapshot(b,'mba-lit');
  for(const card of b.cards.filter(c=>b.thesis.sources[c.id]==='refs'))s.files[`thesis/refs/${card.id}.md`]={path:`thesis/refs/${card.id}.md`,text:card.body,modifiedAt:1,uploaded:true};
  return s;
}
async function runBatch(b,session,start,end){
  const s=snapshot(b),old=s.files[matrixPath]?.text||'# 文献矩阵\n';let step=0;
  return runThesis({snapshot:s,session,question:'请继续阅读新加入的文献'},async messages=>{
    for(const m of messages.filter(m=>m.role==='tool'))assert.equal(JSON.parse(m.content).error,undefined,m.content);
    if(step++===0)return tools(Array.from({length:end-start},(_,i)=>['Read',{path:batchPapers[start+i].path}]));
    if(step===2)return tools([['Write',{path:matrixPath,content:old+'\n'+Array.from({length:end-start},(_,i)=>batchMatrixCard(start+i)).join('\n')+'\n## 筛选记录\n'+batchPapers.slice(end).filter(p=>s.files[p.path]).map(p=>`| ${p.path} | 纳入精读（下次） |`).join('\n')}]]);
    return say('本批已登记完成。');
  },new AbortController().signal);
}
test('same board reads five plus five, keeps IDs and accepted content, then adopts all ten',async()=>{
  let b=addPapers(board(),0,5),chat=thesisChat(b,[],'mba-lit');
  const first=await runBatch(b,boardThesisSession(b,chat.id,'mba-lit'),0,5);
  assert.equal(first.error,undefined);assert.equal(first.session.litReadIds.length,5);
  b=applyThesisResult(b,thesisInputSignature(b),first,chat.id);
  const firstMatrix=boardThesisSnapshot(b).files[matrixPath].text;
  b=addPapers(b,5,10);
  const resumed=thesisChat(b,[],'mba-lit'); assert.equal(resumed.id,chat.id);
  const second=await runBatch(b,boardThesisSession(b,resumed.id,'mba-lit'),5,10);
  assert.equal(second.error,undefined);
  assert.deepEqual(second.session.litReadIds,batchPapers.slice(5).map(p=>p.path));
  b=applyThesisResult(b,thesisInputSignature(b),second,resumed.id);
  assert.equal(boardThesisSnapshot(b).files[matrixPath].text,firstMatrix);
  assert.equal(literatureCards(boardThesisSnapshot(b,'mba-lit').files[matrixPath].text).length,10);
  // Before adoption a resumed run reuses the complete proposal, never the old five.
  const t=new ThesisTools(snapshot(b),boardThesisSession(b,chat.id,'mba-lit'),context);
  for(const p of batchPapers)assert.equal(t.execute('Read',{path:p.path},'read').result.alreadyProcessed,true);
  b=resolveThesisProposal(b,matrixPath,true);
  const cards=literatureCards(boardThesisSnapshot(b).files[matrixPath].text);
  assert.equal(cards.length,10);assert.equal(new Set(cards.map(c=>c.source)).size,10);
  assert.deepEqual(cards.map(c=>c.id),Array.from({length:10},(_,i)=>`L${String(i+1).padStart(2,'0')}`));
  assert.ok(boardThesisSnapshot(b).files[matrixPath].text.startsWith(firstMatrix));
});
test('pending and interrupted batches retain quota even when a command is sent',async()=>{
  const b=addPapers(board(),0,10),s=snapshot(b),session=newThesisSession('mba-lit');session.litReadIds=batchPapers.slice(0,5).map(p=>p.path);
  const result=await runThesis({snapshot:s,session,question:'/mba-lit'},async()=>say('继续补齐已经读过的记录。'),new AbortController().signal);
  assert.equal(result.session.litReadIds.length,5);
  const t=new ThesisTools(result.snapshot,result.session,context);
  assert.throws(()=>t.execute('Read',{path:batchPapers[5].path,mode:'verify'},'six'),/已精读 5/);
  s.files[matrixPath]={path:matrixPath,text:Array.from({length:5},(_,i)=>batchMatrixCard(i)).join('\n').replace('不适用（方法演示，未涉及同题实证研究）','待追问'),modifiedAt:1};
  session.pending={id:'choice',question:'哪项符合实际？',options:['A','B']};
  let received;
  const answer=await runThesis({snapshot:s,session,question:'A'},async messages=>{received=messages;return say('Q2 — 下一项具体事实是什么？');},new AbortController().signal);
  assert.equal(answer.session.litReadIds.length,5);assert.ok(received.some(m=>m.role==='assistant'&&m.content.includes('哪项符合实际？')));assert.equal(received.at(-2)?.content==='A'||received.some(m=>m.role==='user'&&m.content==='A'),true);assert.ok(received.every(m=>m.role!=='tool'));
});
test('already registered sources are reused; explicit verification is available and duplicates rejected',()=>{
  const b=addPapers(board(),0,2),s=snapshot(b);s.files[matrixPath]={path:matrixPath,text:batchMatrixCard(0),modifiedAt:1};s.literatureSequence=1;
  const t=new ThesisTools(s,newThesisSession('mba-lit'),context);
  assert.equal(t.execute('Read',{path:batchPapers[0].path},'r').result.alreadyProcessed,true);
  assert.match(t.execute('Read',{path:batchPapers[0].path,mode:'verify'},'v').result.text,/SYNTHETIC TEST MATERIAL/);
  assert.equal(t.session.litReadIds.length,0);
  assert.throws(()=>guardThesisWrite(s,matrixPath,batchMatrixCard(0)+'\n'+batchMatrixCard(0).replace('L01','L02'),context),/同一来源不能重复/);
});
test('stale proposal cannot override a manually edited matrix or leak to another board',async()=>{
  let b=addPapers(board(),0,10),chat=thesisChat(b,[],'mba-lit');
  b=applyThesisResult(b,thesisInputSignature(b),await runBatch(b,newThesisSession('mba-lit',chat.id),0,5),chat.id);
  b=applyThesisResult(b,thesisInputSignature(b),await runBatch(b,boardThesisSession(b,chat.id,'mba-lit'),5,10),chat.id);
  const card=b.cards.find(c=>c.id===b.thesis.artifacts[matrixPath].cardId);card.body+='\n用户的补充';
  assert.throws(()=>boardThesisSnapshot(b,'mba-lit'),/原卡片或选题已修改/);
  assert.match(boardThesisSnapshot(b).files[matrixPath].text,/用户的补充/);
  const other=board();other.id='other';assert.equal(boardThesisSnapshot(other,'mba-lit').files[matrixPath],undefined);
});
