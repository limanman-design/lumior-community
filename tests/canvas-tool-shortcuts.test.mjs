import test from 'node:test';
import assert from 'node:assert/strict';
import { canvasToolShortcut } from '../app/keyboard-shortcuts.ts';

test('A and T only choose tools without swallowing typing, IME, repeats or system combinations',()=>{
  assert.equal(canvasToolShortcut({key:'a'},false),'section');
  assert.equal(canvasToolShortcut({key:'T'},false),'text');
  assert.equal(canvasToolShortcut({key:'a'},true),null);
  for(const key of ['a','t'])for(const guard of [{metaKey:true},{ctrlKey:true},{altKey:true},{isComposing:true},{keyCode:229},{repeat:true},{defaultPrevented:true}])
    assert.equal(canvasToolShortcut({key,...guard},false),null);
  assert.equal(canvasToolShortcut({key:'x'},false),null);
});
