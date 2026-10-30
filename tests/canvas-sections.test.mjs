import test from 'node:test';
import assert from 'node:assert/strict';
import { removeSection, resizeSection } from '../app/canvas-sections.ts';

test('deleting a section removes only its frame and preserves cards, edges and prior snapshots', () => {
  const cards = [{ id: 'inside', x: 20, y: 20 }, { id: 'outside', x: 1000, y: 1000 }];
  const edges = [{ id: 'edge', from: 'inside', to: 'outside' }];
  const sections = [{ id: 'a', title: 'A', x: 0, y: 0, width: 500, height: 500 }, { id: 'b', title: 'B' }];
  const before = { id: 'board', title: 'Board', cards, edges, sections };
  const after = removeSection(before, 'a');
  assert.deepEqual(after.sections, [sections[1]]);
  assert.equal(after.cards, cards);
  assert.equal(after.edges, edges);
  assert.equal(before.sections.length, 2);
  assert.equal(removeSection(after, 'missing'), after);
  assert.equal(removeSection({ ...before, sections: undefined }, 'a').cards, cards);
});

test('section edge resize anchors the opposite edge without moving or scaling contents', () => {
  const section = {id:'frame',title:'Research',x:100,y:200,width:500,height:400};
  const before = {id:'board',title:'Board',cards:[{id:'note',x:120,y:230,width:200}],edges:[],sections:[section]};
  const left = resizeSection(before,'frame','left',90,123).sections[0];
  assert.deepEqual([left.x,left.width,left.y,left.height],[190,410,200,400]);
  assert.equal(left.x+left.width,section.x+section.width);
  const top = resizeSection(before,'frame','top',99,-100).sections[0];
  assert.deepEqual([top.x,top.width,top.y,top.height],[100,500,100,500]);
  assert.equal(top.y+top.height,section.y+section.height);
  const right=resizeSection(before,'frame','right',140,321);
  assert.equal(right.sections[0].width,640);
  assert.equal(right.cards,before.cards);
  assert.equal(right.edges,before.edges);
  const bottom=resizeSection(before,'frame','bottom',100,80);
  assert.equal(bottom.sections[0].height,480);
  assert.deepEqual(before.sections,[section]);
});

test('section cannot invert while crossing its opposite side; invalid and missing targets are unchanged',()=>{
  const before={id:'board',title:'Board',cards:[],edges:[],sections:[{id:'a',x:0,y:0,width:200,height:200}]};
  for(const edge of ['left','right','top','bottom']){
    const result=resizeSection(before,'a',edge,edge==='right'?-1000:1000,edge==='bottom'?-1000:1000).sections[0];
    assert.ok(result.width>=80&&result.height>=80);
    if(edge==='left')assert.equal(result.x+result.width,200);
    if(edge==='top')assert.equal(result.y+result.height,200);
  }
  assert.equal(resizeSection(before,'missing','left',10,0),before);
  assert.equal(resizeSection(before,'a','left',NaN,0),before);
});
