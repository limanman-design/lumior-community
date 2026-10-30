import test from 'node:test';
import assert from 'node:assert/strict';
import { thesisChat, thesisMessageQuestions } from '../app/thesis-chat.ts';
import { enableBoardThesis, boardThesisSession, thesisInputSignature } from '../app/thesis-board.ts';
import { newAiChat, restoredAiHistory } from '../app/ai-chat-store.ts';
import { detectThesisSkill, thesisCommandBody, newThesisSession } from '../lib/thesis/model.ts';
const board = () => enableBoardThesis({id:'a',title:'论文',cards:[],edges:[]});
test('ordinary questions cannot enter MBA even when mentioning thesis stage keywords',()=>{
 for(const value of ['文献综述是什么？','帮我选题','开题报告怎么写','读这篇文献','模拟答辩','请解释 mba-topic','mba-topic-extra']) assert.equal(detectThesisSkill(value),undefined,value);
 for(const name of ['topic','lit','review','proposal']) for(const prefix of ['','/']) assert.equal(detectThesisSkill(` ${prefix}mba-${name} \n我的问题`),`mba-${name}`);
 assert.equal(thesisCommandBody('mba-topic'),'');assert.equal(thesisCommandBody('/mba-topic 我在制造业'),'我在制造业');
});
test('first entry guides in conversation without creating artifacts or granting consent',()=>{
 const b=board(), snapshot=structuredClone(b), chat=thesisChat(b,[],'mba-topic',1);
 assert.match(chat.messages[0].text,/不用先新建卡片/);assert.match(chat.messages[0].text,/行业/);
 assert.equal(chat.skill,'mba-topic');assert.equal(b.thesis.consentAt,undefined);assert.deepEqual(b,snapshot);
 const restored=restoredAiHistory({version:1,boardId:b.id,activeId:chat.id,chats:[chat]},b.id);
 assert.equal(thesisChat(b,restored.chats,'mba-topic').id,chat.id);
});
test('same-board command finds pending stage behind newer ordinary or empty chats',()=>{
 const b=board(), topic=thesisChat(b,[],'mba-topic',1), ordinary=newAiChat(b.id,[],100), empty=newAiChat(b.id,[],200,'mba-topic');
 b.thesis.sessions[topic.id]=newThesisSession('mba-topic',topic.id);
 b.thesis.sessions[topic.id].pending={id:'pending',question:'行业？',options:['制造业']};
 b.thesis.sessionContexts[topic.id]=thesisInputSignature(b);
 const found=thesisChat(b,[ordinary,empty,topic],'mba-topic');
 assert.equal(found.id,topic.id); assert.equal(boardThesisSession(b,found.id,'mba-topic').pending.id,'pending');
 assert.equal(ordinary.skill,'research');
});
test('stages retain independent sessions; another board cannot resume this one',()=>{
 const b=board(), topic=thesisChat(b,[],'mba-topic',1), lit=thesisChat(b,[topic],'mba-lit',2);
 assert.notEqual(lit.id,topic.id); assert.equal(thesisChat(b,[lit,topic],'mba-topic').id,topic.id);
 const other=enableBoardThesis({...board(),id:'b',thesis:undefined});
 assert.notEqual(thesisChat(other,[topic,lit],'mba-topic').id,topic.id);
});
test('runtime stage wins over legacy chat label and missing history can be reconstructed',()=>{
 const b=board(), old=thesisChat(b,[],'mba-topic',1);
 b.thesis.sessions[old.id]={...newThesisSession('mba-lit',old.id),turns:[{id:'t',role:'assistant',text:'继续读文献',createdAt:10}]};
 assert.notEqual(thesisChat(b,[old],'mba-topic').id,old.id);
 const recovered=thesisChat(b,[],'mba-lit'); assert.equal(recovered.id,old.id); assert.equal(recovered.messages[0].text,'继续读文献');
});

test('an empty legacy stage conversation receives the inline guide',()=>{
 const b=board(), empty=newAiChat(b.id,[],1,'mba-topic');
 const next=thesisChat(b,[empty],'mba-topic');assert.equal(next.id,empty.id);assert.match(next.messages[0].text,/行业/);assert.equal(empty.messages.length,0);
});

test('question choices stay on their original assistant turn while an answer is running and after restore',()=>{
 const question={id:'q1',question:'研究哪个管理对象？',options:['建设项目','业务流程']};
 const b=board(), chat=thesisChat(b,[],'mba-topic');
 chat.messages=[{id:'a1',role:'assistant',text:question.question,createdAt:1,live:true,thesisQuestion:question},{id:'u1',role:'user',text:'建设项目',createdAt:2,live:true},{id:'a2',role:'assistant',text:'',status:'pending',createdAt:3,live:true}];
 for(const messages of [chat.messages,restoredAiHistory({version:1,boardId:b.id,activeId:chat.id,chats:[chat]},b.id).chats[0].messages]){
  const map=thesisMessageQuestions(messages);assert.deepEqual([...map.keys()],['a1']);assert.equal(map.get('a1').answer,'建设项目');
 }
});
test('legacy session choices are recovered in chronological order, including repeated questions',()=>{
 const question={id:'q1',question:'请选择',options:['A','B']}, second={...question,id:'q2'};
 const session=newThesisSession('mba-topic');session.turns=[{id:'t1',role:'assistant',text:'请选择',question,createdAt:1},{id:'t2',role:'user',text:'我用自己的话回答',createdAt:2},{id:'t3',role:'assistant',text:'请选择',question:second,createdAt:3}];
 const messages=[{id:'a1',role:'assistant',text:'请选择\n\n有 1 项修改建议等待采纳。'},{id:'u1',role:'user',text:'我用自己的话回答'},{id:'a2',role:'assistant',text:'请选择'}];
 const map=thesisMessageQuestions(messages,session);assert.equal(map.get('a1').question.id,'q1');assert.equal(map.get('a2').question.id,'q2');assert.equal(map.get('a2').answer,undefined);
});

test('first-entry guide delegates intake to the original Skill without a hardcoded Q0',()=>{
 const b=board(), chat=thesisChat(b,[],'mba-topic',1);assert.match(chat.messages[0].text,/发送“开始”/);assert.doesNotMatch(chat.messages[0].text,/Q0|学校／导师要求/);
 const continued=thesisChat(b,[{...chat,messages:[...chat.messages,{id:'answer',role:'user',text:'方向未定',createdAt:2}]}],'mba-topic',3);assert.equal(continued.messages.at(-1).text,'方向未定');
});
