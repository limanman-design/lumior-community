import test from 'node:test';
import assert from 'node:assert/strict';
import {savedTranslationMode,saveTranslationMode,translationForMode,translationReady} from '../lib/pdf-translation.ts';

const sourceKey='v1:pdf:/research/fixture.pdf:100:zh-CN:1';
const rect={x:10,y:15,width:75,height:3};
const plainUnit={id:'1:0',page:1,text:'完整普通译文。',parts:[{id:'1:0:0',text:'完整普通译文。',rects:[rect]}]};
const layoutUnit={id:'1:123456789',page:1,text:'原版式已译段落 {v0}。',protected:true};
const base={version:1,sourceKey,target:'zh-CN',sourceLanguage:'英语',model:'fixture',glossary:[],totalPages:1,emptyPages:[],updatedAt:0};
const ordinary={...base,mode:'reflow',units:[plainUnit],complete:true};
const layoutDraft={...base,mode:'original-layout',units:[layoutUnit],layoutSourceHash:'1'.repeat(64),complete:false};
const artifact={version:1,engine:'BabelDOC',engineVersion:'0.6.4',url:'lumior-file:11111111-1111-4111-8111-111111111111',name:'fixture.zh-CN.pdf',size:200,sha256:'2'.repeat(64),pages:[{source:1,target:1,sourceRects:[{id:layoutUnit.id,rect}],rects:[{id:layoutUnit.id,rect}]}]};
const original={...layoutDraft,complete:true,layout:artifact};

void test('failed original-layout draft preserves finished ordinary translation and resumes its own translated units',()=>{
 const before=structuredClone(ordinary);
 let saved=saveTranslationMode(ordinary,layoutDraft);
 assert.equal(saved.mode,'original-layout');
 assert.equal(translationReady(saved),false);
 const restoredOrdinary=translationForMode(saved,'reflow',sourceKey);
 assert.deepEqual(restoredOrdinary,ordinary);
 assert.equal(translationReady(restoredOrdinary),true);
 saved=saveTranslationMode(saved,restoredOrdinary);
 assert.equal(saved.mode,'reflow');
 assert.deepEqual(saved.units,ordinary.units);
 const resumedOriginal=translationForMode(saved,'original-layout',sourceKey);
 assert.deepEqual(resumedOriginal,layoutDraft);
 assert.deepEqual(resumedOriginal.units,[layoutUnit]);
 assert.equal(resumedOriginal.layoutSourceHash,layoutDraft.layoutSourceHash);
 saved=saveTranslationMode(saved,resumedOriginal);
 assert.equal(saved.mode,'original-layout');
 assert.deepEqual(saved.units,[layoutUnit]);
 assert.deepEqual(translationForMode(saved,'reflow',sourceKey),ordinary);
 assert.deepEqual(ordinary,before);
});

void test('completed versions survive repeated bidirectional switches without recursive alternates or lost inactive PDF',()=>{
 let saved=saveTranslationMode(saveTranslationMode(ordinary,layoutDraft),original);
 const completed=structuredClone(original);
 for(let i=0;i<40;i++){
  const mode=i%2===0?'reflow':'original-layout',other=mode==='reflow'?'original-layout':'reflow';
  const selected=translationForMode(saved,mode,sourceKey);
  assert.equal(translationReady(selected),true);
  saved=saveTranslationMode(saved,selected);
  assert.equal(saved.mode,mode);
  assert.deepEqual(Object.keys(saved.alternates),[other]);
  assert.equal(Object.hasOwn(saved.alternates[other],'alternates'),false);
  assert.equal(Object.hasOwn(translationForMode(saved,mode,sourceKey),'alternates'),false);
  assert.deepEqual(translationForMode(saved,'original-layout',sourceKey),completed);
  assert.deepEqual(translationForMode(saved,'reflow',sourceKey),ordinary);
  assert.equal(JSON.stringify(saved).match(/"alternates"/g).length,1);
 }
});

void test('legacy translations without a mode are ordinary translations and stay reusable after original-layout fails',()=>{
 const {mode:_mode,...legacy}=ordinary;
 assert.deepEqual(translationForMode(legacy,'reflow',sourceKey),legacy);
 assert.equal(translationForMode(legacy,'original-layout',sourceKey),undefined);
 assert.equal(translationReady(legacy),true);
 const saved=saveTranslationMode(legacy,layoutDraft);
 assert.deepEqual(translationForMode(saved,'reflow',sourceKey),legacy);
 assert.deepEqual(translationForMode(saved,'original-layout',sourceKey),layoutDraft);
});

void test('initial mode restores matching legacy and explicit selections while new or replacement PDFs default to original layout',()=>{
 const {mode:_mode,...legacy}=ordinary,newKey='v1:pdf:/research/replacement.pdf:200:zh-CN:1';
 assert.equal(savedTranslationMode(undefined,sourceKey),'original-layout');
 assert.equal(savedTranslationMode(legacy,sourceKey),'reflow');
 assert.equal(savedTranslationMode({...legacy,complete:false},sourceKey),'reflow');
 assert.equal(savedTranslationMode(ordinary,sourceKey),'reflow');
 assert.equal(savedTranslationMode(original,sourceKey),'original-layout');
 assert.equal(savedTranslationMode(layoutDraft,sourceKey),'original-layout');
 assert.equal(savedTranslationMode(saveTranslationMode(original,ordinary),sourceKey),'reflow');
 for(const stale of [legacy,ordinary,original,saveTranslationMode(ordinary,original)])assert.equal(savedTranslationMode(stale,newKey),'original-layout');
 assert.equal(savedTranslationMode({...ordinary,alternates:{reflow:{...ordinary,sourceKey:newKey}}},newKey),'original-layout');
});

void test('a replacement PDF cannot restore the old document or an alternate with a different source key',()=>{
 const saved=saveTranslationMode(ordinary,original),newKey='v1:pdf:/research/replacement.pdf:200:zh-CN:1';
 for(const mode of ['reflow','original-layout'])assert.equal(translationForMode(saved,mode,newKey),undefined);
 assert.equal(translationForMode({...saved,alternates:{reflow:{...ordinary,sourceKey:newKey}}},'reflow',sourceKey),undefined);
 const replacement=saveTranslationMode(saved,{...layoutDraft,sourceKey:newKey,units:[]});
 assert.equal(replacement.sourceKey,newKey);
 assert.equal(replacement.alternates,undefined);
 assert.equal(translationForMode(replacement,'reflow',newKey),undefined);
 assert.equal(translationForMode(replacement,'original-layout',sourceKey),undefined);
});

void test('only completed original-layout artifacts and completed ordinary paragraph mappings are ready',()=>{
 assert.equal(translationReady(undefined),false);
 assert.equal(translationReady(original),true);
 assert.equal(translationReady(ordinary),true);
 for(const value of [
  layoutDraft,
  {...original,complete:false},
  {...original,layout:undefined},
  {...ordinary,complete:false},
  {...ordinary,units:[]},
  {...ordinary,units:[{...plainUnit,parts:undefined}]},
  {...ordinary,units:[{...plainUnit,parts:[]}]},
  {...ordinary,units:[plainUnit,{...plainUnit,id:'1:1',parts:undefined}]},
 ])assert.equal(translationReady(value),false);
});
