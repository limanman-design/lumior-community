import test from 'node:test';
import assert from 'node:assert/strict';
import {CANVAS_ZOOM_BASE,CANVAS_ZOOM_MIN,CANVAS_ZOOM_MAX,CANVAS_ZOOM_GAIN,CANVAS_ZOOM_STEP,canvasWheelZoom,canvasZoomPercent,toWorld,zoomAt} from '../app/canvas-zoom.ts';

test('displayed 100% makes cards twenty percent larger without changing world dimensions',()=>{
 assert.equal(CANVAS_ZOOM_BASE,1.2);
 assert.equal(360*CANVAS_ZOOM_BASE,432);
 assert.equal(canvasZoomPercent(CANVAS_ZOOM_BASE),100);
 assert.equal(canvasZoomPercent(.6),50);
 assert.equal(canvasZoomPercent(2.4),200);
});

test('pinch and command-wheel sensitivity and frame caps increase twenty percent',()=>{
 for(const pinch of [true,false]){
  const oldBoost=1.1*1.05;
  const previousSensitivity=(pinch?.0054:.0036*1.1)*1.32*oldBoost;
  const previousCap=(pinch?.0792:.08712)*oldBoost;
  const next=canvasWheelZoom(-10,0,600,pinch);
  assert.ok(Math.abs(next.change/previousSensitivity/10-1.2)<1e-12);
  assert.ok(Math.abs(next.cap/previousCap-1.2)<1e-12);
  assert.equal(canvasWheelZoom(10,0,600,pinch).change,-next.change);
  assert.deepEqual(canvasWheelZoom(-1,1,600,pinch),canvasWheelZoom(-16,0,600,pinch));
  assert.deepEqual(canvasWheelZoom(-1,2,600,pinch),canvasWheelZoom(-80,0,600,pinch));
  assert.deepEqual(canvasWheelZoom(-500,0,600,pinch),canvasWheelZoom(-80,0,600,pinch));
 }
});

test('keyboard and button steps share the logarithmic gesture gain and remain reversible',()=>{
 assert.equal(CANVAS_ZOOM_GAIN,1.2);
 assert.ok(Math.abs(Math.log(CANVAS_ZOOM_STEP)/Math.log(1.15)-1.2)<1e-12);
 const view={x:100,y:30,zoom:CANVAS_ZOOM_BASE},anchor={x:480,y:300};
 const enlarged=zoomAt(view,anchor,view.zoom*CANVAS_ZOOM_STEP);
 const restored=zoomAt(enlarged,anchor,enlarged.zoom/CANVAS_ZOOM_STEP);
 assert.ok(Math.abs(restored.x-view.x)<1e-9);
 assert.ok(Math.abs(restored.y-view.y)<1e-9);
 assert.ok(Math.abs(restored.zoom-view.zoom)<1e-9);
});

test('resetting and subsequent zoom steps keep the world point under the anchor fixed',()=>{
 const anchor={x:610,y:340};
 const view={x:-240,y:38,zoom:.45};
 const world=toWorld(anchor,view);
 const reset=zoomAt(view,anchor,CANVAS_ZOOM_BASE);
 const stepped=zoomAt(reset,anchor,reset.zoom*1.15);
 for(const next of [reset,stepped]){
  assert.ok(Math.abs(toWorld(anchor,next).x-world.x)<1e-9);
  assert.ok(Math.abs(toWorld(anchor,next).y-world.y)<1e-9);
 }
 assert.equal(canvasZoomPercent(stepped.zoom),115);
});

test('zoom limits use the same normalized twelve to two hundred percent range',()=>{
 const anchor={x:40,y:80},view={x:8,y:12,zoom:CANVAS_ZOOM_BASE};
 const min=zoomAt(view,anchor,.001),max=zoomAt(view,anchor,99);
 assert.equal(min.zoom,CANVAS_ZOOM_MIN);
 assert.equal(max.zoom,CANVAS_ZOOM_MAX);
 assert.equal(canvasZoomPercent(min.zoom),12);
 assert.equal(canvasZoomPercent(max.zoom),200);
 const world=toWorld(anchor,view);
 for(const next of [min,max]){
  assert.ok(Math.abs(toWorld(anchor,next).x-world.x)<1e-9);
  assert.ok(Math.abs(toWorld(anchor,next).y-world.y)<1e-9);
 }
});
