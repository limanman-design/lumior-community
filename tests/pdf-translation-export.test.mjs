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
   // Page fitting may choose any font size. With no added page furniture, all
   // text objects belong to the translated body and must remain extractable.
   for(const block of stream.matchAll(/BT\s+([\s\S]*?)ET/g))for(const match of block[1].matchAll(/<([0-9A-F]+)> Tj/g))lines.push(match[1].match(/.{4}/g).map(value=>characters.get(value)??'\uFFFD').join(''));
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
 for(const character of '基于用户28264.1因果')assert.ok(unicode.includes(character.codePointAt(0).toString(16).toUpperCase().padStart(4,'0')));
});

test('translated pages add no branding, generated page banners, footer or disclaimer text',async()=>{
 const fontBytes=new Uint8Array(await readFile(new URL('../public/assets/pdf-fonts/LumiorDocumentSans-Regular.ttf',import.meta.url)));
 const saved={...translation,totalPages:2,units:[{id:'1:0',page:1,text:'第一页完整内容。'},{id:'2:0',page:2,text:'第二页完整内容。'}]};
 const result=await buildTranslationPdf('文件名不应进入正文',saved,fontBytes);
 assert.deepEqual((await exportedBodyLines(result.bytes,false)).map(lines=>lines.join('')),['第一页完整内容。','第二页完整内容。']);
});

test('source formula images replace only matched display math and retain IDs in both preview and export',async()=>{
 const fontBytes=new Uint8Array(await readFile(new URL('../public/assets/pdf-fonts/LumiorDocumentSans-Regular.ttf',import.meta.url)));
 const parts=[
  {id:'1:0:0',text:'公式之前的中文说明。',rects:[{x:10,y:20,width:70,height:1.3}]},
  {id:'1:0:1',text:'H = 错误的旧公式',rects:[{x:20,y:30,width:18,height:1.3}]},
  {id:'1:0:2',text:'(1)',rects:[{x:80,y:30,width:4,height:1.3}]},
  {id:'1:0:3',text:'公式之后的中文说明。',rects:[{x:10,y:40,width:70,height:1.3}]},
 ];
 // A tiny test raster verifies image embedding and mapping; real formula fidelity
 // is verified against the source PDF in the rendered integration fixture.
 const png=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==','base64'));
 const formulas=[{id:'formula:1',page:1,partIds:['1:0:1','1:0:2'],rect:{x:19,y:29,width:66,height:4},png,width:396,height:24}];
 const saved={...translation,units:[{id:'1:0',page:1,text:parts.map(part=>part.text).join('\n'),parts}]},before=structuredClone(saved);
 for(const preview of [true,false]){
  const result=await buildTranslationPdf('公式',saved,fontBytes,preview,formulas);
  assert.deepEqual(await exportedBodyText(result.bytes),['公式之前的中文说明。公式之后的中文说明。']);
  assert.deepEqual(new Set(result.pages[0].rects.map(value=>value.id)),new Set(parts.map(part=>part.id)));
  const formulaRects=result.pages[0].rects.filter(value=>formulas[0].partIds.includes(value.id));
  assert.equal(formulaRects.length,2);assert.deepEqual(formulaRects[0].rect,formulaRects[1].rect);
  const pdf=await PDFDocument.load(result.bytes),page=pdf.getPage(0);
  const rectangle=formulaRects[0].rect;
  assert.ok(Math.abs((rectangle.width*page.getWidth())/(rectangle.height*page.getHeight())-396/24)<1e-8);
  const objects=page.node.Resources().lookup(PDFName.of('XObject'));
  assert.equal(objects.keys().filter(key=>objects.lookup(key).dict.get(PDFName.of('Subtype')).toString()==='/Image').length,1);
 }
 assert.deepEqual(saved,before);
 const fallback=await buildTranslationPdf('公式',saved,fontBytes);
 assert.ok((await exportedBodyText(fallback.bytes))[0].includes('错误的旧公式'));
});
test('export keeps every character when wrapping and refuses unfinished translations',async()=>{
 const lines=wrapPdfText('中文ABC\n最后一段', {widthOfTextAtSize:text=>text.length},1,3);
 assert.deepEqual(lines,['中文A','BC','最后一','段']);
 await assert.rejects(createTranslationPdf('unfinished',{...translation,complete:false},new Uint8Array()),/完成翻译/);
});

test('math symbols retain distinct Unicode and valid outlines in preview and exported PDFs',async()=>{
 const fontBytes=new Uint8Array(await readFile(new URL('../public/assets/pdf-fonts/LumiorDocumentSans-Regular.ttf',import.meta.url)));
 const font=fontkit.create(fontBytes),text='量子态 ⟨ψ|H|ψ⟩；CJK 原字符 〈标题〉；⟨n⟩ = 1；ˆ ϵ ∗ ε ^ * 𝜓 ⟦a⟧。';
 for(const character of 'ˆϵ∗𝜓⟦⟧'){
  const glyph=font.glyphForCodePoint(character.codePointAt(0));
  assert.notEqual(glyph.id,0);assert.ok(glyph.path.commands.length>0);
 }
 const mathematical=[0x27E8,0x27E9].map(code=>font.glyphForCodePoint(code));
 for(const [index,glyph] of mathematical.entries()){
  assert.notEqual(glyph.id,0);assert.ok(glyph.path.commands.length>0);
  assert.notEqual(glyph.id,font.glyphForCodePoint([0x3008,0x3009][index]).id,'math and CJK brackets must not share a PDF Unicode glyph ID');
 }
 const saved={...translation,units:[{id:'1:0',page:1,text}]},before=structuredClone(saved);
 for(const preview of [true,false]){
  const result=await buildTranslationPdf('数学 ⟨ψ⟩',saved,fontBytes,preview);
  assert.deepEqual(await exportedBodyText(result.bytes),[text]);
  const pdf=await PDFDocument.load(result.bytes),fonts=pdf.getPage(0).node.Resources().lookup(PDFName.of('Font'));
  const outer=fonts.lookup(fonts.keys()[0]),descendant=outer.lookup(PDFName.of('DescendantFonts')).lookup(0);
  const subset=fontkit.create(decodePDFRawStream(descendant.lookup(PDFName.of('FontDescriptor')).lookup(PDFName.of('FontFile2'))).decode());
  for(let id=1;id<subset.numGlyphs;id++)assert.doesNotThrow(()=>subset.getGlyph(id).path.commands);
 }
 assert.deepEqual(saved,before,'font support never rewrites the saved translation');
});

test('long translations fit one fixed sheet per source page with all text, paragraph IDs and pending pages',async()=>{
 const fontBytes=new Uint8Array(await readFile(new URL('../public/assets/pdf-fonts/LumiorDocumentSans-Regular.ttf',import.meta.url)));
 const longText='研究结果。'.repeat(1400)+'最终尾段：完整保留。';
 const draft={...translation,complete:false,totalPages:3,emptyPages:[3],units:[{id:'1:0',page:1,text:longText,parts:[{id:'1:0:0',text:longText,rects:[]}]}]};
 const preview=await buildTranslationPdf('研究',draft,fontBytes,true);
 const pdf=await PDFDocument.load(preview.bytes);
 assert.equal(pdf.getPageCount(),3);assert.deepEqual(preview.pages.map(page=>page.source),[1,2,3]);
 assert.equal(preview.pages[0].columns,2);assert.equal(pdf.getPage(0).getHeight(),841.89);
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
 const parts=Array.from({length:18},(_,i)=>({id:`1:0:${i}`,text:`第 ${i+1} 段：ECM 数据 x = 1.25；结果完整。`.repeat(8),rects:[{x:i<9?10:53,y:5+(i%9)*4,width:38,height:1}]}));
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

test('Markdown formatting renders as document hierarchy in preview and export while saved text stays unchanged',async()=>{
 const fontBytes=new Uint8Array(await readFile(new URL('../public/assets/pdf-fonts/LumiorDocumentSans-Regular.ttf',import.meta.url)));
 const parts=[{id:'1:0:0',text:'# 论文标题\n\n## 研究方法\n\n一段**重点**与*斜体*，保留变量 x_y 和 ψ*α + β*γ。\n\n- 第一项\n- 第二项\n\n> 引用中的说明\n\n```\nconst value = 2;\n```',rects:[]}];
 const saved={...translation,units:[{id:'1:0',page:1,text:parts[0].text,parts}]},before=structuredClone(saved);
 for(const preview of [true,false]){
  const result=await buildTranslationPdf('研究',saved,fontBytes,preview);
  const [text]=await exportedBodyText(result.bytes);
  assert.equal(text.replace(/\s/g,''),'论文标题研究方法一段重点与斜体，保留变量x_y和ψ*α+β*γ。-第一项-第二项引用中的说明constvalue=2;');
  assert.ok(result.pages[0].rects.every(value=>value.id==='1:0:0'));
  for(const {rect} of result.pages[0].rects)assert.ok(rect.x>=0&&rect.x+rect.width<=100&&rect.y>0&&rect.y+rect.height<100);
 }
 assert.deepEqual(saved,before);
});

test('unequal source columns balance their visible bottoms without losing reading order or saved part IDs',async()=>{
 const fontBytes=new Uint8Array(await readFile(new URL('../public/assets/pdf-fonts/LumiorDocumentSans-Regular.ttf',import.meta.url)));
 const parts=Array.from({length:6},(_,index)=>({id:`balance:${index}`,text:`第${index+1}段的完整正文，保留顺序。`.repeat(index<3?45:3),rects:[{x:index<3?10:53,y:20+(index%3)*12,width:38,height:1.3}]}));
 const saved={...translation,units:[{id:'1:0',page:1,text:parts.map(part=>part.text).join('\n\n'),parts}]},before=structuredClone(saved);
 let previewLayout;
 for(const preview of [true,false]){
  const result=await buildTranslationPdf('均衡双栏',saved,fontBytes,preview),page=result.pages[0];
  assert.equal(page.columns,2);
  assert.deepEqual(new Set(page.rects.map(value=>value.id)),new Set(parts.map(part=>part.id)));
  assert.equal((await exportedBodyText(result.bytes))[0].replace(/\s/g,''),parts.map(part=>part.text).join('').replace(/\s/g,''));
  const bottoms=[false,true].map(right=>Math.max(...page.rects.filter(value=>(value.rect.x>50)===right).map(value=>(value.rect.y+value.rect.height)*page.height/100)));
  assert.ok(Math.abs(bottoms[0]-bottoms[1])<.01,`visible column bottoms differ by ${Math.abs(bottoms[0]-bottoms[1])}pt`);
  assert.ok(page.rects.some(value=>value.id==='balance:2'&&value.rect.x>50),'long source-left text can continue in the translated right column');
  if(preview)previewLayout=result.pages;else assert.deepEqual(result.pages,previewLayout,'preview and exported PDFs use the same column layout');
 }
 assert.deepEqual(saved,before);
});

test('balancing preserves spanning titles and abstracts and leaves single-column source pages single-column',async()=>{
 const fontBytes=new Uint8Array(await readFile(new URL('../public/assets/pdf-fonts/LumiorDocumentSans-Regular.ttf',import.meta.url)));
 const title={id:'title',text:'# 跨栏论文标题',rects:[{x:20,y:6,width:60,height:2}]};
 const abstract={id:'abstract',text:'摘要中的完整说明。'.repeat(20),rects:Array.from({length:6},(_,index)=>({x:16,y:18+index*2,width:68,height:1.3}))};
 const body=Array.from({length:6},(_,index)=>({id:`body:${index}`,text:`第${index+1}段正文。`.repeat(index<3?26:4),rects:[{x:index<3?10:53,y:40+(index%3)*12,width:38,height:1.3}]}));
 const parts=[title,abstract,...body],single='第二页的单栏正文。'.repeat(120);
 const saved={...translation,totalPages:2,units:[{id:'1:0',page:1,text:parts.map(part=>part.text).join('\n\n'),parts},{id:'2:0',page:2,text:single,parts:[{id:'single',text:single,rects:[{x:10,y:10,width:80,height:1.3},{x:10,y:12,width:80,height:1.3}]}]}]};
 const result=await buildTranslationPdf('跨栏',saved,fontBytes),first=result.pages[0],bodyTop=Math.min(...first.rects.filter(value=>value.id.startsWith('body:')).map(value=>value.rect.y));
 assert.deepEqual(result.pages.map(page=>[page.source,page.columns]),[[1,2],[2,1]]);
 assert.ok(first.rects.filter(value=>value.id==='title'||value.id==='abstract').every(value=>value.rect.y+value.rect.height<bodyTop));
 assert.ok(first.rects.some(value=>value.id==='abstract'&&value.rect.width>60),'the abstract keeps the full page width');
 assert.ok(result.pages[1].rects.every(value=>value.rect.x<50),'the second page has no translated right-column origin');
 const text=await exportedBodyText(result.bytes);
 assert.equal(text[0].replace(/\s/g,''),(title.text.slice(2)+abstract.text+body.map(part=>part.text).join('')).replace(/\s/g,''));
 assert.equal(text[1],single);
});

test('a multi-line section heading at the balance boundary stays with its following paragraph',async()=>{
 const fontBytes=new Uint8Array(await readFile(new URL('../public/assets/pdf-fonts/LumiorDocumentSans-Regular.ttf',import.meta.url)));
 const paragraphs=(prefix,count)=>Array.from({length:count},(_,index)=>`${prefix}第${index+1}段。`).join('\n\n');
 const values=[paragraphs('前文甲',4),paragraphs('前文乙',4),'## 这个比较长的小节标题需要完整地跟随后面的正文一起排在同一栏','标题后的第一段。\n\n标题后的第二段。',paragraphs('后文甲',3),paragraphs('后文乙',3),paragraphs('后文丙',2)];
 const parts=values.map((text,index)=>({id:index===2?'heading':index===3?'following':`paragraph:${index}`,text,rects:[{x:index<4?10:53,y:20+(index<4?index:index-4)*8,width:38,height:1.3}]}));
 const saved={...translation,units:[{id:'1:0',page:1,text:values.join('\n\n'),parts}]};
 const result=await buildTranslationPdf('标题不孤悬',saved,fontBytes),rects=result.pages[0].rects,heading=rects.filter(value=>value.id==='heading'),following=rects.find(value=>value.id==='following');
 assert.equal(result.pages[0].columns,2);assert.ok(heading.length>=2,'the fixture heading wraps to more than one line');
 assert.equal(new Set(heading.map(value=>value.rect.x>50)).size,1,'all heading lines stay in one column');
 assert.equal(following.rect.x>50,heading[0].rect.x>50,'the heading keeps its first following paragraph line');
 assert.ok(following.rect.y>Math.max(...heading.map(value=>value.rect.y)));
 assert.equal((await exportedBodyText(result.bytes))[0].replace(/\s/g,''),values.map(value=>value.replace(/^## /,'')).join('').replace(/\s/g,''));
});

test('balancing moves a source formula as one image with its heading and keeps its aspect ratio and IDs',async()=>{
 const fontBytes=new Uint8Array(await readFile(new URL('../public/assets/pdf-fonts/LumiorDocumentSans-Regular.ttf',import.meta.url)));
 const parts=[
  {id:'before-a',text:'公式前的第一段正文。'.repeat(24),rects:[{x:10,y:20,width:38,height:1.3}]},
  {id:'before-b',text:'公式前的第二段正文。'.repeat(24),rects:[{x:10,y:32,width:38,height:1.3}]},
  {id:'heading',text:'## 独立公式',rects:[{x:14,y:44,width:30,height:1.3}]},
  {id:'math-a',text:'错误的原公式文字',rects:[{x:10,y:52,width:20,height:1.3}]},
  {id:'math-b',text:'(1)',rects:[{x:45,y:52,width:2,height:1.3}]},
  ...Array.from({length:3},(_,index)=>({id:`after:${index}`,text:`公式后的第${index+1}段说明。`.repeat(12),rects:[{x:53,y:20+index*14,width:38,height:1.3}]})),
 ];
 const png=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==','base64'));
 const formulas=[{id:'balance-formula',page:1,partIds:['math-a','math-b'],rect:{x:9,y:50,width:39,height:12},png,width:240,height:80}];
 const saved={...translation,units:[{id:'1:0',page:1,text:parts.map(part=>part.text).join('\n\n'),parts}]},before=structuredClone(saved);
 const result=await buildTranslationPdf('完整公式',saved,fontBytes,false,formulas),page=result.pages[0],formulaRects=page.rects.filter(value=>value.id.startsWith('math-'));
 assert.equal(page.columns,2);assert.equal(formulaRects.length,2);assert.deepEqual(formulaRects[0].rect,formulaRects[1].rect);
 assert.equal(page.rects.find(value=>value.id==='heading').rect.x>50,formulaRects[0].rect.x>50);
 const document=await PDFDocument.load(result.bytes),pdfPage=document.getPage(0),rect=formulaRects[0].rect;
 assert.ok(Math.abs(rect.width*pdfPage.getWidth()/(rect.height*pdfPage.getHeight())-3)<1e-8);
 const objects=pdfPage.node.Resources().lookup(PDFName.of('XObject'));
 assert.equal(objects.keys().filter(key=>objects.lookup(key).dict.get(PDFName.of('Subtype')).toString()==='/Image').length,1);
 assert.deepEqual(new Set(page.rects.map(value=>value.id)),new Set(parts.map(part=>part.id)));
 const body=(await exportedBodyText(result.bytes))[0].replace(/\s/g,'');
 assert.equal(body,parts.filter(part=>!part.id.startsWith('math-')).map(part=>part.text.replace(/^## /,'')).join('').replace(/\s/g,''));
 assert.deepEqual(saved,before);
});

test('a tall indivisible equation does not stretch three short paragraphs to force equal column heights',async()=>{
 const fontBytes=new Uint8Array(await readFile(new URL('../public/assets/pdf-fonts/LumiorDocumentSans-Regular.ttf',import.meta.url)));
 const parts=[
  ...Array.from({length:3},(_,index)=>({id:`math:${index}`,text:`原公式片段${index+1}`,rects:[{x:10,y:20+index*20,width:38,height:1.3}]})),
  ...Array.from({length:3},(_,index)=>({id:`short:${index}`,text:`公式之后的第${index+1}句。`,rects:[{x:53,y:20+index*20,width:38,height:1.3}]})),
 ];
 const png=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==','base64'));
 const formulas=[{id:'tall-formula',page:1,partIds:['math:0','math:1','math:2'],rect:{x:9,y:20,width:40,height:60},png,width:240,height:420}];
 const saved={...translation,units:[{id:'1:0',page:1,text:parts.map(part=>part.text).join('\n\n'),parts}]};
 const result=await buildTranslationPdf('高公式',saved,fontBytes,false,formulas),page=result.pages[0],prose=page.rects.filter(value=>value.id.startsWith('short:'));
 assert.equal(page.columns,2);assert.equal(prose.length,3);
 assert.ok(prose.every(value=>value.rect.x>50),'the short paragraphs follow the intact left-column equation');
 for(let index=1;index<prose.length;index++)assert.ok(Math.abs((prose[index].rect.y-prose[index-1].rect.y)*page.height/100-24.5)<.01,'short-column paragraph spacing stays natural');
 const formula=page.rects.find(value=>value.id==='math:0').rect;
 assert.ok((formula.y+formula.height-prose.at(-1).rect.y-prose.at(-1).rect.height)*page.height/100>200,'a large unavoidable height difference is allowed instead of stretching sparse text');
 assert.equal(page.rects.filter(value=>value.id.startsWith('math:')).length,3);
 assert.deepEqual(new Set(page.rects.map(value=>value.id)),new Set(parts.map(part=>part.id)));
});

test('a short final page aligns seven lines against six with bounded spacing on both sides',async()=>{
 const fontBytes=new Uint8Array(await readFile(new URL('../public/assets/pdf-fonts/LumiorDocumentSans-Regular.ttf',import.meta.url)));
 const parts=[7,6].map((count,lane)=>({id:`short-reference:${lane}`,text:'参考'[lane].repeat(count*22),rects:[20,24,28].map(y=>({x:lane?53:10,y,width:38,height:1.3}))}));
 const saved={...translation,units:[{id:'1:0',page:1,text:parts.map(part=>part.text).join('\n\n'),parts}]};
 const result=await buildTranslationPdf('短末页',saved,fontBytes),page=result.pages[0];
 const lanes=[false,true].map(right=>page.rects.filter(value=>(value.rect.x>50)===right));
 assert.equal(page.columns,2);assert.deepEqual(lanes.map(lane=>lane.length),[7,6]);
 const bottoms=lanes.map(lane=>Math.max(...lane.map(value=>(value.rect.y+value.rect.height)*page.height/100)));
 assert.ok(Math.abs(bottoms[0]-bottoms[1])<.01);
 for(const lane of lanes)for(let index=1;index<lane.length;index++){
  const gap=(lane[index].rect.y-lane[index-1].rect.y)*page.height/100;
  assert.ok(gap>=15.4-.001&&gap<=19.25+.001,'spacing changes stay bounded by the text size');
 }
 assert.equal((await exportedBodyText(result.bytes))[0].replace(/\s/g,''),parts.map(part=>part.text).join('').replace(/\s/g,''));
});

function assertInsideFixedPages(result,sizes){
 assert.equal(result.pages.length,sizes.length);
 for(const [index,page]of result.pages.entries()){
  assert.equal(page.source,index+1);assert.equal(page.height,sizes[index].height);
  for(const {rect}of page.rects){
   assert.ok([rect.x,rect.y,rect.width,rect.height].every(Number.isFinite));
   assert.ok(rect.x>=0&&rect.y>=0&&rect.width>0&&rect.height>0);
   assert.ok(rect.x+rect.width<=100.000001&&rect.y+rect.height<=100.000001,`page ${index+1} must not clip any mapped text or formula`);
  }
 }
}

test('preview and export match mixed source page sizes including landscape without moving text across pages',async()=>{
 const fontBytes=new Uint8Array(await readFile(new URL('../public/assets/pdf-fonts/LumiorDocumentSans-Regular.ttf',import.meta.url)));
 const sizes=[{width:612,height:792},{width:792,height:612},{width:420,height:595}];
 const units=sizes.map((_,index)=>{
  const parts=Array.from({length:2},(_,part)=>({id:`${index+1}:0:${part}`,text:`原文第${index+1}页第${part+1}段内容完整保留。`.repeat(index===1?130:12),rects:[{x:10,y:15+part*30,width:80,height:1.3}]}));
  return{id:`${index+1}:0`,page:index+1,text:parts.map(part=>part.text).join('\n\n'),parts};
 });
 const saved={...translation,totalPages:3,units},before=structuredClone(saved);let previewPages;
 for(const preview of [true,false]){
  const result=await buildTranslationPdf('混合页面',saved,fontBytes,preview,[],sizes),pdf=await PDFDocument.load(result.bytes);
  assertInsideFixedPages(result,sizes);
  assert.deepEqual(pdf.getPages().map(page=>page.getSize()),sizes);
  const text=await exportedBodyText(result.bytes);
  for(const [index,unit]of units.entries()){
   assert.equal(text[index].replace(/\s/g,''),unit.text.replace(/\s/g,''));
   assert.deepEqual(new Set(result.pages[index].rects.map(value=>value.id)),new Set(unit.parts.map(part=>part.id)));
  }
  if(preview)previewPages=result.pages;else assert.deepEqual(result.pages,previewPages);
 }
 const pdf=await PDFDocument.load(await createTranslationPdf('混合页面',saved,fontBytes,[],sizes));
 assert.deepEqual(pdf.getPages().map(page=>page.getSize()),sizes,'the export convenience entry point also accepts source dimensions');
 assert.deepEqual(saved,before);
});

test('empty and pending pages retain their own source dimensions during a partial translation',async()=>{
 const fontBytes=new Uint8Array(await readFile(new URL('../public/assets/pdf-fonts/LumiorDocumentSans-Regular.ttf',import.meta.url)));
 const sizes=[{width:612,height:792},{width:792,height:612},{width:400,height:400},{width:540,height:720}];
 const saved={...translation,totalPages:4,complete:false,emptyPages:[2],units:[{id:'1:0',page:1,text:'第一页已保存的正文。'.repeat(200)},{id:'3:0',page:3,text:'第三页已完成的内容。'}]},before=structuredClone(saved);
 const result=await buildTranslationPdf('部分译文',saved,fontBytes,true,[],sizes),pdf=await PDFDocument.load(result.bytes);
 assertInsideFixedPages(result,sizes);assert.deepEqual(pdf.getPages().map(page=>page.getSize()),sizes);
 assert.deepEqual(await exportedBodyText(result.bytes),[saved.units[0].text,'本页未提取到可翻译文字，请查看原 PDF。',saved.units[1].text,'本页译文尚未完成。']);
 assert.ok(result.pages[1].rects.every(value=>value.id==='pending:2'));
 assert.ok(result.pages[3].rects.every(value=>value.id==='pending:4'));
 assert.deepEqual(saved,before);
});

test('an oversized spanning title and long single-column body fit the same small source page without truncation',async()=>{
 const fontBytes=new Uint8Array(await readFile(new URL('../public/assets/pdf-fonts/LumiorDocumentSans-Regular.ttf',import.meta.url)));
 const title='完整长标题'.repeat(180),body='正文中的每一句都需要完整保留，不得截断或移动到下一页。'.repeat(180)+'最终结束标记。';
 const parts=[{id:'title',text:'# '+title,rects:[{x:12,y:6,width:76,height:2}]},{id:'body',text:body,rects:[{x:10,y:20,width:80,height:1.3},{x:10,y:22,width:80,height:1.3}]}];
 const saved={...translation,units:[{id:'1:0',page:1,text:parts.map(part=>part.text).join('\n\n'),parts}]},before=structuredClone(saved),sizes=[{width:320,height:400}];
 const result=await buildTranslationPdf('极长标题',saved,fontBytes,false,[],sizes),pdf=await PDFDocument.load(result.bytes);
 assertInsideFixedPages(result,sizes);assert.equal(pdf.getPageCount(),1);assert.deepEqual(pdf.getPage(0).getSize(),sizes[0]);
 assert.equal(result.pages[0].columns,1,'fitting does not change a single-column source to two columns');
 assert.deepEqual(await exportedBodyText(result.bytes),[title+body]);
 assert.deepEqual(new Set(result.pages[0].rects.map(value=>value.id)),new Set(['title','body']));
 assert.deepEqual(saved,before);
});

test('a formula taller than the source page scales uniformly with all its IDs and surrounding text intact',async()=>{
 const fontBytes=new Uint8Array(await readFile(new URL('../public/assets/pdf-fonts/LumiorDocumentSans-Regular.ttf',import.meta.url)));
 const parts=[{id:'before',text:'公式之前的完整说明。',rects:[{x:10,y:10,width:80,height:1.3}]},{id:'math-a',text:'旧公式片段',rects:[{x:30,y:25,width:5,height:1.3}]},{id:'math-b',text:'(1)',rects:[{x:30,y:80,width:5,height:1.3}]},{id:'after',text:'公式之后的完整说明，最后一句必须显示。',rects:[{x:10,y:90,width:80,height:1.3}]}];
 const png=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==','base64'));
 const formulas=[{id:'oversized-formula',page:1,partIds:['math-a','math-b'],rect:{x:29,y:24,width:8,height:60},png,width:80,height:1600}],sizes=[{width:320,height:400}];
 const saved={...translation,units:[{id:'1:0',page:1,text:parts.map(part=>part.text).join('\n\n'),parts}]},before=structuredClone(saved);
 for(const preview of [true,false]){
  const result=await buildTranslationPdf('巨大公式',saved,fontBytes,preview,formulas,sizes),pdf=await PDFDocument.load(result.bytes),page=pdf.getPage(0);
  assertInsideFixedPages(result,sizes);assert.equal(pdf.getPageCount(),1);assert.deepEqual(page.getSize(),sizes[0]);
  const regions=result.pages[0].rects.filter(value=>value.id.startsWith('math-'));
  assert.equal(regions.length,2);assert.deepEqual(regions[0].rect,regions[1].rect);
  const r=regions[0].rect;assert.ok(Math.abs((r.width*page.getWidth())/(r.height*page.getHeight())-80/1600)<1e-8);
  assert.ok(r.height*page.getHeight()/100<page.getHeight(),'a full-height equation is resized, never clipped');
  assert.deepEqual(await exportedBodyText(result.bytes),[parts[0].text+parts[3].text]);
  assert.deepEqual(new Set(result.pages[0].rects.map(value=>value.id)),new Set(parts.map(part=>part.id)));
 }
 assert.deepEqual(saved,before);
});
