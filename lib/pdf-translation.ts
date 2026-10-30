import type {SourceParagraph,SourceRect} from './pdf-paragraphs';
export type TranslationPart={id:string;text:string;rects:SourceRect[]};
export type TranslationUnit = { id: string; page: number; text: string; parts?:TranslationPart[]; referenceText?:string; protected?:boolean };
export type TranslationGlossary = { source: string; target: string }[];
export type PdfLayoutPage={source:number;target:number;sourceRects:{id:string;rect:SourceRect}[];rects:{id:string;rect:SourceRect}[]};
export type PdfLayoutArtifact={version:1;engine:'BabelDOC';engineVersion:string;url:string;name:string;size:number;sha256:string;pages:PdfLayoutPage[]};
export type TranslationMode='original-layout'|'reflow';
export type PdfTranslationSnapshot = {
 version: 1; sourceKey: string; target: 'zh-CN'; sourceLanguage: string; model: string;
 units: TranslationUnit[]; glossary: TranslationGlossary; totalPages: number; emptyPages: number[];
 complete: boolean; updatedAt: number;
 mode?:TranslationMode;layout?:PdfLayoutArtifact;layoutSourceHash?:string;
};
export type PdfTranslation=PdfTranslationSnapshot&{alternates?:Partial<Record<TranslationMode,PdfTranslationSnapshot>>};

function translationSnapshot(value:PdfTranslation):PdfTranslationSnapshot{
 const {alternates:_alternates,...snapshot}=value;return snapshot;
}
// Older saved translations predate the original-layout engine and are reflow.
export function savedTranslationMode(saved:PdfTranslation|undefined,sourceKey:string):TranslationMode{
 return saved?.sourceKey===sourceKey?(saved.mode||'reflow'):'original-layout';
}
export function translationForMode(saved:PdfTranslation|undefined,mode:TranslationMode,sourceKey:string):PdfTranslationSnapshot|undefined{
 if(saved?.sourceKey!==sourceKey)return;
 const candidate=(saved.mode||'reflow')===mode?saved:saved.alternates?.[mode];
 if(candidate?.sourceKey!==sourceKey||(candidate.mode||'reflow')!==mode)return;
 return translationSnapshot(candidate);
}
export function saveTranslationMode(previous:PdfTranslation|undefined,value:PdfTranslationSnapshot):PdfTranslation{
 const snapshot=translationSnapshot(value),mode=value.mode||'reflow',other=mode==='original-layout'?'reflow':'original-layout';
 const alternate=translationForMode(previous,other,value.sourceKey);
 return {...snapshot,...(alternate?{alternates:{[other]:alternate}}:{})};
}
export function translationReady(value:PdfTranslationSnapshot|undefined):boolean{
 return !!value?.complete&&(value.mode==='original-layout'?!!value.layout:value.units.length>0&&value.units.every(unit=>!!unit.parts?.length));
}
export type TranslationEvent =
 | { type: 'start'; model: string }
 | { type: 'progress'; message: string }
 | { type: 'translated'; units: TranslationUnit[]; sourceLanguage: string; glossary: TranslationGlossary }
 | { type: 'done' }
 | { type: 'error'; message: string };

function protectedTokens(text:string){
 const counts=new Map<string,number>(),nesting=new Map<string,number>(),stack:string[]=[];
 const token=/\{v\d+\}|<style\s+id=(['"])\d+\1\s*>|<\/style\s*>/g;
 const add=(map:Map<string,number>,value:string)=>map.set(value,(map.get(value)||0)+1);
 let end=0;
 for(const match of text.matchAll(token)){
  if(/\{\s*v|<\s*\/?\s*style\b/i.test(text.slice(end,match.index)))throw new Error('译文中的公式或文字样式标记格式不正确，本批未保存。');
  const value=match[0];end=match.index!+value.length;
  if(value.startsWith('{'))add(counts,value);
  else if(value.startsWith('</')){if(!stack.length)throw new Error('译文中的文字样式标记未正确闭合，本批未保存。');stack.pop();add(counts,'</style>');}
  else{const id=/id=['"](\d+)['"]/.exec(value)![1];add(counts,`<style:${id}>`);add(nesting,`${stack.join('/')}>${id}`);stack.push(id);}
 }
 if(stack.length||/\{\s*v|<\s*\/?\s*style\b/i.test(text.slice(end)))throw new Error('译文中的公式或文字样式标记未完整保留，本批未保存。');
 return {counts,nesting};
}
export function validateProtectedTranslation(source:string,target:string){
 const before=protectedTokens(source),after=protectedTokens(target);
 for(const field of ['counts','nesting'] as const){const a=before[field],b=after[field];if(a.size!==b.size||[...a].some(([id,count])=>b.get(id)!==count))throw new Error('译文中的公式或文字样式标记发生变化，本批未保存，可重试。');}
}

export function resumeLayoutUnits(input:TranslationUnit[],saved:TranslationUnit[],receipts:{id:string;legacyId:string;page:number;text:string}[]=[]){
 const sources=new Map(input.map(unit=>[unit.id,unit])),completed=new Map<string,TranslationUnit>();
 // Only equivalent marker spelling is canonicalized. The translation text
 // itself must exactly match a source-verified historical engine receipt.
 const canonical=(text:string)=>text.replace(/<style\s+id=(['"])(\d+)\1\s*>/g,(_,_quote,id)=>`<style id='${id}'>`).replace(/<\/style\s*>/g,'</style>');
 for(const unit of saved){
  if(typeof unit.text!=='string'||!unit.text.trim()||unit.text.length>20000)continue;
  let source=sources.get(unit.id);
  if(!source||source.page!==unit.page){
   const candidates=receipts.filter(receipt=>receipt.legacyId===unit.id&&receipt.page===unit.page&&canonical(receipt.text)===canonical(unit.text)&&sources.get(receipt.id)?.page===unit.page);
   const ids=new Set(candidates.map(receipt=>receipt.id));
   if(ids.size!==1)continue;
   source=sources.get(candidates[0].id);
  }
  if(!source)continue;
  try{validateProtectedTranslation(source.text,unit.text);}catch{continue;}
  completed.set(source.id,{...source,text:unit.text});
 }
 return input.flatMap(unit=>completed.has(unit.id)?[completed.get(unit.id)!]:[]);
}

// Units cover each page exactly once, including the tail. No retrieval or overlap.
export function translationUnits(pages: { page: number; text: string; paragraphs?:SourceParagraph[] }[]): TranslationUnit[] {
 return pages.flatMap(({page,text,paragraphs})=>{
  const units:TranslationUnit[]=[];let start=0,index=0;
  while(start<text.length){
   let end=Math.min(text.length,start+4500);
   if(end<text.length){const boundary=Math.max(text.lastIndexOf('\n',end),text.lastIndexOf('. ',end),text.lastIndexOf('。',end));if(boundary>start+2200)end=Math.min(end,boundary+1);}
   const part=text.slice(start,end);if(part.trim()){const id=`${page}:${index++}`;const groups=paragraphs?.filter(p=>p.end>start&&p.start<end);const parts=groups?.map((p,i)=>({id:`${id}:${i}`,text:text.slice(Math.max(start,p.start),Math.min(end,p.end)),rects:p.rects}));units.push({id,page,text:part,...(parts?.length?{parts}:{})});}start=end;
  }
  return units;
 });
}
export function parseTranslationInput(value:unknown):TranslationUnit[]{
 if(!Array.isArray(value)||!value.length||value.length>2000)throw new Error('没有可翻译的文字，或资料超过本轮翻译容量。');
 const ids=new Set<string>();let characters=0;
 return value.map(item=>{
  if(!item||typeof item!=='object')throw new Error('翻译资料格式不正确。');
  const v=item as Record<string,unknown>;
  if(typeof v.id!=='string'||!/^\d+:\d+$/.test(v.id)||ids.has(v.id)||!Number.isInteger(v.page)||Number(v.page)<1||Number(v.page)>500||typeof v.text!=='string'||!v.text.trim()||v.text.length>4500)throw new Error('翻译资料格式不正确。');
  ids.add(v.id);characters+=v.text.length;if(characters>2_000_000)throw new Error('资料超过本轮完整翻译容量，请拆分 PDF。');
  if(v.protected!==undefined&&v.protected!==true)throw new Error('公式与文字样式保护格式不正确。');
  if(v.protected===true)protectedTokens(v.text);
  let parts:TranslationPart[]|undefined;
  if(v.parts!==undefined){
   if(!Array.isArray(v.parts)||!v.parts.length||v.parts.length>500)throw new Error('段落对照格式不正确。');
   const unitId=v.id;
   parts=v.parts.map((value:unknown,i:number)=>{
    const part=value&&typeof value==='object'?value as Record<string,unknown>:{};
    if(part.id!==`${unitId}:${i}`||typeof part.text!=='string'||!Array.isArray(part.rects)||part.rects.length>500)throw new Error('段落对照格式不正确。');
    const rects=part.rects.map((value:unknown)=>{
     const r=value&&typeof value==='object'?value as Record<string,unknown>:{};
     if(['x','y','width','height'].some(key=>typeof r[key]!=='number'||!Number.isFinite(r[key]))||Number(r.width)<=0||Number(r.height)<=0)throw new Error('段落对照格式不正确。');
     return {x:Number(r.x),y:Number(r.y),width:Number(r.width),height:Number(r.height)};
    });
    return {id:String(part.id),text:part.text,rects};
   });
   if(parts.map(p=>p.text).join('')!==v.text)throw new Error('段落对照未覆盖完整原文。');
  }
  return {id:v.id,page:Number(v.page),text:v.text,...(parts?{parts}:{}),...(typeof v.referenceText==='string'&&v.referenceText.length<=20000?{referenceText:v.referenceText}:{}),...(v.protected===true?{protected:true}:{})};
 });
}
export function parseGlossary(value:unknown):TranslationGlossary{
 if(!Array.isArray(value))return [];
 return value.filter((v):v is {source:string;target:string}=>!!v&&typeof v.source==='string'&&typeof v.target==='string'&&v.source.length<=120&&v.target.length<=120).slice(0,100);
}
export function translationResult(content:string,input:TranslationUnit[]){
 let value:Record<string,unknown>;
 try{value=JSON.parse(content.replace(/^\s*```(?:json)?\s*/,'').replace(/\s*```\s*$/,''));}catch{throw new Error('翻译结果格式异常，本批未保存，可重试。');}
 if(!value||typeof value!=='object'||!Array.isArray(value.units)||value.units.length!==input.length||typeof value.sourceLanguage!=='string'||!value.sourceLanguage.trim())throw new Error('译文未覆盖全部原文，本批未保存，可重试。');
 const outputs=value.units as Record<string,unknown>[];
 const ids=new Set(outputs.map(unit=>unit?.id));
 if(ids.size!==input.length)throw new Error('译文段落重复，本批未保存，可重试。');
 const units=input.map(source=>{
  const output=outputs.find(unit=>unit?.id===source.id);if(!output)throw new Error('译文缺少原文段落，本批未保存，可重试。');
  if(source.parts){
   if(!Array.isArray(output.parts)||output.parts.length!==source.parts.length||new Set(output.parts.map((p:unknown)=>p&&typeof p==='object'?(p as Record<string,unknown>).id:undefined)).size!==source.parts.length)throw new Error('译文段落对照不完整，本批未保存，可重试。');
   const parts=source.parts.map(part=>{const value=(output.parts as Record<string,unknown>[]).find(p=>p?.id===part.id);if(!value||typeof value.text!=='string'||!value.text.trim()||value.text.length>20000)throw new Error('译文缺少对应段落，本批未保存，可重试。');if(source.protected)validateProtectedTranslation(part.text,value.text);return {...part,text:value.text.trim()};});
   return {id:source.id,page:source.page,text:parts.map(p=>p.text).join('\n\n'),parts,...(source.protected?{protected:true}:{})};
  }
  if(typeof output.text!=='string'||!output.text.trim()||output.text.length>20000)throw new Error('译文缺少原文段落，本批未保存，可重试。');if(source.protected)validateProtectedTranslation(source.text,output.text);return {id:source.id,page:source.page,text:output.text.trim(),...(source.protected?{protected:true}:{})};
 });
 return {units,sourceLanguage:value.sourceLanguage.slice(0,60),glossary:parseGlossary(value.glossary)};
}
export function translationComplete(input:TranslationUnit[],output:TranslationUnit[]){
 const ids=new Set(output.map(unit=>unit.id));return input.length>0&&ids.size===input.length&&input.every(unit=>{const result=output.find(value=>value.id===unit.id);return ids.has(unit.id)&&(!unit.parts||unit.parts.every(part=>result?.parts?.some(value=>value.id===part.id&&value.text.trim())));});
}
