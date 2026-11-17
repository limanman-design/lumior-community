import test from 'node:test';
import assert from 'node:assert/strict';
import {findInlineFormulaSpans,inlineGlyphWidths,prepareInlineFormulaPages} from '../lib/pdf-inline-formulas.ts';
import {pdfPageText} from '../app/document-reading.ts';
import {pdfParagraphs} from '../lib/pdf-paragraphs.ts';
const item=(str,x,y=700,fontName='body',height=10,width=str.length*5)=>({str,transform:[height,0,0,height,x,y],fontName,height,width});
const page=(items,extra={})=>{const text=pdfPageText(items);return{page:1,width:600,height:800,text,items,paragraphs:pdfParagraphs(items,text,{width:600,height:800,convertToViewportPoint:(x,y)=>[x,800-y]}),...extra};};
const basic=()=>page([item('The particles occupy ',40),item('n',145,700,'math',10,5),item('i',150,697,'sub',7,3),item(' atoms in each lattice site.',158)]);

test('inline variables preserve attached subscripts and source baseline with verifiable hashes',async()=>{
 const input=basic(),spans=findInlineFormulaSpans(input);assert.equal(spans.length,1);assert.equal(spans[0].formula.text,'n i');
 const f=spans[0].formula;assert.equal(f.fontSize,10);assert.equal(f.baseline,12.5);assert(f.baseline>f.rect.y&&f.baseline<f.rect.y+f.rect.height);
 const first=await prepareInlineFormulaPages([input]),second=await prepareInlineFormulaPages([input]);assert.deepEqual(first,second);
 const part=first.units[0].parts[0];assert.match(part.sourceHash,/^[a-f\d]{64}$/);assert.equal(part.text,'The particles occupy {v10001} atoms in each lattice site.');assert.equal(first.units[0].inlineMathVersion,1);assert(first.legacyPartIds[part.id].length>0);
 const moved=basic();moved.items[1].transform[4]++;assert.notEqual((await prepareInlineFormulaPages([moved])).units[0].parts[0].sourceHash,part.sourceHash);
});

test('standalone equations, reference numbers, prose in italic fonts and unsupported pages stay untouched',()=>{
 const display=page([item('The equation follows.',40,730),item('n',200,700,'math'),item('=',210),item('1',220),item('This paragraph continues.',40,670)]);
 assert.equal(findInlineFormulaSpans(display).length,0);
 const refs=page([item('Reference citations ',40),item('[1]',140,700,'bold'),item(' contain no equations.',160)]);assert.equal(findInlineFormulaSpans(refs).length,0);
 const italic=page([item('The following phrase ',40),item('carefully written prose',150,700,'italic'),item(' has no formula.',280)]);assert.equal(findInlineFormulaSpans(italic).length,0);
 assert.equal(findInlineFormulaSpans({...basic(),supported:false}).length,0);
 assert.equal(findInlineFormulaSpans({...basic(),text:basic().text+' {v123}'}).length,0);
});

test('math punctuation in mixed prose items is split only with glyph advances',()=>{
 const items=[item('The operator ',40),item('w',110,700,'math',10,5),item('(',115,700,'body',10,5),item('x',120,700,'math',10,5),item(') is well defined.',125,700,'body',10,90)];
 assert.equal(findInlineFormulaSpans(page(items)).length,0);
 const glyphWidths={body:Object.fromEntries([...new Set(') is well defined.')].map(c=>[c,500]))};
 const spans=findInlineFormulaSpans(page(items,{glyphWidths}));assert.equal(spans.length,1);assert.equal(spans[0].formula.text,'w ( x )');assert(spans[0].formula.rect.x*6>100);assert((spans[0].formula.rect.x+spans[0].formula.rect.width)*6<135);
});

test('decimal suffixes joined to prose cannot leave an incomplete mathematical value',()=>{
 const items=[item('The ratio is ',40),item('U/J',110,700,'math',10,15),item('= 5',128,700,'body',10,15),item('.',143,700,'math',10,3),item('8. With this value.',146,700,'body',10,95)];
 const glyphWidths={body:Object.fromEntries([...new Set('8. With this value.')].map(c=>[c,500]))};
 const spans=findInlineFormulaSpans(page(items,{glyphWidths}));assert.equal(spans.length,1);assert.match(spans[0].formula.text,/5 \. 8$/);
 const without=findInlineFormulaSpans(page(items));assert.equal(without.length,0,'uncertain decimal boundary keeps original text');
});

test('spatially adjacent but distant reading-order columns never merge into one part',async()=>{
 const input=page([item('A paragraph before ',40),item('n',140,700,'math',10,5),item('i',145,697,'sub',7,3),item('continues in this column.',154),item('A completely separate paragraph.',40,650),item('Unrelated figure caption nearby.',154,700)]);
 const prepared=await prepareInlineFormulaPages([input]);const part=prepared.units.flatMap(u=>u.parts).find(p=>p.inlineFormulas);assert(!part.text.includes('Unrelated'));assert(!part.text.includes('completely separate'));
 assert(prepared.units.flatMap(u=>u.parts).some(p=>p.text.includes('Unrelated')));
});

test('large parts preserve marker boundaries and record mappings without exceeding translation capacity',async()=>{
 const input=basic();input.text='A lengthy prose paragraph. '.repeat(200)+input.text;input.paragraphs=[{start:0,end:input.text.length,rects:[]}];
 const prepared=await prepareInlineFormulaPages([input]);assert(prepared.units.length>1);assert(prepared.units.every(u=>u.text.length<=4500));assert(prepared.units.flatMap(u=>u.parts).every(p=>prepared.legacyPartIds[p.id].length));
 assert.equal(prepared.units.flatMap(u=>u.parts).reduce((n,p)=>n+(p.inlineFormulas?.length||0),0),1);
});

test('ambiguous font glyph widths are omitted instead of guessed',()=>{
 const widths=inlineGlyphWidths({fnArray:[37,44,44],argsArray:[['font',10],[[{unicode:')',width:300},{unicode:'x',width:500}]],[[{unicode:'x',width:700}]]]},37,44);
 assert.equal(widths.font[')'],300);assert.equal(widths.font.x,undefined);
});
