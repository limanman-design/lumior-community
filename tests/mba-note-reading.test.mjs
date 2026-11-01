import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareAiContext } from '../app/prepare-ai-context.ts';
import { prepareAiNotes } from '../app/prepare-ai-notes.ts';
import { prepareThesisNotes } from '../app/prepare-thesis-notes.ts';
import { noteMarkdown } from '../app/note-markdown.ts';
import { readStoredDocument } from '../app/stored-document.ts';
import { enableBoardThesis, createThesisArtifact, setThesisSource, thesisInputSignature, thesisCardMarkdown, boardThesisSnapshot, resolveThesisProposal, applyThesisResult } from '../app/thesis-board.ts';
const note = (id, extra = {}) => ({ id, kind: 'note', title: id, body: 'plain fallback', x: 0, y: 0, width: 300, ...extra });
const signal = () => new AbortController().signal;
const blocks = [
 {type:'heading',props:{level:2},content:'Research'},
 {type:'paragraph',content:[{type:'link',href:'https://example.org/paper',content:[{type:'text',text:'Evidence',styles:{bold:true}}]}]},
 {type:'checkListItem',props:{checked:true},content:'Read'},
 {type:'codeBlock',props:{language:'js'},content:'const value = 1;'},
 {type:'quote',content:'Quoted source',children:[{type:'bulletListItem',content:'Nested'}]},
 {type:'table',content:{rows:[{cells:['Author','Finding']},{cells:['A','B']}]}}
];
const boardWith = cards => {
 let b=enableBoardThesis({id:'board',title:'Test',cards,edges:[]});
 for(const card of cards.filter(c=>c.id!=='unrelated')) b=setThesisSource(b,card.id,'material');
 return b;
};
void test('MBA and ordinary AI consume the same rich note text without changing cards',async()=>{
 const card=note('rich',{blocks}), b=boardWith([card]);const before=JSON.stringify(b);
 const {texts}=await prepareThesisNotes(b,'mba-topic',signal());
 const ordinary=await prepareAiContext(b.cards,['rich'],'',signal());
 assert.equal(texts.get('rich'),noteMarkdown(card));
 assert.equal(ordinary.sources[0].text,`${card.title}\n${texts.get('rich')}`);
 for(const expected of ['[**Evidence**](https://example.org/paper)','- [x] Read','```js','| Author | Finding |','- Nested'])assert.ok(texts.get('rich').includes(expected),expected);
 assert.equal(JSON.stringify(b),before);
});
void test('shared imported notes read the edited internal document, not the title or original file; neither path writes',async()=>{
 const card=note('imported',{sharedId:'shared',body:'',storedDocument:{version:1,source:'lumior-file:original',document:'lumior-file:edited',libraryId:'vault',path:'source.md'}});
 const b=boardWith([card,note('unrelated',{storedDocument:{...card.storedDocument,document:'lumior-file:other'}})]);const before=JSON.stringify(b);const reads=[];
 const deps={readNote:(c,{signal})=>readStoredDocument(c,{signal,getFile:async id=>{reads.push(id);assert.equal(id,'edited');return {id,blob:new Blob([JSON.stringify({version:1,body:'Edited latest evidence',blocks:[]})])};},putFile:async()=>assert.fail('reading must not write')})};
 const mba=await prepareThesisNotes(b,'mba-topic',signal(),undefined,deps);
 const ordinary=await prepareAiContext(b.cards,['imported'],'',signal(),undefined,deps);
 assert.equal(mba.texts.get('imported'),'Edited latest evidence');assert.equal(ordinary.sources[0].text,'imported\nEdited latest evidence');
 assert.deepEqual(reads,['edited','edited']);assert.equal(JSON.stringify(b),before);assert.equal(mba.texts.has('unrelated'),false);
});
void test('missing files, cancellation and oversized input fail without silently truncating or mutating',async()=>{
 const b=boardWith([note('stored',{storedDocument:{source:'lumior-file:a'}})]);const before=JSON.stringify(b);
 await assert.rejects(prepareThesisNotes(b,'mba-lit',signal(),undefined,{readNote:async()=>{throw Error('missing source');}}),/missing source/);
 const controller=new AbortController();await assert.rejects(prepareThesisNotes(b,'mba-lit',controller.signal,undefined,{readNote:async c=>{controller.abort();return {...c,body:'cancelled'};}}),{name:'AbortError'});
 await assert.rejects(prepareAiNotes(b.cards,signal(),undefined,{readNote:async c=>({...c,body:'x'.repeat(12*1024*1024)})}),/未截断正文/);
 assert.equal(JSON.stringify(b),before);
});
void test('artifact exports use shared Markdown while old proposals retain their legacy comparison format',async()=>{
 const b=createThesisArtifact(enableBoardThesis({id:'b',title:'B',cards:[],edges:[]}),'thesis/lit-matrix.md');
 b.cards[0]={...b.cards[0],blocks};const c=b.cards[0];
 b.thesis.proposals['thesis/lit-matrix.md']={path:'thesis/lit-matrix.md',text:'old saved working draft',base:`${c.title}\n${thesisCardMarkdown(c)}`,topicVersion:0,at:1};
 assert.ok(boardThesisSnapshot(b,'mba-review').files['thesis/lit-matrix.md'].text.includes('https://example.org/paper'));
 assert.equal((await prepareThesisNotes(b,'mba-lit',signal())).snapshot.files['thesis/lit-matrix.md'].text,'old saved working draft');
 assert.equal(resolveThesisProposal(b,'thesis/lit-matrix.md',true).cards[0].body,'old saved working draft');
 assert.equal(b.cards[0].blocks,blocks);
});
void test('link-only and stored revision edits invalidate in-flight input; geometry changes do not',()=>{
 const b=boardWith([note('rich',{blocks}),note('stored',{storedDocument:{source:'lumior-file:a'}})]);const key=thesisInputSignature(b);
 let next=structuredClone(b);next.cards[0].blocks[1].content[0].href='https://example.org/other';assert.notEqual(thesisInputSignature(next),key);
 next=structuredClone(b);next.cards[1].storedDocument.document='lumior-file:new';assert.notEqual(thesisInputSignature(next),key);
 next=structuredClone(b);next.cards[0].x=100;assert.equal(thesisInputSignature(next),key);
});
void test('returning an unchanged rich artifact does not create a replacement suggestion',async()=>{
 const path='thesis/lit-matrix.md';
 const b=createThesisArtifact(enableBoardThesis({id:'b',title:'B',cards:[],edges:[]}),path);
 b.cards[0]={...b.cards[0],blocks};const before=JSON.stringify(b);
 const {snapshot}=await prepareThesisNotes(b,'mba-lit',signal());
 const next=applyThesisResult(b,thesisInputSignature(b),{snapshot,changed:[path],session:{id:'chat',skill:'mba-lit',messages:[]}},'chat');
 assert.equal(next.thesis.proposals[path],undefined);
 assert.equal(JSON.stringify(b),before);
 assert.deepEqual(next.cards,b.cards);
});
