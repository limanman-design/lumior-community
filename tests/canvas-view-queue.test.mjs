import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvasViewQueue} from '../app/canvas-view-queue.ts';

function fixture(){
 let current={x:0,y:0,zoom:1.2},id=0;
 const frames=new Map(),rendered=[];
 const queue=createCanvasViewQueue(()=>current,view=>{current=view;},view=>rendered.push(view),callback=>{frames.set(++id,callback);return id;},frame=>frames.delete(frame));
 return {queue,frames,rendered,current:()=>current,paint:()=>{const callbacks=[...frames.values()];frames.clear();callbacks.forEach(callback=>callback());}};
}

test('many pan inputs update gesture coordinates immediately but render once per frame',()=>{
 const f=fixture();
 for(let i=0;i<200;i++)f.queue.queue(view=>({...view,x:view.x+2,y:view.y-1}));
 assert.deepEqual(f.current(),{x:400,y:-200,zoom:1.2});
 assert.equal(f.frames.size,1);
 assert.equal(f.rendered.length,0);
 f.paint();
 assert.deepEqual(f.rendered,[f.current()]);
 f.queue.queue(view=>({...view,x:view.x+3}));
 f.paint();
 assert.equal(f.rendered.length,2);
 assert.equal(f.current().x,403);
});

test('programmatic focus and final pointer-up supersede the queued gesture frame',()=>{
 const f=fixture();
 f.queue.queue({x:400,y:200,zoom:1.2});
 f.queue.set(view=>({...view,x:500,zoom:.6}));
 assert.equal(f.frames.size,0);
 f.paint();
 assert.deepEqual(f.rendered,[{x:500,y:200,zoom:.6}]);
 f.queue.queue({x:600,y:240,zoom:.6});
 f.queue.set({x:610,y:250,zoom:.6});
 f.paint();
 assert.deepEqual(f.rendered.at(-1),{x:610,y:250,zoom:.6});
 assert.equal(f.rendered.length,2);
});

test('cancelled gestures restore their starting view and disposal leaves no delayed render',()=>{
 const f=fixture(),start=f.current();
 f.queue.queue({x:120,y:340,zoom:1.2});
 f.queue.set(start);
 f.paint();
 assert.deepEqual(f.current(),start);
 assert.deepEqual(f.rendered,[start]);
 f.queue.queue({x:900,y:700,zoom:1.2});
 f.queue.cancel();
 f.paint();
 assert.equal(f.rendered.length,1);
});
