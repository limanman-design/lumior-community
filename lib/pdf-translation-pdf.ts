/* oxlint-disable eslint/no-control-regex -- Remove non-rendering PDF control characters explicitly. */
/* oxlint-disable typescript/no-misused-spread -- Glyph coverage intentionally checks Unicode code points. */
import {PDFDocument,rgb,type PDFFont} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type {SourceRect} from './pdf-paragraphs';
import type {PdfTranslation} from './pdf-translation.ts';

export function wrapPdfText(text:string,font:Pick<PDFFont,'widthOfTextAtSize'>,size:number,width:number){
 const lines:string[]=[];let line='',lineWidth=0;
 const widths=new Map<string,number>();
 for(const character of text){
  if(character==='\n'){lines.push(line);line='';lineWidth=0;continue;}
  const characterWidth=widths.get(character)??font.widthOfTextAtSize(character,size);widths.set(character,characterWidth);
  if(line&&lineWidth+characterWidth>width){lines.push(line);line=character;lineWidth=characterWidth;}else{line+=character;lineWidth+=characterWidth;}
 }
 if(line)lines.push(line);return lines;
}
export type TranslationPageLayout={source:number;rects:{id:string;rect:SourceRect}[];columns?:1|2;height?:number};
type TextRun={id:string;text:string};
type ReflowPart=TextRun&{rects?:SourceRect[]};
type TextLine={text:string;segments:{id:string;x:number;width:number}[];advance:number};

const listLine=/^\s*(?:[•●▪◦*\-–]|\d+[.)、]|[（(]\d+[）)])\s*/u;
function textSeparator(before:string,after:string){
 return /[\p{Script=Han}]$/u.test(before)||/^[\p{Script=Han}，。！？；：、）】]/u.test(after)?'':' ';
}
/** PDF line endings are soft wraps; blank lines and lists remain paragraph breaks. */
function reflowText(text:string){
 return text.split(/\n{2,}/).map(paragraph=>{
  const lines=paragraph.split('\n').map(line=>line.trim());let result=lines[0]||'';
  for(let i=1;i<lines.length;i++)result+=(listLine.test(lines[i])||listLine.test(lines[i-1])?'\n':textSeparator(result,lines[i]))+lines[i];
  return result;
 }).join('\n\n');
}
function adjacentSourceLines(before:ReflowPart,after:ReflowPart){
 const a=before.rects?.at(-1),b=after.rects?.[0];if(!a||!b)return false;
 const h=Math.max(a.height,b.height),gap=b.y-a.y-a.height;
 return Number.isFinite(h)&&h>0&&Math.abs(a.height-b.height)<=h*.25&&gap>=-h*.35&&gap<=h*.55&&Math.abs(a.x-b.x)<=Math.max(2,h*1.5)&&!listLine.test(before.text)&&!listLine.test(after.text)&&!before.text.includes('\n\n')&&!after.text.includes('\n\n');
}
function paragraphRuns(parts:ReflowPart[]){
 const blocks:TextRun[][]=[];let previous:ReflowPart|undefined;
 for(const part of parts){
  const text=reflowText(part.text),last=blocks.at(-1);
  if(last&&previous&&adjacentSourceLines(previous,part)){
   last.push({id:part.id,text:textSeparator(last.at(-1)!.text,text)+text});
  }else blocks.push([{id:part.id,text}]);
  previous=part;
 }
 return blocks;
}
/** Retain each source ID even when several short source fragments share a line. */
function wrapRuns(runs:TextRun[],font:PDFFont,size:number,width:number):TextLine[]{
 type Glyph={id:string;character:string;width:number};
 const lines:TextLine[]=[];let glyphs:Glyph[]=[],lineWidth=0;
 const widths=new Map<string,number>();
 const closing=/^[，。！？；：、）】》〉〕”’.,!?;:)%]$/u,opening=/^[（【《〈〔“‘(]$/u;
 const flush=()=>{
  const segments:TextLine['segments']=[];let x=0;
  for(const glyph of glyphs){const previous=segments.at(-1);if(previous?.id===glyph.id)previous.width+=glyph.width;else segments.push({id:glyph.id,x,width:glyph.width});x+=glyph.width;}
  const text=glyphs.map(glyph=>glyph.character).join('');lines.push({text,segments,advance:text?17:9});glyphs=[];lineWidth=0;
 };
 for(const run of runs)for(const character of run.text){
  if(character==='\n'){flush();continue;}
  const characterWidth=widths.get(character)??font.widthOfTextAtSize(character,size);widths.set(character,characterWidth);
  if(glyphs.length&&lineWidth+characterWidth>width){
   const carry:Glyph[]=[];
   if(closing.test(character))do{carry.unshift(glyphs.pop()!);}while(glyphs.length&&closing.test(carry[0].character));
   else while(glyphs.length&&opening.test(glyphs.at(-1)!.character))carry.unshift(glyphs.pop()!);
   if(glyphs.length)flush();else lineWidth=0;
   glyphs=carry;lineWidth=carry.reduce((sum,glyph)=>sum+glyph.width,0);
  }
  glyphs.push({id:run.id,character,width:characterWidth});lineWidth+=characterWidth;
 }
 if(glyphs.length)flush();if(lines.length)lines.at(-1)!.advance+=8;return lines;
}
function balancedColumns(lines:TextLine[]){
 const total=lines.reduce((sum,line)=>sum+line.advance,0);let consumed=0,best=0,difference=Infinity;
 for(let i=0;i<lines.length;i++){
  consumed+=lines[i].advance;const next=Math.abs(total-consumed*2);
  if(next<difference){best=i+1;difference=next;}
 }
 return [lines.slice(0,best),lines.slice(best)];
}
export async function buildTranslationPdf(title:string,translation:PdfTranslation,fontBytes:Uint8Array,preview=false){
 if(!preview&&(!translation.complete||!translation.units.length))throw new Error('请完成翻译后再导出 PDF。');
 const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);
 const font=await pdf.embedFont(fontBytes,{subset:true});
 const supported=new Set(font.getCharacterSet());
 const clean=(text:string)=>{
  const value=text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u200B\uFEFF]/g,'').replace(/\t/g,'    ');
  const missing=[...value].filter(c=>c!=='\n'&&c!=='\r'&&!supported.has(c.codePointAt(0)!));
  if(missing.length)throw new Error(`导出字体暂不支持这些字符：${[...new Set(missing)].slice(0,8).join(' ')}。译文已保留。`);
  return value.replace(/\r\n?/g,'\n');
 };
 const width=595.28,standardHeight=841.89,margin=42,contentWidth=width-margin*2,gutter=22,size=11;
 const pages:TranslationPageLayout[]=[];
 for(let source=1;source<=translation.totalPages;source++){
  const parts:ReflowPart[]=translation.units.filter(unit=>unit.page===source).flatMap(unit=>unit.parts?.length?unit.parts:[{id:unit.id,text:unit.text}]).map(part=>({...part,text:clean(part.text)}));
  if(!parts.length)parts.push({id:`pending:${source}`,text:translation.emptyPages.includes(source)?'本页未提取到可翻译文字，请查看原 PDF。':'本页译文尚未完成。'});
  const columns:1|2=parts.reduce((sum,part)=>sum+part.text.length,0)>=500?2:1;
  const columnWidth=(contentWidth-(columns-1)*gutter)/columns;
  const lines=paragraphRuns(parts).flatMap(runs=>wrapRuns(runs,font,size,columnWidth));
  const flowed=columns===2?balancedColumns(lines):[lines];
  const headingSize=source===1?17:13,heading=source===1?`${title} · 中文译文`:`原文第 ${source} 页`;
  const headingLines=wrapPdfText(clean(heading),font,headingSize,contentWidth);
  const contentTop=margin+28+headingLines.length*25+17;
  const contentHeight=Math.max(...flowed.map(column=>column.reduce((sum,line)=>sum+line.advance,0)),0);
  // A long source page gets a taller sheet, never another source page's slot.
  const height=Math.max(standardHeight,contentTop+contentHeight+margin+44);
  if(height>14_400)throw new Error(`原文第 ${source} 页的译文过长，无法在一张可阅读的 PDF 页面内展示。译文已保留。`);
  const page=pdf.addPage([width,height]),layout:TranslationPageLayout={source,rects:[],columns,height};pages.push(layout);
  let y=height-margin;
  page.drawText('LUMIOR',{x:margin,y,size:9,font,color:rgb(.36,.37,.44)});y-=28;
  for(const line of headingLines){page.drawText(line,{x:margin,y,size:headingSize,font,color:rgb(.12,.13,.18)});y-=25;}
  page.drawLine({start:{x:margin,y:y+5},end:{x:width-margin,y:y+5},thickness:.5,color:rgb(.84,.84,.87)});
  flowed.forEach((column,index)=>{
   let baseline=height-contentTop;const x=margin+index*(columnWidth+gutter);
   for(const line of column){
    if(line.text){
     page.drawText(line.text,{x,y:baseline,size,font,color:rgb(.16,.17,.2)});
     for(const segment of line.segments)if(segment.width>0)layout.rects.push({id:segment.id,rect:{x:(x+segment.x)/width*100,y:(height-baseline-size)/height*100,width:segment.width/width*100,height:14/height*100}});
    }
    baseline-=line.advance;
   }
  });
  page.drawLine({start:{x:margin,y:margin+17},end:{x:width-margin,y:margin+17},thickness:.5,color:rgb(.86,.86,.89)});
  page.drawText(`AI 中文译文 · 原文第 ${source} 页`,{x:margin,y:margin,size:8,font,color:rgb(.45,.46,.5)});
  const number=`${source} / ${translation.totalPages}`;page.drawText(number,{x:width-margin-font.widthOfTextAtSize(number,8),y:margin,size:8,font,color:rgb(.45,.46,.5)});
  page.drawText('基于可提取文字；图表图片与复杂公式请对照原文。',{x:margin,y:margin-14,size:7,font,color:rgb(.55,.56,.6)});
 }
 pdf.setTitle(`${title} · 中文译文`);pdf.setAuthor('Lumior');pdf.setSubject(`AI translation (${translation.sourceLanguage} to zh-CN), ${translation.model}`);pdf.setCreator('Lumior PDF Translation');
 return {bytes:await pdf.save(),pages};
}

export async function createTranslationPdf(title:string,translation:PdfTranslation,fontBytes:Uint8Array){return (await buildTranslationPdf(title,translation,fontBytes)).bytes;}
