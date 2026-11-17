import type {SourceParagraph,SourceRect} from './pdf-paragraphs.ts';
import {translationUnits,type TranslationInlineFormula,type TranslationPart,type TranslationUnit} from './pdf-translation.ts';

export type InlineTextItem={str?:string;transform?:number[];width?:number;height?:number;fontName?:string};
export type InlineFormulaPage={page:number;width:number;height:number;text:string;paragraphs:SourceParagraph[];items:InlineTextItem[];styles?:Record<string,{ascent?:number;descent?:number}>;glyphWidths?:Record<string,Record<string,number>>;supported?:boolean};
export type InlineFormulaPlan={units:TranslationUnit[];legacyUnits:TranslationUnit[];legacyPartIds:Record<string,string[]>;totalPages:number;emptyPages:number[]};
type Token={text:string;start:number;end:number;x:number;right:number;top:number;bottom:number;baseline:number;size:number;math:boolean;strong:boolean};
export type InlineFormulaSpan={start:number;end:number;contextStart:number;contextEnd:number;formula:TranslationInlineFormula};

/** Only glyphs whose width is unambiguous in this font can split a mixed item. */
export function inlineGlyphWidths(operators:{fnArray:ArrayLike<number>;argsArray:unknown[][]},setFont:number,showText:number){
 const result:Record<string,Record<string,number>>={},ambiguous=new Set<string>();let font='';
 for(let i=0;i<operators.fnArray.length;i++){
  const args=operators.argsArray[i];if(operators.fnArray[i]===setFont){font=String(args[0]);continue;}
  if(operators.fnArray[i]!==showText||!font||!Array.isArray(args[0]))continue;
  const values=result[font]??={};
  for(const glyph of args[0])if(glyph&&typeof glyph==='object'&&'unicode'in glyph&&'width'in glyph){
   const value=glyph as {unicode:unknown;width:unknown};if(typeof value.unicode!=='string'||Array.from(value.unicode).length!==1||typeof value.width!=='number'||!Number.isFinite(value.width)||value.width<=0)continue;
   const key=font+':'+value.unicode;if(ambiguous.has(key))continue;
   if(values[value.unicode]!==undefined&&Math.abs(values[value.unicode]-value.width)>.1){delete values[value.unicode];ambiguous.add(key);}else values[value.unicode]=value.width;
  }
 }
 return result;
}
const prose=(value:string)=>/[A-Za-z]{4,}|[\p{Script=Han}]{2}/u.test(value);
const mathCharacters=/^[\p{Script=Latin}\p{Script=Greek}\p{N}\s=+−\-*/×÷<>≤≥≈≠∝∼~^ˆ˙†‡∗ℏℓ∂∇∞∑∏∫√|()[\]{}⟨⟩ϵ.,:;]+$/u;
const mathLetters=(value:string)=>!/[A-Za-z]{4,}/.test(value)&&mathCharacters.test(value);

export function findInlineFormulaSpans(page:InlineFormulaPage):InlineFormulaSpan[]{
 if(page.supported===false||/\{v\d+\}/.test(page.text))return [];
 const weights=new Map<string,number>(),bodySizes=new Map<number,number>();
 for(const item of page.items)if(item.fontName&&item.height&&prose(item.str||'')){
  weights.set(item.fontName,(weights.get(item.fontName)||0)+(item.str?.length||0));const size=Math.round(item.height*10)/10;bodySizes.set(size,(bodySizes.get(size)||0)+(item.str?.length||0));
 }
 const bodyFont=[...weights].sort((a,b)=>b[1]-a[1])[0]?.[0],bodySize=[...bodySizes].sort((a,b)=>b[1]-a[1])[0]?.[0];
 if(!bodyFont||!bodySize)return [];
 const proseFonts=new Set([...weights].filter(([,weight])=>weight>=12).map(([font])=>font));
 const tokens:Token[]=[];let cursor=0;
 for(const item of page.items){
  const text=item.str?.split('\u0000').join('').trim();if(!text||!item.transform||!item.width||!item.height)continue;
  const start=page.text.indexOf(text,cursor);if(start<0)continue;cursor=start+text.length;
  const size=Math.abs(item.height),baseline=page.height-item.transform[5],x=item.transform[4],font=item.fontName||'',style=page.styles?.[font];
  if(![size,baseline,x,item.width].every(Number.isFinite)||size<=0)continue;
  const specialFont=font!==bodyFont&&!proseFonts.has(font),strong=specialFont&&mathLetters(text)&&/[\p{L}]/u.test(text)||/[\p{Script=Greek}ℏ∂∇∑∏∫√]/u.test(text);
  const fullMath=mathLetters(text)&&(strong||/^[\d\s=+−\-*/×÷<>≤≥≈≠∝∼~^ˆ˙†‡∗|()[\]{}⟨⟩.,:;]+$/u.test(text));
  let ranges:{begin:number;end:number;math:boolean;strong:boolean}[]=[{begin:0,end:text.length,math:fullMath,strong}];
  // Formula punctuation often shares a PDF text item with the following word,
  // or an accent with the preceding word. Split only with real glyph advances.
  if(!fullMath){
   const leading=(/^[)\]⟩}]+/.exec(text)?.[0]||/^\d+(?:[.,]\d+)*(?:\(\d+\))?(?=\s|[.,;:]|$)/.exec(text)?.[0]||'').length,trailing=/[ˆ˙]+$/.exec(text)?.[0].length||0;
   if(leading||trailing){ranges=[];if(leading)ranges.push({begin:0,end:leading,math:true,strong:false});if(text.length-trailing>leading)ranges.push({begin:leading,end:text.length-trailing,math:false,strong:false});if(trailing)ranges.push({begin:text.length-trailing,end:text.length,math:true,strong:false});}
  }
  const widths=page.glyphWidths?.[font],characters=Array.from(text),known=characters.map(c=>widths?.[c]);
  const spaces=characters.filter(c=>/\s/.test(c)).length,knownWidth=known.reduce<number>((a,b)=>a+(b||0),0)*size/1000;
  const spaceWidth=spaces?(item.width-knownWidth)/spaces:0;
  const measurable=!!widths&&characters.every((c,i)=>!!known[i]||/\s/.test(c))&&spaceWidth>=0&&(!spaces?Math.abs(knownWidth-item.width)<=Math.max(.5,item.width*.02):true);
  // PDF.js inserts spaces for positioning gaps. Their residual is used only
  // inside prose; the bracket/accent boundary uses real prefix/suffix widths.
  if(ranges.length>1&&!measurable)ranges=[{begin:0,end:text.length,math:false,strong:false}];
  const offset=(n:number)=>n===0?0:n===text.length?item.width!:measurable?characters.slice(0,n).reduce((a,c)=>a+(widths![c]?widths![c]*size/1000:spaceWidth),0):0;
  for(const range of ranges){
   const value=text.slice(range.begin,range.end),trim=value.trim();if(!trim)continue;
   const begin=range.begin+value.indexOf(trim),end=begin+trim.length;
   tokens.push({text:trim,start:start+begin,end:start+end,x:x+offset(begin),right:x+offset(end),baseline,size,
    top:baseline-size*Math.max(.5,style?.ascent??.8),bottom:baseline+size*Math.max(.18,Math.abs(style?.descent??.2)),math:range.math,strong:range.strong});
  }
 }
 const candidates:Token[][]=[];let group:Token[]=[];
 const flush=()=>{if(group.length)candidates.push(group);group=[];};
 for(const token of tokens){
  if(!token.math){flush();continue;}
  const last=group.at(-1);
  if(last&&(token.x<Math.min(...group.map(v=>v.x))-bodySize*.5||token.x-last.right>bodySize*.9||Math.abs(token.baseline-group[0].baseline)>bodySize*.85))flush();
  group.push(token);
 }flush();
 const spans:InlineFormulaSpan[]=[];
 for(const candidate of candidates){
  const tail=candidate.at(-1);
  if(tail?.text==='.'&&tokens.some(token=>!token.math&&token.start>=tail.end&&!page.text.slice(tail.end,token.start).trim()&&/^\d/.test(token.text)&&Math.abs(token.baseline-tail.baseline)<bodySize*.3&&token.x-tail.right<bodySize*.3))continue;
  while(candidate.length&&/^[.,:;]+$/.test(candidate[0].text))candidate.shift();while(candidate.length&&/^[.,:;]+$/.test(candidate.at(-1)!.text))candidate.pop();
  if(!candidate.length||!candidate.some(token=>token.strong))continue;
  const start=candidate[0].start,end=candidate.at(-1)!.end,text=page.text.slice(start,end);
  const bases=candidate.filter(token=>Math.abs(token.size-bodySize)<bodySize*.2),baseline=bases[0]?.baseline??candidate[0].baseline;
  const x=Math.min(...candidate.map(v=>v.x)),right=Math.max(...candidate.map(v=>v.right)),top=Math.min(...candidate.map(v=>v.top)),bottom=Math.max(...candidate.map(v=>v.bottom));
  if(end-start>180||right-x>page.width*.44||bottom-top>bodySize*2.1)continue;
  const adjacent=(token:Token)=>token.end<=start&&start-token.end<=12&&!page.text.slice(token.end,start).trim()||token.start>=end&&token.start-end<=12&&!page.text.slice(end,token.start).trim();
  const neighbours=tokens.filter(token=>!token.math&&adjacent(token)&&Math.abs(token.baseline-baseline)<bodySize*.3&&((token.right<=x+1&&x-token.right<bodySize*2)||(token.x>=right-1&&token.x-right<bodySize*2))&&(prose(token.text)||/^(?:and|is|to|of|at|in|on|as|by|an|or|a|the)\b/i.test(token.text)));
  if(!neighbours.length)continue; // display equations never receive inline markers
  // Avoid stealing prose, citations, or unmatched delimiters from an expression.
  const compact=text.replace(/\s/g,'');
  if(/^\[\d+\]$/.test(compact)||/^[=+−×÷≈<>≤≥.,:;]/.test(compact)||/[=+−×÷≈<>≤≥]$/.test(compact))continue;
  if(tokens.some(token=>!token.math&&adjacent(token)&&token.start>=end&&Math.abs(token.baseline-baseline)<bodySize*.3&&token.x-right<bodySize*.6&&/^[=+−×÷≈<>≤≥.]|^\d/.test(token.text)&&!(token.text.startsWith('.')&&/\d\s*\.\s*\d$/.test(text))))continue;
  // A subscript word that was not classified as math must not be left behind
  // while its base is converted into an image.
  if(tokens.some(token=>!token.math&&token.size<bodySize*.85&&Math.abs(token.baseline-baseline)>.5&&Math.abs(token.baseline-baseline)<bodySize*.85&&token.x>=right-.5&&token.x-right<bodySize*.6))continue;
  const brackets:{[key:string]:string}={'(':')','[':']','{':'}','⟨':'⟩'},stack:string[]=[];let invalid=false;
  for(const c of compact){if(brackets[c])stack.push(brackets[c]);else if(Object.values(brackets).includes(c)&&stack.pop()!==c){invalid=true;break;}}
  if(invalid||stack.length)continue;
  let left=x-.7,edge=right+.7;const upper=top-.8,lower=bottom+.8;
  const outside=tokens.filter(token=>token.end<=start||token.start>=end);
  for(const token of outside)if(token.bottom>upper&&token.top<lower){if(token.right<=x+1)left=Math.max(left,(token.right+x)/2);if(token.x>=right-1)edge=Math.min(edge,(right+token.x)/2);}
  if(left>x+.1||edge<right-.1||left<0||upper<0||edge>page.width||lower>page.height)continue;
  const marker=`{v${page.page*10000+spans.length+1}}`;
  spans.push({start,end,contextStart:Math.min(start,...neighbours.map(v=>v.start)),contextEnd:Math.max(end,...neighbours.map(v=>v.end)),formula:{marker,text,rect:{x:left/page.width*100,y:upper/page.height*100,width:(edge-left)/page.width*100,height:(lower-upper)/page.height*100},baseline:baseline/page.height*100,fontSize:neighbours.sort((a,b)=>Math.abs(a.size-bodySize)-Math.abs(b.size-bodySize))[0].size}});
 }
 return spans;
}

async function hash(value:unknown){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));return [...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join('');}
export async function prepareInlineFormulaPages(pages:InlineFormulaPage[]):Promise<InlineFormulaPlan>{
 const units:TranslationUnit[]=[],legacyUnits=translationUnits(pages),legacyPartIds:Record<string,string[]>={};
 for(const page of pages){
  const legacy=legacyUnits.filter(u=>u.page===page.page).flatMap(u=>u.parts||[]);let offset=0;
  const legacyRanges=legacy.map(part=>{const found=page.text.indexOf(part.text,offset),start=found<0?offset:found;offset=start+part.text.length;return{part,start,end:offset};});
  const spans=findInlineFormulaSpans(page),paragraphs=page.paragraphs.length?page.paragraphs:[{start:0,end:page.text.length,rects:[]}];
  const groupEnd=paragraphs.map((_,i)=>i);
  for(const span of spans){const covered=paragraphs.flatMap((p,i)=>p.end>span.contextStart&&p.start<span.contextEnd?[i]:[]);if(covered.length)for(let i=covered[0];i<=covered.at(-1)!;i++)groupEnd[i]=Math.max(groupEnd[i],covered.at(-1)!);}
  const prepared:{text:string;rects:SourceRect[];formulas:TranslationInlineFormula[];legacyIds:string[]}[]=[];
  for(let i=0;i<paragraphs.length;){let last=groupEnd[i];for(let j=i;j<=last;j++)last=Math.max(last,groupEnd[j]);
   const start=paragraphs[i].start,end=paragraphs[last].end,inside=spans.filter(span=>span.start>=start&&span.end<=end);let text=page.text.slice(start,end);
   for(const span of inside.toReversed())text=text.slice(0,span.start-start)+span.formula.marker+text.slice(span.end-start);
   const rects=paragraphs.slice(i,last+1).flatMap(p=>p.rects),legacyIds=legacyRanges.filter(p=>p.end>start&&p.start<end).map(p=>p.part.id);
   if(text.trim())prepared.push({text,rects,formulas:inside.map(span=>span.formula),legacyIds});i=last+1;
  }
  let unitParts:TranslationPart[]=[],length=0,index=0;
  const flush=()=>{if(unitParts.length){units.push({id:`${page.page}:${index++}`,page:page.page,text:unitParts.map(part=>part.text).join(''),parts:unitParts,inlineMathVersion:1});unitParts=[];length=0;}};
  for(const group of prepared){
   let rest=group.text;
   while(rest){if(length+rest.length>4500&&unitParts.length)flush();let end=Math.min(4500,rest.length);
    const markerStart=rest.lastIndexOf('{v',end-1),markerEnd=markerStart>=0?rest.indexOf('}',markerStart):-1;if(markerStart>=0&&markerStart<end&&markerEnd>=end)end=markerStart;
    const text=rest.slice(0,end);rest=rest.slice(end);if(!text.trim())continue;
    const formulas=group.formulas.filter(formula=>text.includes(formula.marker)),id=`${page.page}:${index}:${unitParts.length}`;
    const part:TranslationPart={id,text,rects:group.rects,sourceHash:await hash([1,page.page,text,group.rects,formulas]),...(formulas.length?{inlineFormulas:formulas}:{})};
    unitParts.push(part);legacyPartIds[id]=group.legacyIds;length+=text.length;if(rest)flush();
   }
  }flush();
 }
 return {units,legacyUnits,legacyPartIds,totalPages:pages.length,emptyPages:pages.filter(page=>!page.text.trim()).map(page=>page.page)};
}
