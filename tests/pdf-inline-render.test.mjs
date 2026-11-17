import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PDFDocument,PDFName,decodePDFRawStream} from 'pdf-lib';
import {buildTranslationPdf} from '../lib/pdf-translation-pdf.ts';

const font=new Uint8Array(await readFile(new URL('../public/assets/pdf-fonts/LumiorDocumentSans-Regular.ttf',import.meta.url)));
const png=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==','base64'));
const rectangle={x:22,y:20,width:8,height:3};
const descriptor=(marker='{v1}')=>({marker,text:'x²',rect:rectangle,baseline:22,fontSize:10});
const part=(text,id='1:0:0',formulas=[descriptor()])=>({id,text,rects:[{x:10,y:20,width:80,height:1.3}],inlineFormulas:formulas,sourceHash:'a'.repeat(64)});
const saved=(parts)=>({version:1,sourceKey:'inline-test',target:'zh-CN',sourceLanguage:'英语',model:'test',inlineMathVersion:1,units:[{id:'1:0',page:1,text:parts.map(value=>value.text).join('\n\n'),parts,inlineMathVersion:1}],glossary:[],totalPages:1,emptyPages:[],complete:true,updatedAt:0});
const image=(marker='{v1}',id='1:0:0',overrides={})=>({id:`inline:${id}:${marker}`,page:1,partIds:[id],rect:rectangle,png,width:30,height:18,inline:{marker,baseline:13,fontSize:10},...overrides});
const epsilon=.00001;
function inside(page){
 for(const {rect}of page.rects)assert.ok(rect.x>=0&&rect.y>=0&&rect.width>0&&rect.height>0&&rect.x+rect.width<=100+epsilon&&rect.y+rect.height<=100+epsilon,JSON.stringify(rect));
}
async function inspect(bytes){
 const document=await PDFDocument.load(bytes),pages=[];
 for(const page of document.getPages()){
  const fonts=page.node.Resources().lookup(PDFName.of('Font')),outer=fonts.lookup(fonts.keys()[0]);
  const unicode=new TextDecoder().decode(decodePDFRawStream(outer.lookup(PDFName.of('ToUnicode'))).decode()),characters=new Map();
  for(const block of unicode.matchAll(/beginbfchar\s+([\s\S]*?)endbfchar/g))for(const match of block[1].matchAll(/<([0-9A-F]+)>\s*<([0-9A-F]+)>/g))characters.set(match[1],match[2].match(/.{4}/g).map(value=>String.fromCharCode(parseInt(value,16))).join(''));
  const contents=page.node.Contents();let text='',draws=0;
  for(let index=0;index<contents.size();index++){
   const stream=new TextDecoder().decode(decodePDFRawStream(contents.lookup(index)).decode());
   for(const match of stream.matchAll(/<([0-9A-F]+)> Tj/g))text+=match[1].match(/.{4}/g).map(value=>characters.get(value)??'�').join('');
   draws+=[...stream.matchAll(/\bDo\b/g)].length;
  }
  pages.push({text,draws,width:page.getWidth(),height:page.getHeight()});
 }
 return pages;
}

test('an inline source image shares the text baseline, replaces only its marker and keeps saved data unchanged',async()=>{
 const value=saved([part('变量 {v1} 的大小保持不变。')]),before=structuredClone(value),source=image();let previewPages;
 for(const preview of [true,false]){
  const result=await buildTranslationPdf('行内公式',value,font,preview,[source],[{width:612,height:792}]);
  const page=result.pages[0],output=(await inspect(result.bytes))[0];
  assert.equal(output.text,'变量  的大小保持不变。');assert.equal(output.draws,1);
  assert.deepEqual([output.width,output.height],[612,792]);assert.equal(page.rects.length,3);
  const [left,formula,right]=page.rects.map(value=>value.rect);
  assert.ok(left.x+left.width<=formula.x+epsilon&&formula.x+formula.width<=right.x+epsilon);
  assert.ok(Math.abs(formula.width*612/(formula.height*792)-30/18)<epsilon);
  const textBaseline=left.y+left.height/1.3,imageBaseline=formula.y+formula.height*13/18;
  assert.ok(Math.abs(textBaseline-imageBaseline)<epsilon);assert.ok(Math.abs(left.y-right.y)<epsilon);
  assert.deepEqual(new Set(page.rects.map(value=>value.id)),new Set(['1:0:0']));inside(page);
  if(preview)previewPages=result.pages;else assert.deepEqual(result.pages,previewPages);
 }
 assert.deepEqual(value,before);
});

test('a wide inline expression wraps as one image without splitting or losing the surrounding sentence',async()=>{
 const text='文字'.repeat(7)+'{v1}'+'结论'.repeat(12),value=saved([part(text)]);
 const result=await buildTranslationPdf('换行',value,font,false,[image('{v1}','1:0:0',{width:105,height:18})],[{width:240,height:400}]);
 const page=result.pages[0],output=(await inspect(result.bytes))[0];
 assert.equal(output.text,text.replace('{v1}',''));assert.equal(output.draws,1);inside(page);
 const formulas=page.rects.filter(({rect})=>Math.abs(rect.width*240/(rect.height*400)-105/18)<epsilon);
 assert.equal(formulas.length,1);assert.ok(formulas[0].rect.y>page.rects[0].rect.y,'the complete expression moves to the next line');
});

test('tall inline fractions reserve ascent and descent space without overlapping neighboring lines',async()=>{
 const text='前文'.repeat(18)+'{v1}'+'后文'.repeat(35),value=saved([part(text)]);
 const source=image('{v1}','1:0:0',{width:45,height:50,inline:{marker:'{v1}',baseline:32,fontSize:10}});
 const result=await buildTranslationPdf('行高',value,font,false,[source],[{width:240,height:400}]);
 const page=result.pages[0],formula=page.rects.find(({rect})=>Math.abs(rect.width*240/(rect.height*400)-45/50)<epsilon);
 assert.ok(formula);inside(page);assert.equal((await inspect(result.bytes))[0].text,text.replace('{v1}',''));
 const a=formula.rect;
 for(const other of page.rects)if(other!==formula){const b=other.rect;
  const intersect=Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)>epsilon&&Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)>epsilon;
  assert.equal(intersect,false,'formula raster cannot overlap another text rectangle');
 }
});

test('inline images in styled text and an oversized expression still fit one source-sized page intact',async()=>{
 const text='**前文** {v1} *中间* {v2} '+'长段落。'.repeat(350);
 const value=saved([part(text,'1:0:0',[descriptor(),descriptor('{v2}')])]),before=structuredClone(value);
 const sources=[image(),image('{v2}','1:0:0',{width:700,height:90,inline:{marker:'{v2}',baseline:60,fontSize:10}})];
 const result=await buildTranslationPdf('页内适配',value,font,false,sources,[{width:320,height:400}]);
 const output=await inspect(result.bytes);assert.equal(output.length,1);assert.deepEqual([output[0].width,output[0].height],[320,400]);
 assert.equal(output[0].draws,2);assert.equal(output[0].text.replace(/\s/g,''),'前文中间'+'长段落。'.repeat(350));inside(result.pages[0]);
 for(const source of sources)assert.equal(result.pages[0].rects.filter(({rect})=>Math.abs(rect.width*320/(rect.height*400)-source.width/source.height)<epsilon).length,1);
 assert.deepEqual(value,before);
});

test('inline markers remain scoped to each paragraph alongside an intact display equation',async()=>{
 const parts=[part('前文 {v1} 完整。','before'),{id:'equation',text:'旧公式碎片',rects:[{x:25,y:40,width:50,height:3}]},part('后文 {v1} 完整。','after')];
 parts[0].rects=[{x:10,y:20,width:80,height:1.3}];parts[2].rects=[{x:10,y:60,width:80,height:1.3}];
 const display={id:'display:1',page:1,partIds:['equation'],rect:parts[1].rects[0],png,width:180,height:25};
 const result=await buildTranslationPdf('混合公式',saved(parts),font,false,[image('{v1}','before'),display,image('{v1}','after',{width:50,height:18})],[{width:612,height:792}]);
 const page=result.pages[0],output=(await inspect(result.bytes))[0];
 assert.equal(output.draws,3);assert.equal(output.text,'前文  完整。后文  完整。');inside(page);
 assert.deepEqual(new Set(page.rects.map(value=>value.id)),new Set(['before','equation','after']));
 const ratios=[['before',30/18],['equation',180/25],['after',50/18]];
 for(const [id,ratio]of ratios)assert.equal(page.rects.filter(value=>value.id===id&&Math.abs(value.rect.width*612/(value.rect.height*792)-ratio)<epsilon).length,1);
});

test('missing, duplicate and mismatched inline images or markers fail explicitly instead of exporting raw markers',async()=>{
 const value=saved([part('正文 {v1} 结尾。')]);
 await assert.rejects(buildTranslationPdf('缺图',value,font,false),/行内公式图片尚未准备/);
 for(const source of [image('{v1}','wrong'),image('{v2}'),image('{v1}','1:0:0',{page:2}),image('{v1}','1:0:0',{inline:{marker:'{v1}',baseline:100,fontSize:10}})])
  await assert.rejects(buildTranslationPdf('错图',value,font,false,[source]),/行内公式图片与译文段落不匹配/);
 await assert.rejects(buildTranslationPdf('重复图片',value,font,false,[image(),{...image(),id:'duplicate'}]),/行内公式图片重复/);
 for(const text of ['正文结尾。','正文 {v1} {v1} 结尾。','正文 {v1} {v2} 结尾。'])
  await assert.rejects(buildTranslationPdf('损坏标记',saved([part(text)]),font,false,[image()]),/行内公式标记未完整保留/);
 const literal=saved([part('文字中的 {v1} 是示例标记。','1:0:0',[])]);
 assert.equal((await inspect((await buildTranslationPdf('普通文本',literal,font)).bytes))[0].text,'文字中的 {v1} 是示例标记。');
});
