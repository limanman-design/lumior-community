import test from 'node:test';
import assert from 'node:assert/strict';
import {CardDocumentEcho} from '../app/card-document-echo.ts';
const card=(body,blocks)=>({body,blocks,image:undefined,detail:undefined});
const document=text=>[{id:'table',type:'table',content:{type:'tableContent',rows:Array.from({length:13},(_,index)=>({cells:[`Field ${index}`,text]}))}}];

test('own Chinese composition snapshots remain immediate echoes and never request editor replacement',()=>{
 const echo=new CardDocumentEcho();
 const original=document('Original');
 assert.equal(echo.receive(card('Original',original)),true);
 assert.equal(echo.receive(card('Original',original)),false);
 for(const text of ['x','xin','信','信任','信任与使用意愿']){
  const blocks=document(text);
  echo.local(blocks,text);
  assert.equal(echo.receive(card(text,blocks)),false);
 }
});

test('external undo and changes from another view apply once while title/geometry updates leave selection alone',()=>{
 const echo=new CardDocumentEcho(),original=document('Original'),edited=document('Edited');
 echo.receive(card('Original',original));
 echo.local(edited,'Edited');
 assert.equal(echo.receive({...card('Edited',edited),title:'Renamed',width:800}),false);
 assert.equal(echo.receive(card('Original',original)),true);
 assert.equal(echo.receive(card('Original',original)),false);
 const pinned=document('Pinned change');
 assert.equal(echo.receive(card('Pinned change',pinned)),true);
 assert.equal(echo.receive(card('Pinned change',pinned)),false);
});

test('canonical clones of the same document do not replace the editor or interrupt composition',()=>{
 const echo=new CardDocumentEcho();
 for(const text of ['x','xin','信','信任','信任与使用意愿']){
  const blocks=document(text);
  echo.local(blocks,text);
  const canonical=structuredClone(blocks);
  assert.equal(echo.receive(card(text,canonical)),false);
  assert.equal(echo.receive({...card(text,canonical),title:'Renamed'}),false);
 }
 const changed=document('External edit');
 assert.equal(echo.receive(card('External edit',changed)),true);
 assert.equal(echo.receive(card('External edit',structuredClone(changed))),false);
});

test('formatting-only external changes still replace content even when the body cache is identical',()=>{
 const echo=new CardDocumentEcho();
 const blocks=[{id:'paragraph',type:'paragraph',content:[{type:'text',text:'Same words',styles:{}}]}];
 echo.local(blocks,'Same words');
 const formatted=structuredClone(blocks);
 formatted[0].content[0].styles.bold=true;
 assert.equal(echo.receive(card('Same words',formatted)),true);
 assert.equal(echo.receive(card('Same words',structuredClone(formatted))),false);
});

test('plain body, image and detail updates retain the existing document precedence',()=>{
 const echo=new CardDocumentEcho();
 assert.equal(echo.receive(card('Markdown body',undefined)),true);
 assert.equal(echo.receive(card('Markdown body',[])),false);
 assert.equal(echo.receive({...card('Markdown body',[]),image:'image.png'}),true);
 assert.equal(echo.receive({...card('Markdown body',[]),image:'image.png',detail:'Details'}),true);
 const blocks=document('Canonical blocks');
 echo.local(blocks,'Canonical blocks');
 assert.equal(echo.receive({...card('Different body cache',blocks),image:'image.png',detail:'Details'}),false);
 assert.equal(new CardDocumentEcho().receive(card('Canonical blocks',blocks)),true);
});
