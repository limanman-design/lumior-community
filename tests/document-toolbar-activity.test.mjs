import test from 'node:test';
import assert from 'node:assert/strict';
import {registerDocumentToolbarActivity} from '../app/document-toolbar-activity.ts';
function setup(){
 const root=new EventTarget(),win=new EventTarget(),a={},b={},portal={};
 const state=[false,false],dismiss=[0,0];
 const clean=[a,b].map((owner,i)=>registerDocumentToolbarActivity({root,windowTarget:win,owns:t=>t===owner||(i===0&&t===portal),onActive:v=>state[i]=v,onDismiss:()=>dismiss[i]++}));
 const send=(type,target,key)=>{const e=new Event(type);Object.defineProperties(e,{target:{value:target},key:{value:key}});root.dispatchEvent(e);};
 return {root,win,a,b,portal,state,dismiss,clean,send};
}
test('idle editors never acquire toolbar ownership; only the interacted card does',()=>{
 const s=setup();assert.deepEqual(s.state,[false,false]);s.send('pointerdown',s.a);assert.deepEqual(s.state,[true,false]);s.send('pointerdown',s.b);assert.deepEqual(s.state,[false,true]);assert.ok(s.dismiss[0]);
});
test('own portaled toolbar keeps ownership; outside click and keyboard focus revoke it',()=>{
 const s=setup();s.send('focusin',s.a);s.send('pointerdown',s.portal);assert.deepEqual(s.state,[true,false]);s.send('focusin',s.b);assert.deepEqual(s.state,[false,true]);s.send('pointerdown',{});assert.deepEqual(s.state,[false,false]);
});
test('Escape and window blur dismiss selection UI without touching documents',()=>{
 const s=setup();s.send('pointerdown',s.a);s.send('keydown',s.a,'Escape');assert.deepEqual(s.state,[false,false]);s.send('pointerdown',s.b);s.win.dispatchEvent(new Event('blur'));assert.deepEqual(s.state,[false,false]);
});
test('unmount removes all interaction listeners',()=>{
 const s=setup();s.clean.forEach(f=>f());s.send('pointerdown',s.a);s.send('focusin',s.b);s.send('keydown',s.a,'Escape');s.win.dispatchEvent(new Event('blur'));assert.deepEqual(s.state,[false,false]);assert.deepEqual(s.dismiss,[0,0]);
});
