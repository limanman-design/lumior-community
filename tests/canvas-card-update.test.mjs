import test from 'node:test';
import assert from 'node:assert/strict';
import {patchCanvasCard} from '../app/canvas-card-update.ts';
import {createCanvasCardReferenceCache} from '../app/canvas-card-references.ts';

const note=(id,extra={})=>({id,kind:'note',title:id,body:'Original',x:40,y:80,width:420,...extra});
const board=(id,cards)=>({id,title:id,cards,edges:[],sections:[]});
const table=text=>[{id:'table',type:'table',content:{type:'tableContent',rows:Array.from({length:13},(_,index)=>({cells:[`Field ${index}`,text+index]}))}}];

test('52-card input reuses 51 cards and all large PDF metadata without serialization',()=>{
 let serialized=0;
 const metadata={url:'lumior-file:pdf',thumbnail:'x'.repeat(700_000),name:'Source.pdf',size:900_000,pages:20};
 Object.defineProperty(metadata,'toJSON',{value(){serialized++;throw new Error('Untouched PDF metadata was serialized');}});
 const original=board('research',Array.from({length:52},(_,index)=>note(`card-${index}`,index===51?{blocks:table('Original')}:{pdfExcerpt:{sourceId:'pdf',sourceTitle:'Source',pdf:metadata,mark:{id:`mark-${index}`,text:'Excerpt',color:'yellow',fragments:[]}}})));
 original.cards.forEach(Object.freeze);Object.freeze(original.cards);Object.freeze(original);
 const source=original.cards[51],blocks=table('信任');
 const cache=createCanvasCardReferenceCache(),beforeReferences=cache([original]);
 const next=patchCanvasCard(original,source.id,{blocks,body:'信任'},[original]);
 assert.equal(serialized,0);
 assert.equal(next.board.cards.filter((card,index)=>card!==original.cards[index]).length,1);
 assert.equal(next.board.cards[51].blocks,blocks);
 assert.equal(source.body,'Original');
 assert.equal(source.blocks[0].content.rows[0].cells[1],'Original0');
 const afterReferences=cache(next.boards);
 for(const card of original.cards)assert.equal(afterReferences.get(card.id),beforeReferences.get(card.id));
 assert.equal(next.board.edges,original.edges);
 assert.equal(next.board.sections,original.sections);
});

test('content synchronizes immediately to every reference while geometry and untouched captions stay local',()=>{
 const pdf={url:'file:old',thumbnail:'preview',name:'old.pdf',size:1,pages:1};
 const first=board('first',[note('source',{pdf}),note('same-board-copy',{sharedId:'source',body:'Caption',x:900})]);
 const second=board('second',[note('translated',{sharedId:'source',body:'Translated caption',title:'Translation',x:300,y:800,width:600,pdf})]);
 const untouched=board('third',[note('independent')]);
 const replacement={...pdf,url:'file:new'};
 const next=patchCanvasCard(first,'source',{pdf:replacement},[first,second,untouched]);
 assert.equal(next.boards[1].cards[0].pdf,replacement);
 assert.equal(next.boards[1].cards[0].body,'Translated caption');
 assert.equal(next.boards[1].cards[0].title,'Translation');
 assert.equal(next.boards[1].cards[0].x,300);
 assert.equal(next.boards[1].cards[0].width,600);
 assert.equal(next.board.cards[1].body,'Caption');
 assert.equal(next.boards[2],untouched);
 const blocks=table('Edited');
 const edited=patchCanvasCard(next.board,'source',{body:'Edited',blocks},next.boards);
 for(const shared of [edited.board.cards[0],edited.board.cards[1],edited.boards[1].cards[0]]){
  assert.equal(shared.body,'Edited');assert.equal(shared.blocks,blocks);
 }
 assert.equal(second.cards[0].pdf,pdf);
 assert.equal(first.cards[0].body,'Original');
});

test('geometry stays local, no-op patches create no history candidate, and previous document snapshots remain intact',()=>{
 const initial=board('one',[note('source',{blocks:table('Original')})]);
 const elsewhere=board('two',[note('reference',{sharedId:'source',x:600,width:500})]);
 const stored=[initial,elsewhere];
 assert.deepEqual(patchCanvasCard(initial,'missing',{body:'unused'},stored),{board:initial,boards:stored});
 assert.deepEqual(patchCanvasCard(initial,'source',{body:'Original',blocks:initial.cards[0].blocks},stored),{board:initial,boards:stored});
 const resized=patchCanvasCard(initial,'source',{width:800,height:400},stored);
 assert.equal(resized.boards[1],elsewhere);
 const versions=[resized.board];
 let current=resized;
 for(const text of ['信','信任','信任与使用意愿']){
  current=patchCanvasCard(current.board,'source',{blocks:table(text),body:text},current.boards);
  versions.push(current.board);
 }
 assert.deepEqual(versions.map(version=>version.cards[0].body),['Original','信','信任','信任与使用意愿']);
 assert.equal(versions[0].cards[0].blocks[0].content.rows[0].cells[1],'Original0');
 // Reapplying the saved document updates references without changing geometry.
 const undone=patchCanvasCard(current.board,'source',{blocks:versions[1].cards[0].blocks,body:versions[1].cards[0].body},current.boards);
 assert.equal(undone.board.cards[0].blocks,versions[1].cards[0].blocks);
 assert.equal(undone.boards[1].cards[0].body,'信');
 assert.equal(undone.board.cards[0].width,800);
 assert.equal(undone.boards[1].cards[0].width,500);
});
