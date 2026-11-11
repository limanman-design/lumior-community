import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyExampleConnections, isConnectionExample } from '../app/daily-example-connections.ts';
import { dailyMaterialExampleCards as dailyConnectionExampleCards, dailyMaterialExampleBoardId as dailyConnectionExampleBoardId } from '../app/daily-material-examples.ts';
import { connectionInput, readConnections } from '../app/daily-connections.ts';
import { syncWorkspaceFiles, addWorkspaceContent } from '../app/workspace-files.ts';
import { markDailyCapture, dailyContents } from '../app/daily-model.ts';
import { recycleWorkspaceContents, restoreWorkspaceContent } from '../app/workspace-file-recycle.ts';
const setup=()=>{
 const cards=dailyConnectionExampleCards();const boards=[{id:dailyConnectionExampleBoardId,title:'关联示例',edges:[],cards:cards.slice(5)}];
 let files=syncWorkspaceFiles(undefined,boards);
 for(const card of cards.slice(0,5))files=markDailyCapture(addWorkspaceContent(files,card,null,'notePage',1),card.id,'daily',1);
 return {files,boards,records:dailyContents(files)};
};
test('fixed examples are available without permissions and have verified literal evidence in both languages',()=>{
 const {records,boards}=setup();
 for(const language of ['zh','en']){
  const edges=dailyExampleConnections(records,boards,language);assert.equal(edges.length,2);assert.ok(edges.every(edge=>edge.example));
  assert.ok(edges.every(edge=>edge.relation!=='Possible connection'&&edge.relation!=='潜在联系'));
  const validated=readConnections(edges,connectionInput(records,boards,language));assert.equal(validated.length,2);
  assert.ok(validated.every(edge=>!edge.example&&!edge.captureEvidence),'model results cannot claim built-in example provenance or verified PDF locations');
 }
});
test('ordinary copies, renamed or edited examples cannot produce curated recommendations',()=>{
 const {records,boards}=setup();
 assert.deepEqual(dailyExampleConnections(records,[], 'zh'),[]);
 assert.deepEqual(dailyExampleConnections(records,boards.map(b=>({...b,id:'ordinary'})),'zh'),[]);
 for(const patch of [{body:'My own content'},{title:'Renamed'},{tags:[]},{pdf:{url:'my-own.pdf'}},{blocks:[{id:'edited',type:'paragraph',content:[]}]}]){
  const changed=records.map(c=>c.id.endsWith('uncertainty')?{...c,card:{...c.card,...patch}}:c);
  assert.equal(dailyExampleConnections(changed,boards,'zh').length,1);
 }
 const copies=records.map(c=>({...c,id:'copy-'+c.id}));assert.deepEqual(dailyExampleConnections(copies,boards,'zh'),[]);
 const changedSources=boards.map(b=>({...b,cards:b.cards.map(c=>({...c,body:'Edited source'}))}));
 assert.deepEqual(dailyExampleConnections(records,changedSources,'zh'),[]);
});
test('organizing and dismissing examples removes the matching recommendation while reading or moving does not',()=>{
 const {records,boards}=setup();const id=records.find(c=>c.id.endsWith('uncertainty')).id;
 for(const daily of [{organizedAt:2},{dismissedBoards:[dailyConnectionExampleBoardId]}]){
  assert.equal(dailyExampleConnections(records.map(c=>c.id===id?{...c,daily:{...c.daily,...daily}}:c),boards,'zh').length,1);
 }
 const own={id:'own',title:'User board',cards:[{...records.find(c=>c.id===id).card,sharedId:id,id:'instance'}]};
 assert.equal(dailyExampleConnections(records,[...boards,own],'zh').length,1);
 assert.equal(dailyExampleConnections(records.map(c=>({...c,daily:{...c.daily,lastUsedAt:4,position:{x:10,y:20}}})),boards,'zh').length,2);
});
test('clear and undo preserve exact example identities and restore their relationships',()=>{
 const {files,boards}=setup();const ids=files.contents.map(c=>c.id);let recycled=recycleWorkspaceContents(files,boards,ids,2);
 assert.equal(dailyExampleConnections(dailyContents(recycled.files),recycled.boards,'zh').length,0);
 for(const id of ids)recycled=restoreWorkspaceContent(recycled.files,recycled.boards,id,3);
 assert.equal(dailyExampleConnections(dailyContents(recycled.files),recycled.boards,'zh').length,2);
});
test('exact examples can be removed from model scope without discarding user content',()=>{
 const {records,boards}=setup();const own={id:'own',card:{id:'own',kind:'note',title:'Own',body:'My question'}};
 const input=connectionInput([...records,own].filter(c=>!isConnectionExample(c.card,c.id)),boards.map(b=>({...b,cards:b.cards.filter(c=>!isConnectionExample(c))})),'zh');
 assert.deepEqual(input.captures.map(c=>c.id),['own']);assert.deepEqual(input.boards,[]);
});

test('clearing the material demo recycles PDFs and board notes while keeping unrelated captures', async()=>{
 const {removableDailyExamples}=await import('../app/daily-preview.ts');
 const {files,boards}=setup();
 const own={id:'own',kind:'note',title:'User note',body:'Keep me',x:0,y:0,width:300};
 const mixed=markDailyCapture(addWorkspaceContent(files,own),'own','daily',2);
 const ids=removableDailyExamples(mixed,boards);
 assert.equal(ids.length,8);assert.ok(!ids.includes('own'));
 const cleared=recycleWorkspaceContents(mixed,boards,ids,3);
 assert.deepEqual(cleared.files.contents.map(c=>c.id),['own']);
 assert.equal(cleared.boards[0].cards.length,0);
 const edited={...mixed,contents:mixed.contents.map(c=>c.card.pdf?{...c,card:{...c.card,pdf:{...c.card.pdf,url:'my-replacement.pdf'}}}:c)};
 assert.equal(removableDailyExamples(edited,boards).length,6);
});

test('full demo quotations are literal sentences on the cited bundled PDF page', async()=>{
 const {readFile}=await import('node:fs/promises');
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const {records,boards}=setup();
 for(const edge of dailyExampleConnections(records,boards,'zh')){
  const evidence=edge.captureEvidence;assert.ok(evidence);assert.equal(evidence.page,1);
  const card=records.find(item=>item.id===edge.contentId).card;
  const doc=await getDocument({data:new Uint8Array(await readFile(new URL('../public'+card.pdf.url,import.meta.url)))}).promise;
  const page=await doc.getPage(evidence.page);const text=await page.getTextContent();
  const normalize=s=>s.replace(/-\s+/g,'').replace(/\s+/g,' ').trim();
  assert.ok(normalize(text.items.map(item=>item.str).join(' ')).includes(normalize(evidence.quote)),card.title);
  assert.ok(evidence.quote.endsWith('.'));assert.ok(evidence.translation.length>20);
 }
});
