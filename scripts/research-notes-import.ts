import type {PartialBlock} from '@blocknote/core';
import type {Board, Card} from '../app/canvas-model';
import type {PdfMark} from '../app/pdf-annotations';

export const researchFields=['文献','研究问题','理论','变量与假设','样本','量表来源','分析方法','主要结论','作者承认的局限','我能借用什么','我的研究和它的区别','我的疑问'] as const;
export const researchColors={theory:'#f5d84a',model:'#b196ee',method:'#64bfee',finding:'#77cd82',limitation:'#ee83af'};
const researchTextColors={theory:'yellow',model:'purple',method:'blue',finding:'green',limitation:'pink'};
const researchSectionColors=['#ffffff','#c4a5ed','#efa8c4','#8bd8ff','#b1f017','#c4a5ed'];
export const researchCategories={theory:'理论与概念',model:'变量与假设',method:'方法与测量',finding:'关键发现',limitation:'局限与启发'};
type Category=keyof typeof researchColors;
export type ResearchPaper={sourceName:string;shortTitle:string;bibliographic:string;rows:{field:string;value:string}[];highlights:{page:number;quote:string;category:Category;note:string;canvas:boolean;rects:{x:number;y:number;width:number;height:number}[]}[]};
export type ResearchNotesPlan={version:1;id:string;targetBoardId:string;targetBoardTitle:string;papers:ResearchPaper[]};

export function parseResearchNotesPlan(text:string):ResearchNotesPlan{
 if(text.length>3_000_000)throw new Error('研究笔记文件超过 3 MB。');
 const value=JSON.parse(text) as ResearchNotesPlan;
 const validText=(v:unknown,max:number)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
 if(value?.version!==1||!validText(value.targetBoardId,200)||!validText(value.targetBoardTitle,200)||!validText(value.id,80)||!/^[a-z0-9-]{6,80}$/.test(value.id)||!Array.isArray(value.papers)||value.papers.length<1||value.papers.length>12)throw new Error('研究笔记文件格式无效。');
 const names=new Set<string>();
 for(const paper of value.papers){
  if(!validText(paper.sourceName,250)||names.has(paper.sourceName)||!validText(paper.shortTitle,120)||!validText(paper.bibliographic,1000)||!Array.isArray(paper.rows)||paper.rows.length!==researchFields.length||paper.rows.some((row,i)=>row?.field!==researchFields[i]||!validText(row.value,6000))||!Array.isArray(paper.highlights)||paper.highlights.length<1||paper.highlights.length>80)throw new Error('文献记录不完整，或模板字段不匹配。');
  if(paper.highlights.filter(mark=>mark.canvas).length>6)throw new Error('每篇文献最多选择六条画板核心摘录。');
  names.add(paper.sourceName);
  for(const mark of paper.highlights){
   if(!Number.isInteger(mark.page)||mark.page<1||!validText(mark.quote,2500)||!validText(mark.note,6000)||!Object.hasOwn(researchColors,mark.category)||typeof mark.canvas!=='boolean'||!Array.isArray(mark.rects)||!mark.rects.length||mark.rects.length>100||mark.rects.some(rect=>!rect||![rect.x,rect.y,rect.width,rect.height].every(Number.isFinite)||rect.x<0||rect.y<0||rect.width<=0||rect.height<=0||rect.x+rect.width>100.05||rect.y+rect.height>100.05))throw new Error('PDF 批注缺少有效的页码或原文坐标。');
  }
 }
 return value;
}

export function prepareResearchNotes(board:Board,marks:Record<string,PdfMark[]>,plan:ResearchNotesPlan){
 if(board.id!==plan.targetBoardId||board.title!==plan.targetBoardTitle)throw new Error(`请先打开画板「${plan.targetBoardTitle}」。`);
 const prefix=`research-${plan.id}-`;
 if(board.cards.some(card=>card.id.startsWith(prefix)))throw new Error('这组研究笔记已经导入，未重复添加。');
 const sources=plan.papers.map(paper=>{
  const matches=board.cards.filter(card=>card.kind==='pdf'&&card.pdf&&(card.title===paper.sourceName||card.pdf.name.replace(/\.pdf$/i,'')===paper.sourceName));
  if(matches.length!==1)throw new Error(`无法唯一找到原文「${paper.sourceName}」。`);
  const source=matches[0];
  if(!source.pdf||paper.highlights.some(mark=>mark.page>source.pdf!.pages))throw new Error(`「${paper.sourceName}」的批注页码超出 PDF。`);
  return source;
 });
 const nextMarks=structuredClone(marks),cards=structuredClone(board.cards),edges=[...board.edges],sections=[...(board.sections||[])];
 const added:Card[]=[];
 let excerptCount=0,markCount=0;
 const dated={createdAt:new Date().toISOString(),creationDateSource:'actual' as const};
 const table=(rows:ResearchPaper['rows']):PartialBlock[]=>[{type:'table',content:{type:'tableContent',columnWidths:[145,465],rows:[{cells:['项目','记录']},...rows.map(row=>({cells:[row.field,row.value]}))]}}];
 plan.papers.forEach((paper,index)=>{
  const source=sources[index],x=(index%3)*2140,y=Math.floor(index/3)*2020;
  const stored=cards.find(card=>card.id===source.id)!;
  Object.assign(stored,{x:x+36,y:y+64,width:360});
  const summaryId=`${prefix}${index}-summary`;
  added.push({id:summaryId,title:`${index+1}. ${paper.shortTitle} · 文献笔记`,body:paper.rows.map(row=>`${row.field}：${row.value}`).join('\n\n'),blocks:table(paper.rows),x:x+1280,y:y+64,width:720,height:1790,kind:'note',...dated});
  let selected=0;
  for(const [markIndex,highlight] of paper.highlights.entries()){
   const mark:PdfMark={id:`${prefix}${index}-mark-${markIndex}`,text:highlight.quote,note:`【${researchCategories[highlight.category]}】${highlight.note}`,color:researchColors[highlight.category],fragments:[{page:highlight.page,rects:structuredClone(highlight.rects)}]};
   nextMarks[source.pdf!.url]=[...(nextMarks[source.pdf!.url]||[]).filter(item=>item.id!==mark.id),mark];markCount++;
   if(!highlight.canvas)continue;
   const excerptId=`${prefix}${index}-excerpt-${markIndex}`;
   added.push({id:excerptId,title:mark.text.replace(/\s+/g,' ').trim(),body:mark.note||'',kind:'note',x:x+450+(selected%2)*410,y:y+64+Math.floor(selected/2)*570,width:370,height:510,...dated,pdfExcerpt:{sourceId:source.id,sourceTitle:source.title,pdf:structuredClone(source.pdf!),mark:structuredClone(mark)}});
   edges.push({id:`${prefix}${index}-source-${markIndex}`,from:source.id,to:excerptId},{id:`${prefix}${index}-evidence-${markIndex}`,from:excerptId,to:summaryId});
   selected++;excerptCount++;
  }
  sections.push({id:`${prefix}${index}-section`,title:`0${index+1} · ${paper.shortTitle}`,x,y,width:2050,height:1900,color:researchSectionColors[index%6]});
  // Keep the translated counterpart next to its original, without changing its contents.
  const translated=cards.filter(card=>card.kind==='pdf'&&card.id!==source.id&&card.title.startsWith(paper.sourceName+' ·'));
  translated.forEach((card,i)=>Object.assign(card,{x:x+36,y:y+700+i*570,width:360}));
 });
 const sourceIds=new Set(sources.map(card=>card.id));
 const translatedIds=new Set(cards.filter(card=>card.kind==='pdf'&&plan.papers.some(paper=>card.title.startsWith(paper.sourceName+' ·'))).map(card=>card.id));
 const other=cards.filter(card=>!sourceIds.has(card.id)&&!translatedIds.has(card.id));
 other.forEach((card,index)=>Object.assign(card,{x:index*900,y:-850,width:card.kind==='text'?780:820,height:card.kind==='text'?170:660}));
 const legendRows=Object.entries(researchCategories).map(([key,label])=>({type:'paragraph' as const,content:[{type:'text' as const,text:`● ${label}`,styles:{textColor:researchTextColors[key as Category]}},{type:'text' as const,text:` · ${key==='theory'?'概念定义和理论框架':key==='model'?'变量、假设及机制路径':key==='method'?'样本、量表和分析方法':key==='finding'?'原文支持的关键结论':'作者局限与选题启发'}`,styles:{}}]}));
 added.push({id:`${prefix}guide`,title:'MBA 研究导航 · AI 信任与使用意愿',body:'PDF → 原文摘录 → 十二字段文献笔记。双击摘录可展开，使用「查看 PDF 原文」回到对应页码。\n\n文献结论与本人的研究建议已分别标注；六篇原文与英文论文译文均保留。',blocks:[{type:'paragraph',content:'阅读顺序：每组左侧为 PDF，中间为六条核心摘录，右侧为按原模板填写的完整文献笔记。'},...legendRows,{type:'paragraph',content:'摘录上的书本按钮可回到对应原文页码。所有原文批注可在 PDF 笔记栏查看。'}, {type:'paragraph',content:'下一步建议：比较 AI 信任的定义、使用意愿的阶段、变量测量与研究设计，再确定 MBA 论文的目标人群与使用情境。这里的选题建议属于待验证构想。'}],x:other.length*900,y:-850,width:1000,height:660,kind:'note',...dated});
 return {board:{...board,cards:[...cards,...added],edges,sections},marks:nextMarks,counts:{papers:plan.papers.length,marks:markCount,excerpts:excerptCount,notes:plan.papers.length,edges:excerptCount*2}};
}
