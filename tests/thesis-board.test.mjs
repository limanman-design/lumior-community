import test from 'node:test';
import assert from 'node:assert/strict';
import { enableBoardThesis, createThesisArtifact, boardThesisSnapshot, boardThesisSession, thesisInputSignature, applyThesisResult, reconcileThesisEdits, resolveThesisProposal, restoreThesisRevision, copyBoardThesis, setThesisSource, thesisSourcePath, protectedThesisCards, validBoardThesis, thesisCardMarkdown } from '../app/thesis-board.ts';
import { newThesisSession } from '../lib/thesis/model.ts';
import { patchCanvasCard } from '../app/canvas-card-update.ts';
import { readWorkspace, recycleBoard } from '../app/workspace-store.ts';
import { mergeRestoredWorkspace } from '../app/workspace-backup.ts';
import { remapPortableHistories } from '../app/desktop-portable-backup.ts';
const path = 'thesis/topic.md';
const initial = () => createThesisArtifact(enableBoardThesis({id:'board-a',title:'论文 A',cards:[],edges:[]}),path,'## 一句话研究问题\n\n研究审批延迟的原因');
const result = (board, text) => ({ snapshot: { ...boardThesisSnapshot(board), files: { ...boardThesisSnapshot(board).files, [path]: { path, text, modifiedAt: 1000 } } }, session: newThesisSession('mba-topic','chat'), text:'建议', changed:[path] });
test('live card is the single source; title and version are independent of body headings',()=>{
 let b=initial(); b.cards[0].title='我改了卡片标题'; b.cards[0].body='直接写自己的选题';
 assert.equal(boardThesisSnapshot(b).files[path].text,'# 选题卡 v1\n\n直接写自己的选题');
 assert.equal(b.thesis.files[path],undefined); assert.equal(boardThesisSnapshot(b).files['thesis/settings.md'].path,'thesis/settings.md');
});
test('normal note edits archive once per edit session and flag downstream without replacing it',()=>{
 let b=createThesisArtifact(initial(),'thesis/review-draft.md','用户综述'); const id=b.cards[0].id;
 const next=patchCanvasCard(b,id,{body:'新的研究问题'},[b],new Date(100000).toISOString()).board;
 assert.equal(next.thesis.topicVersion,2); assert.equal(next.thesis.history.length,1);
 assert.match(next.thesis.artifacts['thesis/review-draft.md'].needsReview,/v2/); assert.equal(next.cards[1].body,'用户综述');
 const again=patchCanvasCard(next,id,{body:'新的研究问题，补充'},[next],new Date(101000).toISOString()).board;
 assert.equal(again.thesis.topicVersion,2); assert.equal(again.thesis.history.length,1);
 assert.equal(patchCanvasCard(again,id,{x:120},[again]).board.thesis,again.thesis);
});
test('AI changes to an existing card are proposals; edits after proposal prevent adoption',()=>{
 const b=initial(), expected=thesisInputSignature(b); const next=applyThesisResult(b,expected,result(b,'# 选题卡 v2\n\n建议方向'),'chat');
 assert.equal(next.cards[0].body,b.cards[0].body); assert.ok(next.thesis.proposals[path]);
 const adopted=resolveThesisProposal(next,path,true); assert.equal(adopted.cards[0].body,'建议方向'); assert.equal(adopted.thesis.history[0].body,b.cards[0].body);
 const edited=patchCanvasCard(next,next.cards[0].id,{body:'我另有想法'},[next]).board;
 assert.throws(()=>resolveThesisProposal(edited,path,true),/又有变化/);
 assert.equal(resolveThesisProposal(edited,path,false).cards[0].body,'我另有想法');
});
test('in-flight edits, replaced PDFs, changed scope and another board reject entire result; moves do not',()=>{
 let b=initial(); b={...b,cards:[...b.cards,{id:'pdf',kind:'pdf',title:'来源',body:'',x:0,y:0,width:360,pdf:{url:'local:a',size:5}}]}; b=setThesisSource(b,'pdf','refs');
 const expected=thesisInputSignature(b), r=result(b,'# 选题卡 v2\n\n结果');
 for(const changed of [{...b,id:'other'},patchCanvasCard(b,b.cards[0].id,{body:'新修改'},[b]).board,setThesisSource(b,'pdf','rubric'),patchCanvasCard(b,'pdf',{pdf:{url:'local:b',size:5}},[b]).board]) assert.throws(()=>applyThesisResult(changed,expected,r,'chat'),/已改变/);
 assert.doesNotThrow(()=>applyThesisResult({...b,cards:b.cards.map(c=>({...c,x:500}))},expected,r,'chat'));
});
test('unassigned PDFs are excluded; roles are per board, stable across renames and confined to their directories',()=>{
 let b=initial(); b.cards.push({id:'p',kind:'pdf',title:'学院模板.pdf',body:'',x:0,y:0,width:360,pdf:{url:'a'}});
 assert.deepEqual(b.thesis.sources,{}); const c=setThesisSource(b,'p','template');
 assert.equal(thesisSourcePath('p','template',c.cards[1]),'thesis/template/p.pdf'); assert.deepEqual(b.thesis.sources,{});
 assert.equal(thesisSourcePath('p','refs',{...c.cards[1],title:'重命名'}),'thesis/refs/p.pdf');
});
test('delete leaves missing binding and archives restorable content; duplicates cannot inherit role by title',()=>{
 const b=initial(), id=b.cards[0].id; assert.equal(protectedThesisCards(b,[id]).length,1);
 const removed=reconcileThesisEdits(b,{...b,cards:[]}); assert.equal(boardThesisSnapshot(removed).files[path],undefined); assert.ok(removed.thesis.artifacts[path]);
 const r=applyThesisResult(removed,thesisInputSignature(removed),result(removed,'# 选题卡 v2\n\n建议'),'chat'); assert.equal(r.cards.length,0);
 const restored=restoreThesisRevision(removed,removed.thesis.history[0].id); assert.equal(restored.cards[0].id,id); assert.equal(restored.cards[0].body,b.cards[0].body);
 assert.equal(protectedThesisCards({...b,cards:[{...b.cards[0],id:'copy'}]},['copy']).length,0);
});
test('copied board remaps bindings and clears conversations, consent and proposals',()=>{
 const b=initial();b.thesis.consentAt=1;b.thesis.sessions.chat=newThesisSession('mba-topic','chat');
 const ids=new Map([[b.cards[0].id,'new-card']]), copy=copyBoardThesis(b,ids);
 assert.equal(copy.artifacts[path].cardId,'new-card'); assert.equal(copy.consentAt,undefined); assert.deepEqual(copy.sessions,{}); assert.equal(b.thesis.artifacts[path].cardId,b.cards[0].id);
});
test('manual edits invalidate stale pending tool questions but retain student conversation',()=>{
 let b=initial(); const r=result(b,'# 选题卡 v1\n\n'+b.cards[0].body);r.session.pending={id:'q',question:'旧问题',options:['A','B']};r.session.turns=[{id:'t',role:'user',text:'我的回答',createdAt:1}];
 b=applyThesisResult(b,thesisInputSignature(b),r,'chat');assert.equal(boardThesisSession(b,'chat','mba-topic').pending.id,'q');
 b=patchCanvasCard(b,b.cards[0].id,{body:'已改变研究对象'},[b]).board;
 const session=boardThesisSession(b,'chat','mba-topic');assert.equal(session.pending,undefined);assert.ok(session.modelMessages.some(m=>m.content==='我的回答'));
});
test('workspace export/read and recycle retain thesis state, malformed metadata is rejected',()=>{
 const b=initial(), snapshot={version:1,boards:[b],deletedBoards:[],activeId:b.id,nextUntitledIndex:1};
 assert.equal(readWorkspace(JSON.stringify(snapshot)).boards[0].thesis.artifacts[path].cardId,b.cards[0].id);
 const recycled=readWorkspace(JSON.stringify({...snapshot,boards:[],deletedBoards:[recycleBoard(b)]}));assert.equal(recycled.deletedBoards[0].board.thesis.topicVersion,1);
 assert.equal(validBoardThesis({...b.thesis,history:null}),false);assert.equal(readWorkspace(JSON.stringify({...snapshot,boards:[{...b,thesis:{version:1}}]})),null);
});
test('normal block editing preserves skill headings, tables and AI notice quotes',()=>{
 const md=thesisCardMarkdown({body:'plain',blocks:[{type:'heading',props:{level:2},content:'一句话研究问题'},{type:'paragraph',content:'问题'},{type:'table',content:{type:'tableContent',rows:[{cells:[[{type:'text',text:'编号'}],[{type:'text',text:'文献'}]]},{cells:[[{type:'text',text:'L01'}],[{type:'text',text:'证据'}]]}]}},{type:'quote',content:'AI 生成说明'}]});
 assert.match(md,/## 一句话研究问题/);assert.match(md,/\| --- \| --- \|/);assert.match(md,/> AI 生成说明/);
});
test('renaming the card or adding evidence counts does not advance the research topic version',()=>{
 let b=initial(); let next=patchCanvasCard(b,b.cards[0].id,{title:'我自己的卡名'},[b]).board;
 assert.equal(next.thesis.topicVersion,1);
 next=patchCanvasCard(next,next.cards[0].id,{body:next.cards[0].body+' 〔支持 L01 · 反驳 —〕'},[next]).board;
 assert.equal(next.thesis.topicVersion,1);
});
test('changing the confirmed dissertation direction versions the topic and flags existing outputs',()=>{
 let b=initial();b.cards[0].body+='\n## 论文方向\n信息管理（已确认）';
 b=createThesisArtifact(b,'thesis/review-draft.md','用户原稿');
 const next=patchCanvasCard(b,b.cards[0].id,{body:b.cards[0].body.replace('信息管理','项目管理')},[b]).board;
 assert.equal(next.thesis.topicVersion,2);
 assert.match(next.thesis.artifacts['thesis/review-draft.md'].needsReview,/v2/);
 assert.equal(next.cards[1].body,'用户原稿');
});
test('backup merge remaps thesis cards, source paths and runtime/chat identities together',()=>{
 let b=initial();b.cards.push({id:'paper',kind:'note',title:'文献',body:'文献文字',x:0,y:0,width:360});b=setThesisSource(b,'paper','refs');
 b=createThesisArtifact(b,'thesis/lit-matrix.md','来源文件：thesis/refs/paper.md');b.thesis.sessions.chat=newThesisSession('mba-lit','chat');
 const snap={version:1,boards:[b],deletedBoards:[],activeId:b.id,nextUntitledIndex:1}, ids=new Map();
 const merged=mergeRestoredWorkspace({...snap,boards:[]},snap,ids), restored=merged.boards[0];
 assert.notEqual(restored.id,b.id);assert.equal(restored.thesis.artifacts[path].cardId,restored.cards[0].id);
 assert.equal(restored.thesis.sources[ids.get('paper')],'refs');assert.ok(restored.cards[2].body.includes(`thesis/refs/${ids.get('paper')}.md`));
 assert.ok(merged.files.contents.find(c=>c.card.title==='文献矩阵').card.body.includes(ids.get('paper')));
 const history={version:1,boardId:b.id,activeId:'chat',chats:[{id:'chat',boardId:b.id,title:'读文献',messages:[],refs:[],skill:'mba-lit'}]};
 const portable=remapPortableHistories({aiHistories:[history]},ids,new Map());
 assert.equal(portable[0].activeId,ids.get('chat'));assert.ok(restored.thesis.sessions[portable[0].activeId]);assert.equal(restored.thesis.sessions[portable[0].activeId].id,portable[0].activeId);
});
