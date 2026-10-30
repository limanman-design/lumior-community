import test from 'node:test';
import assert from 'node:assert/strict';
import {canvasCardReferences,createCanvasCardReferenceCache} from '../app/canvas-card-references.ts';

const card=(id,sharedId)=>({id,sharedId,kind:'note',title:id,body:'',x:0,y:0,width:400});
test('reference index preserves board order and the first local instance of each identity',()=>{
 const boards=[
  {id:'one',title:'Board one',cards:[card('first','shared'),card('duplicate','shared'),card('solo')],edges:[]},
  {id:'two',title:'Board two',cards:[card('second','shared')],edges:[]},
 ];
 const references=canvasCardReferences(boards);
 assert.deepEqual(references.get('shared'),[{id:'one',title:'Board one',cardId:'first'},{id:'two',title:'Board two',cardId:'second'}]);
 assert.deepEqual(references.get('solo'),[{id:'one',title:'Board one',cardId:'solo'}]);
 assert.equal(references.get('absent'),undefined);
 assert.deepEqual(boards[0].cards.map(card=>card.id),['first','duplicate','solo']);
});

test('cached location lists survive content edits but update for board names, additions and removals',()=>{
 const cache=createCanvasCardReferenceCache();
 const one={id:'one',title:'Board',cards:[card('original'),card('other')],edges:[]};
 const initial=cache([one]);
 const content=cache([{...one,cards:one.cards.map(c=>c.id==='original'?{...c,body:'Edited'}:c)}]);
 assert.equal(content.get('original'),initial.get('original'));
 assert.equal(content.get('other'),initial.get('other'));
 const renamed=cache([{...one,title:'Renamed'}]);
 assert.notEqual(renamed.get('original'),content.get('original'));
 assert.equal(renamed.get('original')[0].title,'Renamed');
 const added=cache([{...one,title:'Renamed'},{id:'two',title:'Second',cards:[card('reference','original')],edges:[]}]);
 assert.equal(added.get('original').length,2);
 assert.equal(added.get('other'),renamed.get('other'));
 const removed=cache([{...one,title:'Renamed',cards:[one.cards[1]]}]);
 assert.equal(removed.get('original'),undefined);
 assert.equal(removed.get('other'),added.get('other'));
});

test('independent duplicates retain their local identities',()=>{
 const references=canvasCardReferences([{id:'one',title:'Board',cards:[card('original'),card('copy')],edges:[]}]);
 assert.equal(references.size,2);
 assert.equal(references.get('original')[0].cardId,'original');
 assert.equal(references.get('copy')[0].cardId,'copy');
});
