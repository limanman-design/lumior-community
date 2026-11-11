import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { findDailyPdfEvidence } from '../app/daily-pdf-evidence.ts';
import { dailyExampleEvidence } from '../app/daily-example-evidence.ts';
const viewport = { width:600, height:800, convertToViewportPoint:(x,y)=>[x,800-y] };
const item = str => ({str,transform:[12,0,0,12,40,700],width:400,height:12,hasEOL:true});
const mock = (pages, visited) => ({numPages:pages.length,async getPage(n){visited.push(n);return {getTextContent:async()=>({items:pages[n-1].map(item)}),getViewport:()=>viewport};}});
test('verifies a page hint, then searches other pages if the hint is stale',async()=>{
 const visits=[];const pdf=mock([['Different introduction.'],['This is the actual evidence.'],['No evidence here.']],visits);
 const result=await findDailyPdfEvidence(pdf,'This is the actual evidence.',3);
 assert.equal(result.page,2);assert.deepEqual(visits,[3,1,2]);assert.equal(result.location.rects.length,1);
});
test('no quote, paraphrase, repeated text or scanned page produces guessed highlights',async()=>{
 for(const [pages,quote] of [[[[]],'Evidence missing here.'],[[['Original source text.']],'A rewritten explanation.'],[[['Repeated evidence.','Repeated evidence.']],'Repeated evidence.'],[[['A source.']],'']]){
  assert.equal(await findDailyPdfEvidence(mock(pages,[]),quote),undefined);
 }
});
test('cancelling while reading a page stops the subsequent scan',async()=>{
 const controller=new AbortController();const visited=[];const pdf=mock([['No match.'],['This is the evidence.']],visited);
 const original=pdf.getPage;pdf.getPage=async n=>{const page=await original(n);controller.abort();return page;};
 assert.equal(await findDailyPdfEvidence(pdf,'This is the evidence.',undefined,controller.signal),undefined);assert.deepEqual(visited,[1]);
});
test('both bundled paper quotations resolve to real, bounded page-one highlights',async()=>{
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
 for(const [id,name] of [['uncertainty','curiosity-uncertainty'],['measurement','curiosity-state-trait']]){
  const task=getDocument({data:new Uint8Array(await readFile(new URL(`../public/daily-media/research/${name}.pdf`,import.meta.url)))});
  try{
   const pdf=await task.promise;const evidence=dailyExampleEvidence[`lumior-material-example-${id}`];
   const result=await findDailyPdfEvidence(pdf,evidence.quote,evidence.page);
   assert.equal(result?.page,1,name);assert.ok(result.location.rects.length>=3,name);
   assert.ok(result.location.rects.every(r=>r.x>=0&&r.y>=0&&r.width>0&&r.height>0&&r.x+r.width<=100&&r.y+r.height<=100));
  }finally{await task.destroy();}
 }
});
