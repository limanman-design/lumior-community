/* oxlint-disable eslint/no-control-regex -- Remove non-rendering PDF control characters explicitly. */
/* oxlint-disable typescript/no-misused-spread -- Glyph coverage intentionally checks Unicode code points. */
import {PDFDocument,rgb,degrees,pushGraphicsState,popGraphicsState,setLineWidth,setTextRenderingMode,TextRenderingMode,setStrokingColor,type PDFFont,type PDFImage} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type {SourceRect} from './pdf-paragraphs';
import type {PdfTranslation} from './pdf-translation.ts';
import {translationStructure,type ReflowBlock,type ReflowPart,type ReflowRun} from './pdf-translation-structure.ts';
import type {PdfFormulaRegion} from './pdf-formula-regions.ts';

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
export type TranslationPageSize={width:number;height:number};
export type TranslationPageLayout={source:number;rects:{id:string;rect:SourceRect}[];columns?:1|2;width?:number;height?:number};
export type TranslationFormulaImage=PdfFormulaRegion&{png:Uint8Array;width:number;height:number;inline?:{marker:string;baseline:number;fontSize:number}};
type InlineImage={embedded:PDFImage;width:number;height:number;baseline:number};
type EmbeddedFormula={embedded:PDFImage;source:TranslationFormulaImage};
type InlineLookup=Map<string,Map<string,EmbeddedFormula>>;
type TextSegment=ReflowRun&{x:number;width:number;inlineImage?:InlineImage};
type TextLine={text:string;segments:TextSegment[];advance:number;size:number;indent:number;before?:number;descent?:number;quote?:boolean;keepWithNext?:boolean;breakPenalty?:number;image?:{embedded:PDFImage;width:number;height:number;ids:string[]}};
type Typography={scale:number;compact:number};
type ReflowSection={columns:TextLine[][];columnWidth:number};
function scaleLine(line:TextLine,scale:number):TextLine{
 return {...line,size:line.size*scale,advance:line.advance*scale,indent:line.indent*scale,
  ...(line.before!==undefined?{before:line.before*scale}:{}),...(line.descent!==undefined?{descent:line.descent*scale}:{}),
  segments:line.segments.map(segment=>({...segment,x:segment.x*scale,width:segment.width*scale,
   ...(segment.inlineImage?{inlineImage:{...segment.inlineImage,width:segment.inlineImage.width*scale,height:segment.inlineImage.height*scale,baseline:segment.inlineImage.baseline*scale}}:{})})),
  ...(line.image?{image:{...line.image,width:line.image.width*scale,height:line.image.height*scale}}:{})};
}

/** Keep each source ID through wrapping, including inline math and Markdown emphasis. */
function wrapBlock(block:ReflowBlock,font:PDFFont,width:number,{scale,compact}:Typography,inlineImages:InlineLookup):TextLine[]{
 const size=(block.kind==='heading'?(block.level===1?16:block.level===2?12.5:11.5):block.metadata?9.5:11)*scale;
 const indent=block.kind==='list'?Math.min(36,(block.level||0)*10)*scale+font.widthOfTextAtSize((block.marker||'•')+' ',size):block.kind==='quote'?12*scale:block.kind==='code'?8*scale:0;
 const available=Math.max(size,width-indent-2*scale),lineHeight=size*(1.5-.24*compact);
 type Glyph=ReflowRun&{character:string;width:number;inlineImage?:InlineImage};
 const lines:TextLine[]=[];let glyphs:Glyph[]=[],lineWidth=0;
 const widths=new Map<string,number>();
 const closing=/^[，。！？；：、）】》〉〕⟩⟧”’.,!?;:)%\]]$/u,opening=/^[（【《〈〔⟨⟦“‘([]$/u;
 const flush=()=>{
  const segments:TextSegment[]=[];let x=0;
  for(const glyph of glyphs){
   const previous=segments.at(-1);
   if(!glyph.inlineImage&&!previous?.inlineImage&&previous?.id===glyph.id&&previous.bold===glyph.bold&&previous.italic===glyph.italic&&previous.code===glyph.code){previous.width+=glyph.width;previous.text+=glyph.character;}
   else segments.push({id:glyph.id,text:glyph.inlineImage?'':glyph.character,x,width:glyph.width,bold:glyph.bold,italic:glyph.italic,code:glyph.code,inlineImage:glyph.inlineImage});
   x+=glyph.width;
  }
  const offset=block.centered?Math.max(0,(available-x)/2):0;
  for(const segment of segments)segment.x+=offset;
  const text=glyphs.map(glyph=>glyph.character).join('');
  const images=segments.flatMap(segment=>segment.inlineImage?[segment.inlineImage]:[]);
  const ascent=Math.max(size,...images.map(image=>image.baseline)),descent=Math.max(size*.3,...images.map(image=>image.height-image.baseline));
  const before=ascent-size;
  lines.push({text,segments,advance:before+(images.length?Math.max(lineHeight,size+descent+size*.12):text?lineHeight:lineHeight*.55),size,indent,quote:block.kind==='quote',...(images.length?{before,descent}:{})});glyphs=[];lineWidth=0;
 };
 const append=(run:ReflowRun,character:string,inlineImage?:InlineImage)=>{
  if(character==='\n'){flush();return;}
  const characterWidth=inlineImage?.width??widths.get(character)??font.widthOfTextAtSize(character,size);if(!inlineImage)widths.set(character,characterWidth);
  if(glyphs.length&&lineWidth+characterWidth>available){
   const carry:Glyph[]=[];
   if(closing.test(character))do{carry.unshift(glyphs.pop()!);}while(glyphs.length&&closing.test(carry[0].character));
   else if(/[A-Za-z]/.test(character)&&/[A-Za-z]$/.test(glyphs.at(-1)!.character)){
    const boundary=glyphs.findLastIndex(glyph=>glyph.character===' ');
    if(boundary>=glyphs.length*.4)carry.push(...glyphs.splice(boundary+1));
   }else while(glyphs.length&&opening.test(glyphs.at(-1)!.character))carry.unshift(glyphs.pop()!);
   if(glyphs.length)flush();else lineWidth=0;
   glyphs=carry;lineWidth=carry.reduce((sum,glyph)=>sum+glyph.width,0);
  }
  glyphs.push({...run,bold:run.bold||block.kind==='heading',character,width:characterWidth,inlineImage});lineWidth+=characterWidth;
 };
 for(const run of block.runs){
  const images=inlineImages.get(run.id);let end=0;
  for(const match of run.text.matchAll(/\{v\d+\}/g)){
   const value=images?.get(match[0]);if(!value)continue;
   for(const character of run.text.slice(end,match.index))append(run,character);
   const factor=size/value.source.inline!.fontSize;
   append(run,'\uFFFC',{embedded:value.embedded,width:value.source.width*factor,height:value.source.height*factor,baseline:value.source.inline!.baseline*factor});
   end=match.index!+match[0].length;
  }
  for(const character of run.text.slice(end))append(run,character);
 }
 if(glyphs.length)flush();
 if(block.kind==='list'&&lines.length){const text=block.marker||'•';lines[0].segments.unshift({id:block.runs[0].id,text,x:-font.widthOfTextAtSize(text+' ',size),width:font.widthOfTextAtSize(text,size)});}
 if(lines.length)lines.at(-1)!.advance+=(block.kind==='heading'?11:block.metadata?6:block.kind==='list'?4:8)*scale*(1-.55*compact);
 // Reserve the image's real ascent/descender space on both sides of a line;
 // tall inline fractions must not collide with preceding or following prose.
 for(let i=0;i<lines.length-1;i++)if(lines[i].descent!==undefined||lines[i+1].descent!==undefined)
  lines[i].advance=Math.max(lines[i].advance,(lines[i].before||0)+(lines[i].descent??lines[i].size*.3)+lines[i+1].size+size*.12);
 // Headings must stay with following content. Prefer keeping two paragraph
 // lines together, but allow short references to split when balance needs it.
 lines.forEach((line,index)=>{line.keepWithNext=block.kind==='heading';line.breakPenalty=lines.length>1&&(index===0||index===lines.length-2)?8*scale:0;});
 return lines;
}
const lineBottom=(line:TextLine)=>line.image?line.image.height-line.size:(line.before||0)+(line.descent??line.size*.3);
function columnDepth(lines:TextLine[]){return lines.length?lines.slice(0,-1).reduce((sum,line)=>sum+line.advance,0)+lineBottom(lines.at(-1)!):0;}
function balancedColumns(lines:TextLine[]){
 const total=columnDepth(lines);let consumed=0,best=lines.length,difference=Infinity;
 for(let i=0;i<lines.length-1;i++){
  const left=consumed+lineBottom(lines[i]);consumed+=lines[i].advance;
  if(lines[i].keepWithNext)continue;
  const next=Math.abs(left-(total-consumed))+(lines[i].breakPenalty||0);
  if(next<difference){best=i+1;difference=next;}
 }
 const columns=[lines.slice(0,best),lines.slice(best)],depths=columns.map(columnDepth);
 if(columns.every(column=>column.length)){
  const shorter=depths[0]<depths[1]?0:1,column=columns[shorter],gap=Math.abs(depths[0]-depths[1]);
  // Align visible bottoms with a small spacing adjustment only. Sparse content
  // or a tall, indivisible equation must never produce stretched paragraphs.
  const maxExtra=Math.min(...column.map(line=>line.size/4));
  if(column.length>1&&gap<=(column.length-1)*maxExtra){
   const extra=gap/(column.length-1);
   columns[shorter]=column.map((line,index)=>index<column.length-1?{...line,advance:line.advance+extra}:line);
  }else{
   const taller=1-shorter,longColumn=columns[taller],expansion=(column.length-1)*maxExtra;
   // A short final page may need both sides adjusted: allow only a tenth of
   // the font size to be removed from each tall-column gap, retaining legibility.
   const reduction=(longColumn.length-1)*Math.min(...longColumn.map(line=>line.size/10));
   if(column.length>1&&longColumn.length>1&&gap<=expansion+reduction){
    const ratio=gap/(expansion+reduction);
    columns[shorter]=column.map((line,index)=>index<column.length-1?{...line,advance:line.advance+maxExtra*ratio}:line);
    columns[taller]=longColumn.map((line,index)=>index<longColumn.length-1?{...line,advance:line.advance-reduction*ratio/(longColumn.length-1)}:line);
   }
  }
 }
 return columns;
}
const sectionHeight=(section:ReflowSection)=>Math.max(...section.columns.map(column=>column.reduce((sum,line)=>sum+line.advance,0)),0);
const sectionsHeight=(sections:ReflowSection[])=>sections.reduce((sum,section)=>sum+sectionHeight(section),0);

export async function buildTranslationPdf(title:string,translation:PdfTranslation,fontBytes:Uint8Array,preview=false,formulas:TranslationFormulaImage[]=[],sourcePageSizes:TranslationPageSize[]=[]){
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
 if(sourcePageSizes.length&&(sourcePageSizes.length!==translation.totalPages||Array.from(sourcePageSizes).some(size=>!size||![size.width,size.height].every(value=>Number.isFinite(value)&&value>0))))throw new Error('原 PDF 页面尺寸不完整，无法保持原文与译文逐页对齐。');
 const images=new Map<string,EmbeddedFormula>(),inlineImages:InlineLookup=new Map();
 const expectedInline=new Map<string,{page:number;markers:Set<string>}>();
 for(const unit of translation.units)for(const part of unit.parts||[])if(part.inlineFormulas?.length){
  if(expectedInline.has(part.id))throw new Error('行内公式段落重复，译文已保留，请重新打开。');
  const markers=new Set(part.inlineFormulas.map(formula=>formula.marker));
  const actual=[...part.text.matchAll(/\{v\d+\}/g)].map(match=>match[0]);
  if(markers.size!==part.inlineFormulas.length||[...markers].some(marker=>!/^\{v\d+\}$/.test(marker))||actual.length!==markers.size||actual.some(marker=>!markers.has(marker))||new Set(actual).size!==actual.length)
   throw new Error('行内公式标记未完整保留，译文已保留，请重新翻译本段。');
  expectedInline.set(part.id,{page:unit.page,markers});
 }
 for(const source of formulas){
  if(!Number.isFinite(source.width)||!Number.isFinite(source.height)||source.width<=0||source.height<=0)throw new Error('原文公式图片尺寸无效，译文已保留，请重新打开。');
  if(images.has(source.id))throw new Error('原文公式图片重复，译文已保留，请重新打开。');
  const value={source,embedded:await pdf.embedPng(source.png)};images.set(source.id,value);
  if(source.inline){
   const {marker,baseline,fontSize}=source.inline,expected=expectedInline.get(source.partIds[0]);
   if(source.partIds.length!==1||expected?.page!==source.page||!expected.markers.has(marker)||!Number.isFinite(baseline)||baseline<0||baseline>source.height||!Number.isFinite(fontSize)||fontSize<=0)
    throw new Error('行内公式图片与译文段落不匹配，译文已保留，请重新打开。');
   const partImages=inlineImages.get(source.partIds[0])||new Map<string,EmbeddedFormula>();
   if(partImages.has(marker))throw new Error('行内公式图片重复，译文已保留，请重新打开。');
   partImages.set(marker,value);inlineImages.set(source.partIds[0],partImages);
  }
 }
 for(const [id,{markers}] of expectedInline)if([...markers].some(marker=>!inlineImages.get(id)?.has(marker)))throw new Error('行内公式图片尚未准备完成，译文已保留，请重新打开。');
 const pages:TranslationPageLayout[]=[];
 for(let source=1;source<=translation.totalPages;source++){
  const {width,height}=sourcePageSizes[source-1]||{width:595.28,height:841.89};
  const margin=Math.min(42,width*.07,height*.07),contentWidth=width-margin*2,gutter=Math.min(22,contentWidth*.05);
  const parts:ReflowPart[]=translation.units.filter(unit=>unit.page===source).flatMap(unit=>unit.parts?.length?unit.parts:[{id:unit.id,text:unit.text}]);
  if(!parts.length)parts.push({id:`pending:${source}`,text:translation.emptyPages.includes(source)?'本页未提取到可翻译文字，请查看原 PDF。':'本页译文尚未完成。'});
  const structure=translationStructure(parts,source,formulas.filter(formula=>!formula.inline)),columns=structure.columns;
  for(const [id,{page,markers}] of expectedInline)if(page===source){
   const runs=structure.sections.flatMap(section=>section.columns.flatMap(blocks=>blocks.flatMap(block=>block.runs))).filter(run=>run.id===id);
   const rendered=runs.flatMap(run=>[...run.text.matchAll(/\{v\d+\}/g)].map(match=>match[0]));
   if(rendered.length!==markers.size||[...markers].some(marker=>rendered.filter(value=>value===marker).length!==1))throw new Error('行内公式标记无法排版，译文已保留，请重新翻译本段。');
  }
  const legacyColumns=structure.balanced;
  // Clean once; fitting may wrap the same text several times without changing
  // persisted translations, page membership or source IDs.
  for(const section of structure.sections)for(const blocks of section.columns)for(const block of blocks)if(!block.formula)block.runs=block.runs.map(run=>({...run,text:clean(run.text)}));
  const flow=({scale,compact}:Typography):ReflowSection[]=>structure.sections.map(section=>{
   const count=legacyColumns?2:section.columns.length,columnWidth=(contentWidth-(count-1)*gutter)/count;
   const flowed=section.columns.map(blocks=>blocks.flatMap((block,index)=>{
    if(block.formula){
     const image=images.get(block.formula.id);
     if(!image)throw new Error('原文公式图片尚未准备完成，译文已保留，请重试。');
     const displayedWidth=Math.min(columnWidth,image.source.width*1.15*scale),displayedHeight=displayedWidth*image.source.height/image.source.width;
     const line:TextLine={text:'',segments:[],advance:displayedHeight+18*scale*(1-.5*compact),size:11*scale,indent:(columnWidth-displayedWidth)/2,image:{embedded:image.embedded,width:displayedWidth,height:displayedHeight,ids:block.formula.partIds}};
     return [line];
    }
    const lines=wrapBlock(block,font,columnWidth,{scale,compact},inlineImages),next=blocks[index+1];
    if(lines.length&&block.kind==='heading'&&block.level===1&&next?.kind==='heading'&&next.level===1)lines.at(-1)!.advance-=11*scale*(1-.55*compact);
    return lines;
   }));
   // Source geometry still determines spanning sections and reading order;
   // translated text is rebalanced within each two-column section.
   return {columns:count===2?balancedColumns(flowed.flat()):flowed,columnWidth};
  });
  let scale=1,sections=flow({scale,compact:0});
  const fits=(candidate:ReflowSection[],size:number)=>sectionsHeight(candidate)+16*size<=height-margin*2&&candidate.every(section=>section.columns.every(column=>column.every(line=>line.segments.every(segment=>line.indent+segment.x>=0&&line.indent+segment.x+segment.width<=section.columnWidth+.001))));
  if(!fits(sections,scale)){
   sections=flow({scale,compact:1});
   if(fits(sections,scale)){
    // Use only as much whitespace compression as this page needs.
    let low=0,high=1;
    for(let i=0;i<7;i++){
     const compact=(low+high)/2,candidate=flow({scale,compact});
     if(fits(candidate,scale)){high=compact;sections=candidate;}else low=compact;
    }
   }else{
    // Rewrap at the largest fitting font size. Equations scale uniformly with
    // the text; no content is cropped, summarized, or sent to a second page.
    let high=1;
    do{scale/=2;sections=flow({scale,compact:1});}while(!fits(sections,scale)&&scale>1/1024);
    if(fits(sections,scale))for(let i=0;i<10;i++){
     const middle=(scale+high)/2,candidate=flow({scale:middle,compact:1});
     if(fits(candidate,middle)){scale=middle;sections=candidate;}else high=middle;
    }
   }
  }
  // A final uniform transform handles extreme geometry while keeping the
  // physical sheet exactly equal to the source, including image aspect ratios.
  const drawScale=Math.min(1,(height-margin*2)/(sectionsHeight(sections)+16*scale));
  if(drawScale<1)sections=sections.map(section=>({columnWidth:section.columnWidth*drawScale,columns:section.columns.map(column=>column.map(line=>scaleLine(line,drawScale)))}));
  const contentTop=margin+16*scale*drawScale,startX=margin+contentWidth*(1-drawScale)/2;
  const page=pdf.addPage([width,height]),layout:TranslationPageLayout={source,rects:[],columns,width,height};pages.push(layout);
  let sectionTop=contentTop;
  for(const section of sections){
   section.columns.forEach((column,index)=>{
    let baseline=height-sectionTop;const x=startX+index*(section.columnWidth+gutter*drawScale);
    for(const line of column){
     baseline-=line.before||0;
     if(line.image){
      const image=line.image,top=height-baseline-line.size;
      page.drawImage(image.embedded,{x:x+line.indent,y:height-top-image.height,width:image.width,height:image.height});
      for(const id of image.ids)layout.rects.push({id,rect:{x:(x+line.indent)/width*100,y:top/height*100,width:image.width/width*100,height:image.height/height*100}});
      baseline-=line.advance;
      continue;
     }
     if(line.quote)page.drawLine({start:{x:x+3,y:baseline-line.size*.3},end:{x:x+3,y:baseline+line.size},thickness:1,color:rgb(.55,.56,.6)});
     for(const segment of line.segments){
      const sx=x+line.indent+segment.x;
      if(segment.inlineImage){
       const image=segment.inlineImage,top=height-baseline-image.baseline;
       page.drawImage(image.embedded,{x:sx,y:height-top-image.height,width:image.width,height:image.height});
       layout.rects.push({id:segment.id,rect:{x:sx/width*100,y:top/height*100,width:image.width/width*100,height:image.height/height*100}});
       continue;
      }
      if(segment.code)page.drawRectangle({x:sx,y:baseline-line.size*.22,width:segment.width,height:line.size*1.25,color:rgb(.95,.95,.96)});
      page.pushOperators(pushGraphicsState());
      if(segment.bold)page.pushOperators(setLineWidth(.22),setStrokingColor(rgb(.16,.17,.2)),setTextRenderingMode(TextRenderingMode.FillAndOutline));
      page.drawText(segment.text,{x:sx,y:baseline,size:line.size,font,color:rgb(.16,.17,.2),...(segment.italic?{xSkew:degrees(10)}:{})});
      page.pushOperators(popGraphicsState());
      if(segment.width>0)layout.rects.push({id:segment.id,rect:{x:sx/width*100,y:(height-baseline-line.size)/height*100,width:segment.width/width*100,height:line.size*1.3/height*100}});
     }
     baseline-=line.advance-(line.before||0);
    }
   });
   sectionTop+=sectionHeight(section);
  }
 }
 pdf.setTitle(`${title} · 中文译文`);pdf.setAuthor('Lumior');pdf.setSubject(`AI translation (${translation.sourceLanguage} to zh-CN), ${translation.model}`);pdf.setCreator('Lumior PDF Translation');
 return {bytes:await pdf.save(),pages};
}

export async function createTranslationPdf(title:string,translation:PdfTranslation,fontBytes:Uint8Array,formulas:TranslationFormulaImage[]=[],sourcePageSizes:TranslationPageSize[]=[]){return (await buildTranslationPdf(title,translation,fontBytes,false,formulas,sourcePageSizes)).bytes;}
