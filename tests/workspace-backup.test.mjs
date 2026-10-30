import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {PDFDocument} from 'pdf-lib';
import {createWorkspaceBackup,readWorkspaceBackup,mergeRestoredWorkspace,remapBackupAttachments} from '../app/workspace-backup.ts';
import {fileUrl,serializeWorkspace,resolveWorkspace,releaseFileUrls,fileReferencePrefix} from '../app/workspace-assets.ts';
import {setLanguage} from '../app/i18n-core.ts';
import {partitionPinnedBoards,recycleBoard,setBoardPinned} from '../app/workspace-store.ts';
// Existing integrity assertions intentionally check the Simplified Chinese UI.
test.beforeEach(()=>setLanguage('zh',false));
test.afterEach(()=>setLanguage('en',false));
const board={id:'b1',title:'Research',cards:[{id:'c1',kind:'image',title:'Rain',body:'',x:10,y:20,width:300,height:200,image:'/assets/test.png'}],edges:[]};
const snapshot={version:1,boards:[board],deletedBoards:[],activeId:'b1',nextUntitledIndex:1};
const source={getFile:async()=>undefined,fetch:async()=>new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'image/png'}})};
test('complete archive carries attachments and survives rehydration',async()=>{
 const blob=await createWorkspaceBackup(snapshot,source,()=>{}),backup=await readWorkspaceBackup(blob,()=>{});
 assert.equal(backup.files.length,1);assert.equal(backup.files[0].size,3);assert.match(backup.snapshot.boards[0].cards[0].image,/^lumior-file:/);
 const url=fileUrl(backup.files[0]);assert.equal(resolveWorkspace(backup.snapshot).boards[0].cards[0].image,url);assert.deepEqual(serializeWorkspace(resolveWorkspace(backup.snapshot)),backup.snapshot);releaseFileUrls();
});
void test('legacy v1 backups retain no conversation or preference restore payload',async()=>{
 const blob=await createWorkspaceBackup(snapshot,source,()=>{}),zip=await JSZip.loadAsync(await blob.arrayBuffer());
 assert.equal(Object.hasOwn(JSON.parse(await zip.file('manifest.json').async('string')),'portable'),false);
 assert.equal(Object.hasOwn(await readWorkspaceBackup(blob,()=>{}),'portable'),false);
});
void test('portable v1 archive carries conversations and safe settings alongside verified attachments',async()=>{
 const chat={id:'chat',boardId:'b1',title:'Notes',createdAt:1,updatedAt:2,messages:[{id:'q',role:'user',text:'Question',createdAt:1,live:true,references:[{id:'c1',title:'Rain',kind:'image',fileKey:'/assets/test.png'}]}],draft:'Continue',refs:['c1'],model:'auto',live:true};
 const portable={version:1,aiHistories:[{version:1,boardId:'b1',activeId:'chat',chats:[chat]}],preferences:{language:'zh',noteFitLimits:{minHeight:200,maxHeight:1200},apiKey:'must-not-export'},apiKey:'must-not-export'};
 const blob=await createWorkspaceBackup(snapshot,source,()=>{},portable),zip=await JSZip.loadAsync(await blob.arrayBuffer()),manifest=JSON.parse(await zip.file('manifest.json').async('string'));
 assert.equal(manifest.version,1);assert.equal(JSON.stringify(manifest).includes('must-not-export'),false);
 const prepared=await readWorkspaceBackup(blob,()=>{});
 assert.equal(prepared.portable.aiHistories[0].chats[0].draft,'Continue');
 assert.equal(prepared.portable.aiHistories[0].chats[0].messages[0].references[0].fileKey,prepared.snapshot.boards[0].cards[0].image);
 assert.deepEqual(prepared.portable.preferences,{language:'zh',noteFitLimits:{minHeight:200,maxHeight:1200}});
 assert.equal(prepared.files.length,1);
 // Invalid extra records fail during preparation before any restore is possible.
 manifest.portable.preferences.language='invalid';zip.file('manifest.json',JSON.stringify(manifest));
 await assert.rejects(readWorkspaceBackup(new Blob([await zip.generateAsync({type:'uint8array'})]),()=>{}),/偏好设置格式无效/);
});
test('PDF annotation keys and URL values use the same stable reference',()=>{
 const file={id:crypto.randomUUID(),name:'test.pdf',type:'application/pdf',size:1,blob:new Blob(['x'])},url=fileUrl(file);
 const saved=serializeWorkspace({pdf:{url},pdfMarks:{[url]:[{id:'mark'}]}});assert.equal(saved.pdf.url,fileReferencePrefix+file.id);assert.deepEqual(saved.pdfMarks[saved.pdf.url],[{id:'mark'}]);assert.deepEqual(resolveWorkspace(saved),{pdf:{url},pdfMarks:{[url]:[{id:'mark'}]}});releaseFileUrls();
});
test('attachment checksum catches corruption',async()=>{
 const zip=await JSZip.loadAsync(await (await createWorkspaceBackup(snapshot,source,()=>{})).arrayBuffer());const manifest=JSON.parse(await zip.file('manifest.json').async('string'));zip.file(manifest.files[0].path,new Uint8Array([3,2,1]));
 await assert.rejects(readWorkspaceBackup(new Blob([await zip.generateAsync({type:'uint8array'})]),()=>{}),/校验失败/);
});
test('missing attachments stop complete backup',async()=>{
 const broken={...snapshot,boards:[{...board,cards:[{...board.cards[0],image:fileReferencePrefix+crypto.randomUUID()}]}]};await assert.rejects(createWorkspaceBackup(broken,source,()=>{}),/丢失/);
});
test('backup errors and progress follow both interface languages',async()=>{
 const broken={...snapshot,boards:[{...board,cards:[{...board.cards[0],image:fileReferencePrefix+crypto.randomUUID()}]}]};
 for(const language of ['en','zh']){
  setLanguage(language,false);
  const progress=[];
  await assert.rejects(createWorkspaceBackup(broken,source,message=>progress.push(message)),language==='en'?/attachments are missing/:/丢失/);
  assert.equal(progress[0],language==='en'?'Collecting attachments 1 / 1':'正在收集附件 1 / 1');
 }
});
test('restore preserves existing boards and remaps shared content together',()=>{
 const shared={...board,cards:[{...board.cards[0],sharedId:'shared'}]};const other={...shared,id:'b2',cards:[{...shared.cards[0],id:'c2'}],edges:[{id:'e',from:'c2',to:'c2'}]};
 const restored=mergeRestoredWorkspace(snapshot,{...snapshot,boards:[shared,other]});assert.equal(restored.boards.length,3);assert.deepEqual(restored.boards[0],board);assert.notEqual(restored.boards[1].id,board.id);assert.equal(restored.boards[1].cards[0].sharedId,restored.boards[2].cards[0].sharedId);assert.notEqual(restored.boards[1].cards[0].sharedId,'shared');assert.equal(restored.boards[2].edges[0].from,restored.boards[2].cards[0].id);
});
void test('portable full backup preserves pins through new board IDs without changing current pins',async()=>{
 const now=Date.now(),pinned=setBoardPinned(board,true,now),trashed=setBoardPinned({...board,id:'trashed'},true,now-1);
 const saved={...snapshot,boards:[pinned],deletedBoards:[recycleBoard(trashed,now)]};
 const prepared=await readWorkspaceBackup(await createWorkspaceBackup(saved,source,()=>{}),()=>{});
 assert.equal(prepared.snapshot.boards[0].pinnedAt,now);
 assert.equal(prepared.snapshot.deletedBoards[0].board.pinnedAt,now-1);
 const existing=setBoardPinned({...board,id:'existing'},true,now-2),identities=new Map();
 const restored=mergeRestoredWorkspace({...snapshot,boards:[existing],activeId:existing.id},prepared.snapshot,identities);
 assert.deepEqual(restored.boards[0],existing);
 assert.equal(restored.boards[1].id,identities.get(board.id));
 assert.notEqual(restored.boards[1].id,board.id);
 assert.equal(restored.boards[1].pinnedAt,now);
 assert.equal(restored.deletedBoards[0].board.id,identities.get(trashed.id));
 assert.equal(restored.deletedBoards[0].board.pinnedAt,now-1);
 assert.deepEqual(partitionPinnedBoards(restored.boards).pinned.map(item=>item.id),[restored.boards[1].id,existing.id]);
});
void test('legacy backup without pins restores unpinned boards and preserves existing pins',async()=>{
 const prepared=await readWorkspaceBackup(await createWorkspaceBackup(snapshot,source,()=>{}),()=>{});
 assert.equal(Object.hasOwn(prepared.snapshot.boards[0],'pinnedAt'),false);
 const current=setBoardPinned({...board,id:'current'},true,Date.now());
 const restored=mergeRestoredWorkspace({...snapshot,boards:[current]},prepared.snapshot);
 assert.deepEqual(partitionPinnedBoards(restored.boards).pinned,[current]);
 assert.equal(Object.hasOwn(restored.boards[1],'pinnedAt'),false);
});
void test('malformed pin metadata in a backup is cleared while verified board content survives',async()=>{
 const zip=await JSZip.loadAsync(await (await createWorkspaceBackup(snapshot,source,()=>{})).arrayBuffer());
 const manifest=JSON.parse(await zip.file('manifest.json').async('string'));
 manifest.workspace.boards[0].pinnedAt='not-a-timestamp';
 zip.file('manifest.json',JSON.stringify(manifest));
 const prepared=await readWorkspaceBackup(new Blob([await zip.generateAsync({type:'uint8array'})]),()=>{});
 assert.equal(Object.hasOwn(prepared.snapshot.boards[0],'pinnedAt'),false);
 assert.equal(prepared.snapshot.boards[0].title,board.title);
 assert.equal(prepared.snapshot.boards[0].cards[0].title,board.cards[0].title);
 assert.equal(prepared.files.length,1);
});
test('invalid card geometry is rejected before restore',async()=>{
 const zip=await JSZip.loadAsync(await (await createWorkspaceBackup(snapshot,source,()=>{})).arrayBuffer());const manifest=JSON.parse(await zip.file('manifest.json').async('string'));manifest.workspace.boards[0].cards[0].width=null;zip.file('manifest.json',JSON.stringify(manifest));await assert.rejects(readWorkspaceBackup(new Blob([await zip.generateAsync({type:'uint8array'})]),()=>{}),/卡片或批注格式无效/);
});

async function dualTranslationFixture(){
 const makeFile=async name=>{
  const document=await PDFDocument.create();document.addPage([612,792]).drawText(name,{x:40,y:740,size:14});
  const bytes=await document.save(),blob=new Blob([bytes],{type:'application/pdf'});
  return {id:crypto.randomUUID(),name,type:'application/pdf',size:blob.size,blob};
 };
 const original=await makeFile('fixture.pdf'),translated=await makeFile('fixture.zh-CN.pdf');
 const originalUrl=fileUrl(original),translatedUrl=fileUrl(translated),sourceKey=`v1:pdf:${fileReferencePrefix+original.id}:${original.size}:zh-CN:1`;
 const base={version:1,sourceKey,target:'zh-CN',sourceLanguage:'英语',model:'fixture',glossary:[],totalPages:1,emptyPages:[],complete:true,updatedAt:0};
 const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await translated.blob.arrayBuffer()))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
 const layout={version:1,engine:'BabelDOC',engineVersion:'0.6.4',url:translatedUrl,name:translated.name,size:translated.size,sha256,pages:[{source:1,target:1,sourceRects:[],rects:[]}]};
 const translation={...base,mode:'reflow',units:[{id:'1:0',page:1,text:'普通译文。',parts:[{id:'1:0:0',text:'普通译文。',rects:[]}]}],alternates:{'original-layout':{...base,mode:'original-layout',units:[{id:'1:123',page:1,text:'原版式译文。',protected:true}],layout}}};
 const card={id:'pdf-fixture',kind:'pdf',title:'Fixture',body:'fixture.pdf',x:10,y:20,width:300,height:440,pdf:{url:originalUrl,name:original.name,size:original.size,pages:1,thumbnail:'',translation}};
 return {workspace:{...snapshot,boards:[{...board,cards:[card]}]},original,translated,originalUrl,translatedUrl,sourceKey};
}

void test('inactive original-layout artifact serializes and rehydrates alongside its stable source key',async t=>{
 t.after(releaseFileUrls);
 const fixture=await dualTranslationFixture(),saved=serializeWorkspace(fixture.workspace),pdf=saved.boards[0].cards[0].pdf;
 assert.equal(pdf.url,fileReferencePrefix+fixture.original.id);
 assert.equal(pdf.translation.sourceKey,fixture.sourceKey);
 assert.equal(pdf.translation.alternates['original-layout'].sourceKey,fixture.sourceKey);
 assert.equal(pdf.translation.alternates['original-layout'].layout.url,fileReferencePrefix+fixture.translated.id);
 assert.deepEqual(resolveWorkspace(saved),fixture.workspace);
 releaseFileUrls();
 const reopenedOriginal=fileUrl(fixture.original),reopenedTranslated=fileUrl(fixture.translated),restored=resolveWorkspace(saved).boards[0].cards[0].pdf;
 assert.notEqual(reopenedOriginal,fixture.originalUrl);
 assert.notEqual(reopenedTranslated,fixture.translatedUrl);
 assert.equal(restored.url,reopenedOriginal);
 assert.equal(restored.translation.sourceKey,fixture.sourceKey);
 assert.equal(restored.translation.alternates['original-layout'].sourceKey,fixture.sourceKey);
 assert.equal(restored.translation.alternates['original-layout'].layout.url,reopenedTranslated);
 assert.deepEqual(serializeWorkspace(resolveWorkspace(saved)),saved);
});

void test('complete backup includes source PDF and inactive original-layout PDF while ordinary translation is selected',async t=>{
 t.after(releaseFileUrls);
 const fixture=await dualTranslationFixture(),files=new Map([fixture.original,fixture.translated].map(file=>[file.id,file]));
 const backup=await readWorkspaceBackup(await createWorkspaceBackup(fixture.workspace,{getFile:async id=>files.get(id),fetch:async()=>{throw new Error('fixture uses stored attachments only');}},()=>{}),()=>{});
 assert.deepEqual(new Set(backup.files.map(file=>file.id)),new Set(files.keys()));
 assert.equal(backup.files.length,2);
 for(const file of backup.files)assert.deepEqual(new Uint8Array(await file.blob.arrayBuffer()),new Uint8Array(await files.get(file.id).blob.arrayBuffer()));
 const savedPdf=backup.snapshot.boards[0].cards[0].pdf;
 assert.equal(savedPdf.translation.mode,'reflow');
 assert.equal(savedPdf.translation.alternates['original-layout'].layout.url,fileReferencePrefix+fixture.translated.id);
 releaseFileUrls();
 const restoredUrls=new Map(backup.files.map(file=>[file.id,fileUrl(file)])),restored=resolveWorkspace(backup.snapshot).boards[0].cards[0].pdf;
 assert.equal(restored.url,restoredUrls.get(fixture.original.id));
 assert.equal(restored.translation.alternates['original-layout'].layout.url,restoredUrls.get(fixture.translated.id));
 assert.equal(restored.translation.sourceKey,fixture.sourceKey);
 assert.equal(restored.translation.alternates['original-layout'].sourceKey,fixture.sourceKey);
 assert.deepEqual(serializeWorkspace(resolveWorkspace(backup.snapshot)),backup.snapshot);
});

void test('legacy full backup keeps both PDF translation modes attached after restore generates new file IDs',async t=>{
 t.after(releaseFileUrls);
 const fixture=await dualTranslationFixture(),files=new Map([fixture.original,fixture.translated].map(file=>[file.id,file]));
 const prepared=await readWorkspaceBackup(await createWorkspaceBackup(fixture.workspace,{getFile:async id=>files.get(id),fetch:async()=>{throw new Error('Stored fixture attachments only');}},()=>{}),()=>{});
 assert.equal(prepared.portable,undefined);
 const replacements=new Map(prepared.files.map(file=>[fileReferencePrefix+file.id,fileReferencePrefix+crypto.randomUUID()]));
 const restored=remapBackupAttachments(prepared.snapshot,replacements).boards[0].cards[0].pdf;
 const expected=`v1:pdf:${restored.url}:${fixture.original.size}:zh-CN:1`;
 assert.notEqual(restored.url,prepared.snapshot.boards[0].cards[0].pdf.url);
 assert.equal(restored.translation.sourceKey,expected);
 assert.equal(restored.translation.alternates['original-layout'].sourceKey,expected);
 assert.equal(restored.translation.alternates['original-layout'].layout.url,replacements.get(fileReferencePrefix+fixture.translated.id));
});
