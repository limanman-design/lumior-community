import test from 'node:test';
import assert from 'node:assert/strict';
import {seedDailyPreview,removableDailyExamples,dailyConnectionExampleCards,dailyConnectionExampleBoardId} from '../app/daily-preview.ts';
import {syncWorkspaceFiles,addWorkspaceContent,patchWorkspaceContent} from '../app/workspace-files.ts';
import {recycleWorkspaceContents,restoreWorkspaceContent} from '../app/workspace-file-recycle.ts';
import {markDailyCapture,positionDailyCapture} from '../app/daily-model.ts';
const now=Date.now();
const seed=()=>seedDailyPreview(syncWorkspaceFiles(undefined,[]),now);
void test('paired examples recycle together with their demo-board references and can be restored',()=>{
 const cards=dailyConnectionExampleCards();
 let files=syncWorkspaceFiles(undefined,[]);
 for(const [index,card] of cards.entries()){
  files=addWorkspaceContent(files,card,null,'notePage',now);
  if(index<5)files=markDailyCapture(files,card.id,'daily',now);
 }
 const boards=[{id:dailyConnectionExampleBoardId,title:'Connections',edges:[],cards:cards.slice(5)}];
 files=syncWorkspaceFiles(files,boards);
 const ids=removableDailyExamples(files,boards);assert.equal(ids.length,8);
 const recycled=recycleWorkspaceContents(files,boards,ids,now);
 assert.equal(recycled.files.recycledContents.length,8);assert.equal(recycled.boards[0].cards.length,0);
 const restored=restoreWorkspaceContent(recycled.files,recycled.boards,cards[5].id,now+1);
 assert.equal(restored.boards[0].cards[0].id,cards[5].id);
 const ownBoard={id:'my-board',title:'My work',edges:[],cards:[cards[5]]};
 assert.ok(!removableDailyExamples(files,[...boards,ownBoard]).includes(cards[5].id));
 const edited=[{...boards[0],cards:[{...cards[5],body:'My own interpretation'}]}];
 assert.ok(!removableDailyExamples(files,edited).includes(cards[5].id));
});
void test('clear examples protects edited and linked cards, custom copies and user captures',()=>{
 let files=seed();const [first,second,third]=files.contents;
 files=patchWorkspaceContent(files,[],first.id,{body:'My own text'}).files;
 const board={id:'b',title:'Board',edges:[],cards:[{...second.card,id:'instance',sharedId:second.id}]};
 files=markDailyCapture(addWorkspaceContent(files,{...third.card,id:'my-copy',sharedId:undefined}), 'my-copy','daily',now);
 const eligible=removableDailyExamples(files,[board]);
 assert.ok(!eligible.includes(first.id));assert.ok(!eligible.includes(second.id));assert.ok(!eligible.includes('my-copy'));
 assert.equal(eligible.length,13);
});
void test('moving, reading and automatic bibliography do not prevent clearing unchanged examples',()=>{
 let files=seed();const id=files.contents[0].id;
 files=positionDailyCapture(files,id,{x:500,y:800});
 files={...files,contents:files.contents.map(content=>({...content,card:{...content.card,bibliography:{status:'pending'}},daily:{...content.daily,lastUsedAt:now}}))};
 assert.equal(removableDailyExamples(files,[]).length,15);
});
void test('clear is recoverable, keeps positions, and does not seed deleted examples again',()=>{
 const files=seed(),id=files.contents[0].id;
 const placed=positionDailyCapture(files,id,{x:90,y:120});
 const recycled=recycleWorkspaceContents(placed,[],removableDailyExamples(placed,[]),now);
 assert.equal(recycled.files.contents.length,0);assert.equal(recycled.files.recycledContents.length,15);
 assert.equal(seedDailyPreview(recycled.files,now+1000).contents.length,0);
 const restored=restoreWorkspaceContent(recycled.files,[],id,now+1);
 assert.deepEqual(restored.files.contents[0].daily.position,{x:90,y:120});
});

void test('PDF annotations and derived notes protect an otherwise unchanged example',()=>{
 const files=seed(),pdf=files.contents.find(content=>content.card.kind==='pdf'),note=files.contents[0];
 assert.ok(!removableDailyExamples(files,[],{[pdf.card.pdf.url]:[{id:'annotation'}]}).includes(pdf.id));
 const derived={...files,contents:[...files.contents,{id:'derived',sourceContentId:note.id,card:{id:'derived',kind:'note',title:'My note',body:'Keep this source',x:0,y:0,width:300}}]};
 assert.ok(!removableDailyExamples(derived,[]).includes(note.id));
});

void test('manual bibliography edits and image rotation keep examples out of bulk removal',()=>{
 const files=seed();
 const changed={...files,contents:files.contents.map((item,i)=>i===0?{...item,card:{...item.card,imageRotation:90}}:i===1?{...item,card:{...item.card,bibliography:{status:'resolved',title:'Edited',manualFields:['title']}}}:item)};
 const ids=removableDailyExamples(changed,[]);
 assert.ok(!ids.includes(files.contents[0].id));assert.ok(!ids.includes(files.contents[1].id));
});
