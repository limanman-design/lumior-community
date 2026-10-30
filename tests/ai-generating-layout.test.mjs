import test from 'node:test';
import assert from 'node:assert/strict';
import { placeGeneratingCard, generatingCardView, generatingCardSize } from '../app/ai-generating-layout.ts';
import { importedMediaGap } from '../app/imported-media-layout.ts';
const card = (id, x, y, width=360, height=300, kind='note') => ({id,x,y,width,height,kind,title:id,body:'body'});
const overlap = (a,b) => a.x < b.x+b.width && a.x+a.width > b.x && a.y < b.y+b.height && a.y+a.height > b.y;

test('empty canvas centers a temporary card without moving stored content', () => {
 assert.deepEqual(placeGeneratingCard({x:400,y:300},[]),{x:220,y:190});
});
test('temporary card avoids AI cards, measured tall cards and further rows with a gap', () => {
 const cards=[card('ai-note:old:new:1',220,190),card('tall',210,510),card('next',230,1200)];
 const before=JSON.stringify(cards), heights={tall:650};
 const point=placeGeneratingCard({x:400,y:300},cards,heights);
 for(const item of cards){
  const occupied={x:item.x-importedMediaGap,y:item.y-24-importedMediaGap,width:item.width+2*importedMediaGap,height:(heights[item.id]||item.height)+24+2*importedMediaGap};
  assert.equal(overlap({...point,...generatingCardSize},occupied),false);
 }
 assert.equal(JSON.stringify(cards),before);
 assert.ok(point.y>=1532);
});
test('a free position beside existing cards is retained and headings are reserved', () => {
 const far=card('far',1000,0);
 assert.deepEqual(placeGeneratingCard({x:400,y:300},[far]),{x:220,y:190});
 const heading=card('pdf',220,430,360,510,'pdf');
 const point=placeGeneratingCard({x:400,y:300},[heading]);
 assert.ok(point.y>=heading.y+heading.height+importedMediaGap);
});
test('negative positions, absent measurements and a dense stack still find an unoccupied location', () => {
 const cards=Array.from({length:100},(_,index)=>card(String(index),-200,index*330-1000));
 const point=placeGeneratingCard({x:-20,y:-800},cards);
 assert.ok(point.y>=cards.at(-1).y+cards.at(-1).height+importedMediaGap);
});
test('first-stage camera shows a distant temporary card above the dialog, including narrow boards', () => {
 const point={x:18000,y:42000};
 for(const available of [{width:1100,bottom:360},{width:420,bottom:230},{width:200,bottom:160}]){
  const view=generatingCardView(point,available);
  const left=point.x*view.zoom+view.x,top=point.y*view.zoom+view.y;
  assert.ok(left>=0&&left+generatingCardSize.width*view.zoom<=available.width);
  assert.ok(top>=64&&top+generatingCardSize.height*view.zoom<=available.bottom);
 }
});
