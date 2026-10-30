import test from 'node:test';
import assert from 'node:assert/strict';
import {canvasAiSuggestions} from '../app/ai-canvas-suggestions.ts';
const card=id=>({id,kind:'note',title:id,body:'Readable material',x:0,y:0,width:360});
test('explicit references outrank selection, selected references stay exact, missing references never widen',()=>{
 const cards=[card('a'),card('b'),card('c')],before=JSON.stringify(cards);
 assert.deepEqual(canvasAiSuggestions(cards,['a'],['b','c'],new Map())[0].refs,['a']);
 assert.deepEqual(canvasAiSuggestions(cards,[],['b','c'],new Map())[0].refs,['b','c']);
 assert.deepEqual(canvasAiSuggestions(cards,['missing'],[],new Map()),[]);assert.equal(JSON.stringify(cards),before);
});
test('suggestions reflect readable materials and only offer implemented operations',()=>{
 const empty=canvasAiSuggestions([],[],[],new Map());assert.equal(empty[0].action,'import');assert.match(empty[1].prompt[1],/创建三张/);
 const image={...card('image'),kind:'image'};assert.deepEqual(canvasAiSuggestions([image],[],[],new Map()).map(item=>item.id),['import']);
 const pdf={...card('pdf'),kind:'pdf'};
 assert.deepEqual(canvasAiSuggestions([pdf],[],[],new Map()).map(item=>item.id),['import']);
 const ready=new Map([['pdf',{status:'ready',document:{chunks:[{text:'Text'}],emptyPages:[]}}]]);
 assert.equal(canvasAiSuggestions([pdf],[],[],ready)[0].id,'summary');
 assert.equal(canvasAiSuggestions([card('a'),card('b')],[],[],new Map()).length,3);
 assert.ok(canvasAiSuggestions([card('a'),card('b')],[],[],new Map()).every(item=>item.prompt?.[1].includes('不')));
});
test('grouping, layout and structure suggestions respect readable scope and explicit selection',()=>{
 const cards=[card('a'),card('b'),card('c')];
 assert.equal(canvasAiSuggestions(cards,[],[],new Map())[0].id,'group');
 assert.ok(canvasAiSuggestions(cards,[],['a','b'],new Map()).some(item=>item.id==='arrange'&&item.refs.join(',')==='a,b'));
 assert.ok(canvasAiSuggestions(cards.slice(0,2),[],[],new Map()).some(item=>item.id==='structure'));
 assert.match(canvasAiSuggestions([],[],[],new Map())[1].prompt[1],/分区/);
 const unreadable=cards.map(item=>({...item,kind:'image'}));
 assert.deepEqual(canvasAiSuggestions(unreadable,[],[],new Map()).map(item=>item.id),['arrange','import']);
});
