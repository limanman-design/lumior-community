import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PDFDocument,PDFName,decodePDFRawStream} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {buildTranslationPdf,createTranslationPdf,wrapPdfText} from '../lib/pdf-translation-pdf.ts';

const translation={version:1,sourceKey:'fixture',target:'zh-CN',sourceLanguage:'英语',model:'test',units:[{id:'1:0',page:1,text:'基于 282 名用户的数据，模型解释了 64.1% 的变异。\n\n最后一段：未建立因果关系。'}],glossary:[],totalPages:1,emptyPages:[],complete:true,updatedAt:0};
async function exportedBodyLines(bytes){
 const pdf=await PDFDocument.load(bytes);
 return pdf.getPages().map(page=>{
  const fonts=page.node.Resources().lookup(PDFName.of('Font'));
  const font=fonts.lookup(fonts.keys()[0]);
  const unicode=new TextDecoder().decode(decodePDFRawStream(font.lookup(PDFName.of('ToUnicode'))).decode());
  const characters=new Map();
  for(const block of unicode.matchAll(/beginbfchar\s+([\s\S]*?)endbfchar/g))for(const match of block[1].matchAll(/<([0-9A-F]+)>\s*<([0-9A-F]+)>/g)){
   characters.set(match[1],match[2].match(/.{4}/g).map(value=>String.fromCharCode(Number.parseInt(value,16))).join(''));
  }
  const contents=page.node.Contents(),lines=[];
  for(let i=0;i<contents.size();i++){
   const stream=new TextDecoder().decode(decodePDFRawStream(contents.lookup(i)).decode());
   for(const block of stream.matchAll(/BT\s+([\s\S]*?)ET/g))if(/\s11 Tf\b/.test(block[1]))for(const match of block[1].matchAll(/<([0-9A-F]+)> Tj/g))lines.push(match[1].match(/.{4}/g).map(value=>characters.get(value)??'\uFFFD').join(''));
  }
  return lines;
 });
}
async function exportedBodyText(bytes){return (await exportedBodyLines(bytes)).map(lines=>lines.join(''));}
test('Chinese PDF export embeds valid subset outlines instead of silently losing letters and Han glyphs',async()=>{
 const fontBytes=new Uint8Array(await readFile(new URL('../public/assets/pdf-fonts/LumiorDocumentSans-Regular.ttf',import.meta.url)));
 const bytes=await createTranslationPdf('教育研究',translation,fontBytes);
 const pdf=await PDFDocument.load(bytes);
 assert.equal(pdf.getPageCount(),1);assert.ok(bytes.length<100_000);
 const fonts=pdf.getPage(0).node.Resources().lookup(PDFName.of('Font'));
 const outer=fonts.lookup(fonts.keys()[0]);
 const descendant=outer.lookup(PDFName.of('DescendantFonts')).lookup(0);
 const descriptor=descendant.lookup(PDFName.of('FontDescriptor'));
 const embedded=descriptor.lookup(PDFName.of('FontFile2'));
 const subset=fontkit.create(decodePDFRawStream(embedded).decode());
 assert.ok(subset.numGlyphs>30&&subset.numGlyphs<200);
 // The faulty short glyph offsets previously made these paths empty or invalid.
 for(let id=0;id<subset.numGlyphs;id++){
  const glyph=subset.getGlyph(id);
  assert.doesNotThrow(()=>glyph.path.commands);
  if(glyph.advanceWidth>500)assert.ok(glyph.path.commands.length>0,`glyph ${id} lost its outline`);
 }
 const unicode=new TextDecoder().decode(decodePDFRawStream(outer.lookup(PDFName.of('ToUnicode'))).decode());
 for(const character of '中文教育28264.1因果')assert.ok(unicode.includes(character.codePointAt(0).toString(16).toUpperCase().padStart(4,'0')));
});
test('export keeps every character when wrapping and refuses unfinished translations',async()=>{
 const lines=wrapPdfText('中文ABC\n最后一段', {widthOfTextAtSize:text=>text.length},1,3);
 assert.deepEqual(lines,['中文A','BC','最后一','段']);
 await assert.rejects(createTranslationPdf('unfinished',{...translation,complete:false},new Uint8Array()),/完成翻译/);
});

test('long translations retain one sheet per source page, all text, paragraph IDs and pending pages',async()=>{
 const fontBytes=new Uint8Array(await readFile(new URL('../public/assets/pdf-fonts/LumiorDocumentSans-Regular.ttf',import.meta.url)));
 const longText='研究结果。'.repeat(1400)+'最终尾段：完整保留。';
 const draft={...translation,complete:false,totalPages:3,emptyPages:[3],units:[{id:'1:0',page:1,text:longText,parts:[{id:'1:0:0',text:longText,rects:[]}]}]};
 const preview=await buildTranslationPdf('研究',draft,fontBytes,true);
 const pdf=await PDFDocument.load(preview.bytes);
 assert.equal(pdf.getPageCount(),3);assert.deepEqual(preview.pages.map(page=>page.source),[1,2,3]);
 assert.equal(preview.pages[0].columns,2);assert.ok(pdf.getPage(0).getHeight()>841.89);
 assert.equal(preview.pages[1].height,841.89);
 assert.ok(preview.pages[0].rects.every(value=>value.id==='1:0:0'));
 assert.ok(preview.pages[0].rects.some(value=>value.rect.x>50));
 assert.ok(preview.pages[1].rects.every(value=>value.id==='pending:2'));
 assert.ok(preview.pages[2].rects.every(value=>value.id==='pending:3'));
 for(const page of preview.pages)for(const {rect} of page.rects)assert.ok(rect.y>0&&rect.y+rect.height<100&&rect.x+rect.width<=100);
 assert.deepEqual(await exportedBodyText(preview.bytes),[longText,'本页译文尚未完成。','本页未提取到可翻译文字，请查看原 PDF。']);
 await assert.rejects(buildTranslationPdf('研究',draft,fontBytes),/完成翻译/);
});

test('source line fragments flow into paragraphs while every ID keeps its own translated segment',async()=>{
 const fontBytes=new Uint8Array(await readFile(new URL('../public/assets/pdf-fonts/LumiorDocumentSans-Regular.ttf',import.meta.url)));
 const parts=[
  {id:'1:0:0',text:'论文标题',rects:[{x:10,y:10,width:50,height:2}]},
  {id:'1:0:1',text:'学术编辑：Pilar Colás-Bravo,',rects:[{x:10,y:20,width:35,height:1}]},
  {id:'1:0:2',text:'Emilio Berrocal De Luna 和',rects:[{x:10,y:21.5,width:35,height:1}]},
  {id:'1:0:3',text:'Calixto Gutiérrez Braojos',rects:[{x:10,y:23,width:35,height:1}]},
  {id:'1:0:4',text:'正文第一行\n继续第二行。\n\n第二段。\n• 条目一\n• 条目二',rects:[{x:10,y:30,width:80,height:1}]},
 ];
 const saved={...translation,units:[{id:'1:0',page:1,text:parts.map(part=>part.text).join('\n\n'),parts}]};
 const result=await buildTranslationPdf('阅读',saved,fontBytes);
 assert.equal(result.pages.length,1);assert.equal(result.pages[0].columns,1);
 assert.deepEqual(new Set(result.pages[0].rects.map(value=>value.id)),new Set(parts.map(part=>part.id)));
 const [first,second]=[1,2].map(index=>result.pages[0].rects.find(value=>value.id===parts[index].id).rect);
 assert.equal(first.y,second.y);assert.ok(first.x+first.width<=second.x+.001);
 const [body]=await exportedBodyText(result.bytes);
 assert.equal(body.replace(/\s/g,''),parts.map(part=>part.text).join('').replace(/\s/g,''));
 // Soft wraps use one baseline; actual paragraphs and list items still get space.
 const lastRects=result.pages[0].rects.filter(value=>value.id==='1:0:4');
 assert.ok(lastRects.length>=4);assert.ok(lastRects.length<8);
 assert.ok(lastRects[0].rect.y>first.y);
});

test('two-column export preserves letters, formulas, all part IDs and the final line on each source page',async()=>{
 const fontBytes=new Uint8Array(await readFile(new URL('../public/assets/pdf-fonts/LumiorDocumentSans-Regular.ttf',import.meta.url)));
 const parts=Array.from({length:18},(_,i)=>({id:`1:0:${i}`,text:`第 ${i+1} 段：ECM 数据 x = 1.25；结果完整。`.repeat(8),rects:[{x:10,y:5+i*4,width:80,height:1}]}));
 const second='第二页最终一句：不与第一页混排。';
 const saved={...translation,totalPages:2,units:[{id:'1:0',page:1,text:parts.map(part=>part.text).join('\n\n'),parts},{id:'2:0',page:2,text:second}]};
 const result=await buildTranslationPdf('两栏',saved,fontBytes);
 assert.deepEqual(result.pages.map(page=>page.source),[1,2]);
 assert.equal(result.pages[0].columns,2);assert.equal(result.pages[1].columns,1);
 assert.deepEqual(new Set(result.pages[0].rects.map(value=>value.id)),new Set(parts.map(part=>part.id)));
 const body=await exportedBodyText(result.bytes);
 assert.equal(body[0].replace(/\s/g,''),parts.map(part=>part.text).join('').replace(/\s/g,''));
 assert.equal(body[1],second);
 for(const line of (await exportedBodyLines(result.bytes))[0])assert.ok(!/^[，。！？；：、）】》]/u.test(line),'Chinese closing punctuation stays with preceding text');
 for(const page of result.pages)for(const {rect} of page.rects){assert.ok(rect.x>=0&&rect.y>=0&&rect.width>0&&rect.height>0);assert.ok(rect.x+rect.width<=100&&rect.y+rect.height<=100);}
});
