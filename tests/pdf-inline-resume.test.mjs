import test from 'node:test';
import assert from 'node:assert/strict';
import {resumeInlineTranslation,mergeInlineTranslationUnit} from '../lib/pdf-inline-resume.ts';
import {translationComplete} from '../lib/pdf-translation.ts';
import {prepareInlineFormulaPages} from '../lib/pdf-inline-formulas.ts';

const rect={x:10,y:20,width:38,height:1.3};
const formula={marker:'{v1}',text:'E = mc²',rect:{x:20,y:20,width:12,height:2},baseline:21.3,fontSize:10};
function fixture(){
 const old=[{id:'1:0:0',text:'Plain introduction.',rects:[rect]},{id:'1:0:1',text:'The energy E = mc² is positive.',rects:[{...rect,y:24}]}];
 const parts=[{...old[0],sourceHash:'a'.repeat(64)},{...old[1],text:'The energy {v1} is positive.',sourceHash:'b'.repeat(64),inlineFormulas:[formula]}];
 const unit={id:'1:0',page:1,inlineMathVersion:1,parts,text:parts.map(part=>part.text).join('')};
 const plan={units:[unit],legacyUnits:[{id:'1:0',page:1,parts:old,text:old.map(part=>part.text).join('')}],legacyPartIds:{'1:0:0':['1:0:0'],'1:0:1':['1:0:1']},totalPages:1,emptyPages:[]};
 const saved={units:[{id:'1:0',page:1,text:'旧译文',parts:old.map((part,index)=>({...part,text:['保留的介绍。','错误的旧公式。'][index]}))}],complete:true};
 return{plan,unit,saved};
}
test('legacy repair reuses unchanged prose and keeps old formula text visible until a verified replacement arrives',()=>{
 const {plan,unit,saved}=fixture(),before=structuredClone(saved),result=resumeInlineTranslation(plan,saved);
 assert.equal(result.remaining.length,1);assert.equal(result.remaining[0].parts[0].reuseText,'保留的介绍。');
 assert.equal(result.remaining[0].parts[1].reuseText,undefined);
 assert.equal(result.previous[0].parts[1].text,'错误的旧公式。');assert.equal(result.previous[0].parts[1].sourceHash,undefined);
 assert.equal(translationComplete([unit],result.previous),false);
 const received={...unit,parts:[{...unit.parts[1],text:'能量 {v1} 为正。'}]};
 const merged=mergeInlineTranslationUnit(unit,result.previous[0],received);
 assert.equal(merged.parts[0].text,'保留的介绍。');assert.equal(merged.parts[1].text,'能量 {v1} 为正。');
 assert.equal(translationComplete([unit],[merged]),true);assert.deepEqual(saved,before);
});
test('resume requires matching fingerprints and intact markers, while stale paragraphs remain visible for repair',()=>{
 const {plan,unit}=fixture();
 const saved={inlineMathVersion:1,units:[{...unit,parts:[{...unit.parts[0],text:'完成的介绍。'},{...unit.parts[1],text:'能量 {v1} 为正。'}]}]};
 assert.equal(resumeInlineTranslation(plan,saved).remaining.length,0);
 for(const update of [{sourceHash:'c'.repeat(64)},{text:'能量为正。'},{inlineFormulas:[{...formula,marker:'{v2}'}]}]){
  const value=structuredClone(saved);Object.assign(value.units[0].parts[1],update);
  const result=resumeInlineTranslation(plan,value);assert.equal(result.remaining.length,1);
  assert.equal(result.remaining[0].parts[0].reuseText,'完成的介绍。');assert.equal(result.remaining[0].parts[1].reuseText,undefined);
  assert.equal(result.previous[0].parts[1].sourceHash,undefined);
 }
});
test('partial responses cannot overwrite a paragraph with wrong IDs, fingerprints, changed formulas or missing markers',()=>{
 const {unit}=fixture();
 for(const patch of [{id:'9:0:0'},{sourceHash:'c'.repeat(64)},{text:'缺了公式。'},{inlineFormulas:[]},{inlineFormulas:[{...formula,rect:{...formula.rect,x:70}}]}]){
  const received={...unit,parts:[{...unit.parts[1],text:'能量 {v1} 为正。',...patch}]};
  assert.throws(()=>mergeInlineTranslationUnit(unit,undefined,received),/本段未替换/);
 }
 assert.throws(()=>mergeInlineTranslationUnit(unit,undefined,{...unit,page:2}),/无法核对/);
});
test('legacy prose is not reused through a changed or ambiguous source mapping',()=>{
 for(const change of ['geometry','text','aliases']){
  const {plan,saved}=fixture();
  if(change==='geometry')saved.units[0].parts[0].rects=[{...rect,x:80}];
  if(change==='text')plan.units[0].parts[0].text='New source.';
  if(change==='aliases')plan.legacyPartIds['1:0:0']=['1:0:0','1:0:1'];
  assert.equal(resumeInlineTranslation(plan,saved).remaining[0].parts[0].reuseText,undefined);
 }
});

test('a legacy paragraph longer than one unit reuses each source-matched slice without duplicating the full old translation',async()=>{
 const text='word '.repeat(1000),plan=await prepareInlineFormulaPages([{page:1,width:600,height:800,text,items:[],paragraphs:[{start:0,end:text.length,rects:[rect]}]}]);
 const saved={complete:true,units:plan.legacyUnits.map((unit,index)=>({...unit,parts:unit.parts.map(part=>({...part,text:`旧译文第${index+1}部分。`}))}))},before=structuredClone(saved);
 const result=resumeInlineTranslation(plan,saved);
 assert.deepEqual(result.previous.flatMap(unit=>unit.parts.map(part=>part.text)),['旧译文第1部分。','旧译文第2部分。']);
 assert.equal(result.remaining.length,0);assert.ok(translationComplete(plan.units,result.previous));assert.deepEqual(saved,before);
});

test('source overlap restores marker text before assigning shared legacy aliases to new slices',()=>{
 const legacyParts=[{id:'1:0:0',text:'Energy E = mc². ',rects:[rect]},{id:'1:0:1',text:'Final plain sentence.',rects:[rect]}];
 const parts=[{...legacyParts[0],text:'Energy {v1}. ',sourceHash:'a'.repeat(64),inlineFormulas:[formula]},{...legacyParts[1],sourceHash:'b'.repeat(64)}];
 const unit={id:'1:0',page:1,inlineMathVersion:1,parts,text:parts.map(part=>part.text).join('')};
 const plan={units:[unit],legacyUnits:[{id:'1:0',page:1,parts:legacyParts,text:legacyParts.map(part=>part.text).join('')}],legacyPartIds:{'1:0:0':['1:0:0','1:0:1'],'1:0:1':['1:0:0','1:0:1']},totalPages:1,emptyPages:[]};
 const result=resumeInlineTranslation(plan,{units:[{...plan.legacyUnits[0],parts:legacyParts.map((part,index)=>({...part,text:['旧能量说明。','保留的末句。'][index]}))}]});
 assert.deepEqual(result.previous[0].parts.map(part=>part.text),['旧能量说明。','保留的末句。']);
 assert.equal(result.remaining[0].parts[0].reuseText,undefined);assert.equal(result.remaining[0].parts[1].reuseText,'保留的末句。');
});

test('one historical translation crossing new boundaries remains once until the last slice is replaced, including after pause',()=>{
 const legacyPart={id:'1:0:0',text:'Energy E = mc². Final sentence.',rects:[rect]};
 const parts=[{id:'1:0:0',text:'Energy {v1}. ',rects:[rect],sourceHash:'a'.repeat(64),inlineFormulas:[formula]},{id:'1:0:1',text:'Final sentence.',rects:[rect],sourceHash:'b'.repeat(64)}];
 const unit={id:'1:0',page:1,inlineMathVersion:1,parts,text:parts.map(part=>part.text).join('')};
 const plan={units:[unit],legacyUnits:[{id:'1:0',page:1,text:legacyPart.text,parts:[legacyPart]}],legacyPartIds:{'1:0:0':['1:0:0'],'1:0:1':['1:0:0']},totalPages:1,emptyPages:[]};
 const old='历史完整译文，待译的最后一句仍需保留。';
 const migrated=resumeInlineTranslation(plan,{units:[{...plan.legacyUnits[0],parts:[{...legacyPart,text:old}]}]});
 assert.deepEqual(migrated.previous[0].parts.map(part=>[part.id,part.text]),[['1:0:1',old]]);
 const merged=mergeInlineTranslationUnit(unit,migrated.previous[0],{...unit,parts:[{...parts[0],text:'能量 {v1}。'}]});
 const resumed=resumeInlineTranslation(plan,{inlineMathVersion:1,units:[merged]});
 assert.deepEqual(resumed.previous[0].parts.map(part=>part.text),['能量 {v1}。',old]);
 assert.equal(resumed.remaining[0].parts[0].reuseText,'能量 {v1}。');assert.equal(resumed.remaining[0].parts[1].reuseText,undefined);
 assert.equal(translationComplete([unit],resumed.previous),false);
 const final=mergeInlineTranslationUnit(unit,resumed.previous[0],{...unit,parts:[{...parts[1],text:'最后一句。'}]});
 assert.deepEqual(final.parts.map(part=>part.text),['能量 {v1}。','最后一句。']);assert.ok(translationComplete([unit],[final]));
});
