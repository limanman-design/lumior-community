import test from 'node:test';
import assert from 'node:assert/strict';
import {imageRotationTransform} from '../app/image-rotation.ts';
import {patchCanvasCard} from '../app/canvas-card-update.ts';
void test('legacy and invalid angles leave originals unchanged',()=>{
 for(const angle of [undefined,0,360,NaN,Infinity]) assert.equal(imageRotationTransform(angle,2),undefined);
});
void test('all 45-degree orientations fit wide and tall image bounds without clipping',()=>{
 for(const ratio of [.1,.5,1,2,10]) for(let angle=45;angle<360;angle+=45){
  const transform=imageRotationTransform(angle,ratio);const scale=Number(transform.match(/scale\((.+)\)/)[1]);
  const radians=angle*Math.PI/180;const c=Math.abs(Math.cos(radians)),s=Math.abs(Math.sin(radians));
  assert.ok(scale*(ratio*c+s)<=ratio+1e-9);assert.ok(scale*(ratio*s+c)<=1+1e-9);
 }
});
void test('rotation synchronizes shared image references without changing original bytes or undo snapshot',()=>{
 const image={id:'a',sharedId:'image',kind:'image',title:'Image',body:'',image:'lumior-file:original',x:0,y:0,width:400};
 const a={id:'one',title:'One',cards:[image],edges:[]},b={id:'two',title:'Two',cards:[{...image,id:'b'}],edges:[]};
 const updated=patchCanvasCard(a,'a',{imageRotation:315},[a,b]);
 assert.equal(updated.board.cards[0].imageRotation,315);assert.equal(updated.boards[1].cards[0].imageRotation,315);
 assert.equal(updated.boards[1].cards[0].image,image.image);assert.equal(image.imageRotation,undefined);
 assert.equal(JSON.parse(JSON.stringify(updated.board)).cards[0].imageRotation,315);
});
