import test from 'node:test';
import assert from 'node:assert/strict';
import {pdfParagraphs} from '../lib/pdf-paragraphs.ts';
import {selectionToolbarPosition,selectionToolbarVisibility} from '../app/pdf-selection-position.ts';

test('PDF paragraph geometry groups lines, separates columns and preserves the entire extracted text',()=>{
 const values=[['Title',20,10,18],['First line',20,50,10],['Continued line.',20,64,10],['Second paragraph.',20,90,10],['Other column',300,50,10],['Final sentence.',300,64,10]];
 const text=values.map(value=>value[0]).join('\n');
 const items=values.map(([str,x,y,height])=>({str,width:150,height,transform:[height,0,0,height,x,800-y]}));
 const parts=pdfParagraphs(items,text,{width:600,height:800,convertToViewportPoint:(x,y)=>[x,800-y]});
 assert.equal(parts.length,4);assert.equal(parts.map(part=>text.slice(part.start,part.end)).join(''),text);
 assert.equal(parts[1].rects.length,2);assert.equal(parts.at(-1).rects.length,2);
 assert.ok(parts.at(-1).rects[0].x===50);assert.deepEqual(pdfParagraphs([],text,{width:600,height:800,convertToViewportPoint:()=>[]}),[{start:0,end:text.length,rects:[]}]);
});
test('selection palette opens below the final pointer and stays within the viewport',()=>{
 assert.deepEqual(selectionToolbarPosition({x:300,y:150},{width:1000,height:800}),{x:280,y:164});
 const position=selectionToolbarPosition({x:990,y:790},{width:1000,height:800});assert.ok(position.x+280<=992);assert.ok(position.y+154<=792);
});
test('moving toward the palette keeps it visible, moving aside fades, returning restores, and far away closes',()=>{
 const anchor={x:300,y:150},rect={left:280,right:560,top:164,bottom:318};
 assert.equal(selectionToolbarVisibility({x:300,y:160},anchor,rect),'visible');
 assert.equal(selectionToolbarVisibility({x:400,y:250},anchor,rect),'visible');
 assert.equal(selectionToolbarVisibility({x:220,y:160},anchor,rect),'faded');
 assert.equal(selectionToolbarVisibility({x:300,y:151},anchor,rect),'visible');
 assert.equal(selectionToolbarVisibility({x:50,y:400},anchor,rect),'closed');
});
