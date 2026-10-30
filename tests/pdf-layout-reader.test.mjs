import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {parseTranslationInput,translationResult,validateProtectedTranslation,resumeLayoutUnits} from '../lib/pdf-translation.ts';
import {readLayoutPdf,createLayoutTranslationFile} from '../lib/pdf-layout-artifact.ts';
import {translatePdfUnits} from '../lib/pdf-translation-service.ts';
import {parseRecoveredLayoutUnits} from '../app/pdf-layout-client.ts';

const protectedSource="A <style id='0'>bold <style id='1'>italic {v2}</style></style> and {v3}.";
const protectedTarget='{v3}与<style id="0">粗体<style id="1">斜体 {v2}</style></style>。';
const unit={id:'1:0',page:1,text:protectedSource,protected:true};
const output=text=>JSON.stringify({sourceLanguage:'英语',units:[{id:unit.id,text}]});

test('recovered layout cache validates source IDs, page ownership and protected translation before reuse',()=>{
 const source={...unit,id:'1:123456789012345678901234567890123456789'};
 const receipt={id:source.id,page:source.page,text:protectedTarget};
 assert.deepEqual(parseRecoveredLayoutUnits(undefined,[source]),[]);
 const recovered=parseRecoveredLayoutUnits([receipt],[source]);
 assert.deepEqual(recovered,[{...source,text:protectedTarget}]);
 assert.deepEqual(resumeLayoutUnits([source],recovered),recovered);
 for(const value of [
  null,{},[null],[{...receipt,id:'1:999'}],[{...receipt,page:2}],
  [receipt,receipt],[{...receipt,text:''}],[{...receipt,text:'😃'.repeat(10001)}],
  [{...receipt,text:protectedTarget.replace('{v2}','{v9}')}],
  [{...receipt,text:protectedTarget+'{vBAD}'}],
  [{...receipt,text:protectedTarget.replace('</style>','')}],
 ])assert.throws(()=>parseRecoveredLayoutUnits(value,[source]));
 assert.throws(()=>parseRecoveredLayoutUnits([receipt],[{...source,protected:undefined}]));
});

test('recovered layout target totals are bounded independently of source length',()=>{
 const input=Array.from({length:101},(_,i)=>({id:`1:${i}`,page:1,text:'Small source',protected:true}));
 const recovered=input.map(({id,page})=>({id,page,text:'中'.repeat(20000)}));
 assert.equal(parseRecoveredLayoutUnits(recovered.slice(0,100),input).length,100);
 assert.throws(()=>parseRecoveredLayoutUnits(recovered,input),/capacity|容量/);
});

test('layout cache only migrates ordinal IDs through exact source-verified translation receipts',()=>{
 const source={id:'1:123456789012345678901234567890123456789',page:1,text:"Original <style id='0'>text {v0}</style>",protected:true};
 const saved={id:'1:0',page:1,text:'原文<style id="0">文字 {v0}</style>',protected:true};
 const receipt={id:source.id,legacyId:saved.id,page:1,text:"原文<style id='0'>文字 {v0}</style>"};
 assert.deepEqual(resumeLayoutUnits([source],[saved]),[]);
 assert.deepEqual(resumeLayoutUnits([source],[saved],[receipt]),[{...source,text:saved.text}]);
 assert.deepEqual(resumeLayoutUnits([source],[{...saved,id:source.id}]),[{...source,text:saved.text}]);
 assert.deepEqual(resumeLayoutUnits([source],[saved],[{...receipt,text:receipt.text.replace('文字','删减')}]),[]);
 assert.deepEqual(resumeLayoutUnits([source],[saved],[{...receipt,page:2}]),[]);
 assert.deepEqual(resumeLayoutUnits([{...source,text:source.text.replace('{v0}','{v1}')}],[saved],[receipt]),[]);
 const other={...source,id:'1:987654321098765432109876543210987654321'};
 assert.deepEqual(resumeLayoutUnits([source,other],[saved],[receipt,{...receipt,id:other.id}]),[]);
});

test('many small protected labels are translated in bounded batches without losing IDs',async()=>{
 const input=Array.from({length:31},(_,i)=>({id:`1:${i}`,page:1,text:`Label ${i} {v0}`,protected:true}));
 const batches=[],events=[];
 await translatePdfUnits(input,[],async messages=>{
  const sent=JSON.parse(messages[1].content).units;batches.push(sent);
  return {message:{role:'assistant',content:JSON.stringify({sourceLanguage:'英语',units:sent.map(unit=>({id:unit.id,text:`标签 ${unit.id} {v0}`}))})},reason:'stop'};
 },event=>events.push(event),new AbortController().signal);
 assert.deepEqual(batches.map(batch=>batch.length),[12,12,7]);
 assert.deepEqual(events.filter(event=>event.type==='translated').flatMap(event=>event.units).map(unit=>unit.id),input.map(unit=>unit.id));
 assert.equal(events.at(-1).type,'done');
});

test('protected layout translation preserves formulas, style IDs and nested style hierarchy',()=>{
 assert.deepEqual(parseTranslationInput([unit]),[unit]);
 assert.doesNotThrow(()=>validateProtectedTranslation(protectedSource,protectedTarget));
 const translated=translationResult(output(protectedTarget),[unit]);
 assert.equal(translated.units[0].protected,true);
 assert.equal(translated.units[0].text,protectedTarget);
 for(const text of [
  protectedTarget.replace('{v2}',''),
  protectedTarget+'{v2}',
  protectedTarget.replace('{v2}','{v20}'),
  protectedTarget.replace('id="1"','id="9"'),
  protectedTarget.replace('</style>',''),
  protectedTarget+'</style>',
  '<style id="1"><style id="0">中文{v2}</style></style>{v3}',
  '<style id="0">中文</style><style id="1">{v2}</style>{v3}',
  protectedTarget.replace('id="1"','id="1\''),
  protectedTarget.replace('{v2}','{ v2 }'),
  protectedTarget+'<style class="bold">额外</style>',
 ])assert.throws(()=>translationResult(output(text),[unit]),/公式|样式/);
});

test('only true opts into protected input and malformed source markers are rejected',()=>{
 for(const protectedFlag of [false,null,0,'true',{}])assert.throws(()=>parseTranslationInput([{...unit,protected:protectedFlag}]),/保护格式/);
 assert.throws(()=>parseTranslationInput([{...unit,text:"<style id='0'>unclosed {v0}"}]),/样式/);
 const plain={id:'1:0',page:1,text:'A variable {v0}.'};
 assert.equal(translationResult(output('普通译文。'),[plain]).units[0].text,'普通译文。');
});

test('protected paragraph translations cannot move or remove markers from their corresponding part',()=>{
 const parts=[{id:'1:0:0',text:'Formula {v0}.',rects:[]},{id:'1:0:1',text:"<style id='1'>Bold.</style>",rects:[]}];
 const input={id:'1:0',page:1,text:parts.map(part=>part.text).join(''),parts,protected:true};
 const result=JSON.stringify({sourceLanguage:'英语',units:[{id:'1:0',parts:[{id:'1:0:0',text:'公式 {v0}。'},{id:'1:0:1',text:"<style id='1'>粗体。</style>"}]}]});
 assert.equal(translationResult(result,[input]).units[0].protected,true);
 assert.throws(()=>translationResult(result.replace('{v0}',''),[input]),/公式|样式/);
});

async function artifactFixture(){
 const document=await PDFDocument.create();document.addPage([612,792]);
 const bytes=await document.save();
 const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
 const layout={version:1,engine:'BabelDOC',engineVersion:'0.6.4',url:'blob:reviewed-layout-pdf',name:'layout.pdf',size:bytes.length,sha256,pages:[{source:1,target:1,sourceRects:[],rects:[]}]};
 const translation={version:1,sourceKey:'test',target:'zh-CN',sourceLanguage:'英语',model:'test',units:[],glossary:[],totalPages:1,emptyPages:[],complete:true,updatedAt:0,mode:'original-layout',layout};
 return {bytes,layout,translation};
}

test('original-layout export reuses exactly the preview PDF bytes and page dimensions',async()=>{
 const {bytes,layout,translation}=await artifactFixture();let reads=0;
 const fetcher=async url=>{assert.equal(url,layout.url);reads++;return new Response(bytes);};
 const preview=await readLayoutPdf(layout,fetcher);
 const exported=await createLayoutTranslationFile('研究',translation,fetcher);
 assert.equal(exported.name,'研究 · 中文译文.pdf');assert.equal(exported.type,'application/pdf');
 assert.deepEqual(new Uint8Array(await exported.arrayBuffer()),new Uint8Array(await preview.arrayBuffer()));
 assert.deepEqual(new Uint8Array(await exported.arrayBuffer()),bytes);assert.equal(reads,2);
 const document=await PDFDocument.load(await exported.arrayBuffer());
 assert.deepEqual(document.getPage(0).getSize(),{width:612,height:792});
});

test('missing, corrupt, truncated and unfinished layout artifacts cannot be exported',async()=>{
 const {bytes,layout,translation}=await artifactFixture();
 const changed=bytes.slice();changed[changed.length-10]^=1;
 await assert.rejects(readLayoutPdf(layout,async()=>new Response(changed)),/完整性/);
 await assert.rejects(readLayoutPdf(layout,async()=>new Response(bytes.slice(0,-1))),/完整性/);
 await assert.rejects(readLayoutPdf({...layout,sha256:'bad'},async()=>new Response(bytes)),/保存记录/);
 await assert.rejects(readLayoutPdf(layout,async()=>new Response('',{status:404})),/无法读取/);
 await assert.rejects(readLayoutPdf(layout,async()=>{throw new Error('expired blob');}),/无法读取/);
 await assert.rejects(createLayoutTranslationFile('研究',{...translation,complete:false},async()=>new Response(bytes)),/完成原版式/);
 await assert.rejects(createLayoutTranslationFile('研究',{...translation,layout:undefined},async()=>new Response(bytes)),/完成原版式/);
 const nonPdf=new TextEncoder().encode('not a PDF');
 const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',nonPdf))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
 await assert.rejects(readLayoutPdf({...layout,size:nonPdf.length,sha256},async()=>new Response(nonPdf)),/有效 PDF/);
});
