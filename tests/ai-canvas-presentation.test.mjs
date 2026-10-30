import test from 'node:test';
import assert from 'node:assert/strict';
import { appendAiReferences, canvasConversationMessages, canvasPanelMessages, canvasRunningActivity, completedAiRounds, readAiCanvasView } from '../app/ai-canvas-presentation.ts';
import { newAiChat, restoredAiHistory } from '../app/ai-chat-store.ts';

test('collapsed activity follows recorded stages and stops for completed, cancelled and interrupted requests', () => {
 const t = (_en, zh) => zh;
 const message = { id:'a', role:'assistant', text:'', createdAt:1, status:'streaming', process:[{message:'正在按卡片尺寸准备排布，不读取资料正文…',elapsed:0}] };
 assert.equal(canvasRunningActivity(message,t).label,'准备画板整理');
 const checking = {...message,process:[...message.process,{message:'正在核对画板排布与操作范围…',elapsed:2}]};
 assert.equal(canvasRunningActivity(checking,t).label,'核对排布与操作范围');
 assert.equal(canvasRunningActivity(checking,(en)=>en).label,'Checking layout and scope');
 for (const status of ['complete','stopped','interrupted','error']) assert.equal(canvasRunningActivity({...checking,status},t),null);
 assert.equal(canvasRunningActivity(undefined,t),null);
 const unknown = canvasRunningActivity({...message,process:[{message:'worker card_id=private-card',elapsed:0}]},t);
 assert.equal(unknown.label,'正在处理请求');
 assert.ok(!unknown.detail.includes('private-card'));
});

void test('adding selected cards preserves the existing conversation, draft, model and unavailable references', () => {
 const chat={...newAiChat('board',['a','deleted']),draft:'Keep this unfinished question',model:'local-model',messages:[{id:'q',role:'user',text:'Previous question',live:true,createdAt:1}]};
 const before=JSON.stringify(chat);
 const next=appendAiReferences(chat,['a','b','b','missing'],['a','b']);
 assert.deepEqual(next.refs,['a','deleted','b']);assert.equal(next.id,chat.id);assert.equal(next.draft,chat.draft);assert.equal(next.messages,chat.messages);assert.equal(next.model,chat.model);assert.equal(JSON.stringify(chat),before);
});
void test('the third-round hint counts completed question/answer pairs rather than regenerations and failures', () => {
 const question=id=>({id,role:'user',text:id,live:true,createdAt:1});
 const answer=(id,replyTo,status='complete',live=true)=>({id,role:'assistant',text:id,replyTo,status,live,createdAt:2});
 const messages=[question('q1'),answer('a1','q1'),answer('a1-new','q1'),question('q2'),answer('a2','q2','error'),question('q3'),answer('a3','q3','streaming'),answer('orphan','missing'),answer('preset','q2','complete',false)];
 assert.equal(completedAiRounds(messages),1);
 messages.push(answer('a2-retry','q2'));assert.equal(completedAiRounds(messages),2);
 messages.push(answer('a3-done','q3'));assert.equal(completedAiRounds(messages),3);
 messages.push(question('operation'),{...answer('op-result','operation'),operationOnly:true});assert.equal(completedAiRounds(messages),3);
});
void test('legacy history opens at bottom; new presentation survives history restore without changing reader data', () => {
 assert.deepEqual(readAiCanvasView(undefined),{docked:false,collapsed:false,dockHintDismissed:false});
 const chat={...newAiChat('board'),draft:'Saved draft',refs:['note'],canvasView:{pinned:true,docked:true,collapsed:false,dockHintDismissed:true}};
 const result=restoredAiHistory({version:1,boardId:'board',activeId:chat.id,chats:[chat]},'board');
 assert.deepEqual(result.chats[0].canvasView,chat.canvasView);assert.equal(result.chats[0].draft,'Saved draft');assert.deepEqual(result.chats[0].refs,['note']);
 assert.deepEqual(readAiCanvasView({docked:'yes',collapsed:true,unknown:1}),{docked:false,collapsed:true,dockHintDismissed:false});
});

void test('conversation excludes completed operations, but keeps the question when an explanation is regenerated',()=>{
 const q={id:'q',role:'user',text:'Create cards',live:true,createdAt:1};
 const op={id:'op',role:'assistant',text:'Created',replyTo:'q',operationOnly:true,status:'complete',live:true,createdAt:2};
 const explanation={id:'explanation',role:'assistant',text:'Explanation only',replyTo:'q',status:'complete',live:true,createdAt:3};
 assert.deepEqual(canvasConversationMessages([q,op]),[]);
 assert.deepEqual(canvasConversationMessages([q,op,explanation]),[q,explanation]);
});


test('operation answers remain in an existing conversation for persistent undo, while standalone operations stay lightweight', () => {
 const q={id:'q',role:'user',text:'Create',live:true,createdAt:1};
 const op={id:'op',role:'assistant',text:'Created',replyTo:'q',operationOnly:true,status:'complete',live:true,createdAt:2};
 const answer={id:'answer',role:'assistant',text:'Discussion',status:'complete',live:true,createdAt:0};
 assert.deepEqual(canvasPanelMessages([q,op]),[]);
 assert.deepEqual(canvasPanelMessages([answer,q,op]),[answer,q,op]);
 assert.deepEqual(canvasPanelMessages([q,op],true),[q,op]);
 assert.deepEqual(canvasConversationMessages([answer,q,op]),[answer], 'the two history categories remain separate');
});

 test('conversation pin survives storage; legacy and invalid pin values remain unpinned',()=>{
  assert.equal(readAiCanvasView({pinned:true}).pinned,true);
  assert.equal(readAiCanvasView({pinned:false}).pinned,undefined);
  assert.equal(readAiCanvasView({pinned:'true'}).pinned,undefined);
 });
