import test from 'node:test';
import assert from 'node:assert/strict';
import {parseResearchNotesPlan,prepareResearchNotes,researchFields} from '../scripts/research-notes-import.ts';
const plan=()=>({version:1,id:'test-research-2026',targetBoardId:'board',targetBoardTitle:'MBA 测试',papers:[{sourceName:'论文',shortTitle:'信任',bibliographic:'作者（2026）',rows:researchFields.map(field=>({field,value:`${field}原文记录`})),highlights:[{page:2,quote:'准确的原文摘录',category:'finding',note:'原文发现',canvas:true,rects:[{x:10,y:30,width:40,height:2}]}]}]});
const source={id:'pdf',kind:'pdf',title:'论文',body:'保留正文',x:40,y:60,width:400,pdf:{url:'blob:paper',name:'论文.pdf',size:100,pages:3,thumbnail:'cover'}};
const original={id:'board',title:'MBA 测试',cards:[source,{id:'template',kind:'note',title:'笔记模板',body:'用户原有模板',blocks:[{type:'paragraph',content:'保留模板'}],x:50,y:50,width:400}],edges:[{id:'existing',from:'pdf',to:'template'}]};
test('adds sourced excerpts and a complete template note while preserving existing records',()=>{
 const marks={'blob:paper':[{id:'user-mark',text:'原有批注',color:'#ee83af',fragments:[{page:1,rects:[{x:20,y:20,width:20,height:2}]}]}]};
 const before=structuredClone({original,marks});
 const result=prepareResearchNotes(original,marks,parseResearchNotesPlan(JSON.stringify(plan())));
 assert.deepEqual({original,marks},before);
 assert.equal(result.marks['blob:paper'][0].id,'user-mark');
 assert.deepEqual(result.board.cards.find(c=>c.id==='pdf').pdf,source.pdf);
 assert.equal(result.board.cards.find(c=>c.id==='template').body,'用户原有模板');
 assert.deepEqual(result.board.edges[0],original.edges[0]);
 const excerpt=result.board.cards.find(c=>c.pdfExcerpt);
 assert.equal(excerpt.pdfExcerpt.sourceId,'pdf');
 assert.equal(excerpt.pdfExcerpt.mark.fragments[0].page,2);
 assert.equal(result.board.cards.find(c=>c.id.endsWith('summary')).blocks[0].content.rows.length,13);
 assert.deepEqual(result.counts,{papers:1,marks:1,excerpts:1,notes:1,edges:2});
 assert.throws(()=>prepareResearchNotes(result.board,result.marks,plan()),/已经导入/);
});
test('fails before mutation on wrong board, ambiguous sources, or out of range pages',()=>{
 assert.throws(()=>prepareResearchNotes({...original,title:'别的画板'},{},plan()),/请先打开/);
 assert.throws(()=>prepareResearchNotes({...original,id:'same-title-different-board'},{},plan()),/请先打开/);
 assert.throws(()=>prepareResearchNotes({...original,cards:[...original.cards,{...source,id:'duplicate'}]},{},plan()),/唯一/);
 const invalid=plan();invalid.papers[0].highlights[0].page=4;
 assert.throws(()=>prepareResearchNotes(original,{},invalid),/页码超出/);
});
test('rejects missing provenance, unsupported categories and malformed template content',()=>{
 for(const mutate of [p=>p.papers[0].highlights[0].rects=[],p=>p.papers[0].highlights[0].rects[0].width=110,p=>p.papers[0].highlights[0].category='fake',p=>p.papers[0].rows.pop(),p=>p.papers[0].rows[0].value='']){
  const invalid=plan();mutate(invalid);assert.throws(()=>parseResearchNotesPlan(JSON.stringify(invalid)));
 }
});
test('future imports use normal UI connection, section, editor and PDF styles',()=>{
 const translated={...source,id:'translated',title:'论文 · 中文译文',pdf:{...source.pdf,name:'论文 · 中文译文.pdf'}};
 const result=prepareResearchNotes({...original,cards:[...original.cards,translated]},{},plan());
 const added=result.board.edges.filter(edge=>edge.id!=='existing');
 assert.equal(added.length,2);
 assert(added.every(edge=>!Object.hasOwn(edge,'color')&&!Object.hasOwn(edge,'label')));
 assert(result.board.sections.every(section=>['#ffffff','#8bd8ff','#c4a5ed','#b1f017','#f5be92','#efa8c4'].includes(section.color)));
 const guide=result.board.cards.find(card=>card.id.endsWith('-guide'));
 assert.deepEqual(guide.blocks.slice(1,6).map(block=>block.content[0].styles.textColor),['yellow','purple','blue','green','pink']);
 assert.equal(result.board.cards.find(card=>card.id==='pdf').width,360);
 assert.equal(result.board.cards.find(card=>card.id==='translated').width,360);
 assert.equal(result.marks['blob:paper'][0].color,'#77cd82');
});
