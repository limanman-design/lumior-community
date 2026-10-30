import type {PartialBlock} from '@blocknote/core';
import type {Card} from './canvas-model';

export function cardDocument(card:Card,parseMarkdown?:(text:string)=>PartialBlock[]):PartialBlock[]{
 if(card.blocks?.length)return structuredClone(card.blocks);
 const blocks:PartialBlock[]=card.body?(parseMarkdown?parseMarkdown(card.body):card.body.split('\n\n').map(text=>({type:'paragraph',content:text}))):[];
 if(card.image)blocks.push({type:'image',props:{url:card.image,name:'Death Stranding landscape',showPreview:true}});
 if(card.detail)blocks.push({type:'heading',props:{level:3},content:'The core loop of Death Stranding'},...card.detail.split('\n\n').map(text=>({type:'paragraph' as const,content:text})));
 return blocks.length?blocks:[{type:'paragraph'}];
}
export function documentText(blocks:PartialBlock[]):string{
 const inline=(value:unknown):string=>{
  if(typeof value==='string')return value;
  if(Array.isArray(value))return value.map(inline).join('');
  if(value&&typeof value==='object'){const v=value as Record<string,unknown>;if(typeof v.text==='string')return v.text;if(v.type==='tableContent'&&Array.isArray(v.rows))return v.rows.map((r:any)=>r.cells.map(inline).join(' | ')).join('\n');if(v.content)return inline(v.content);}
  return '';
 };
 return blocks.map(b=>[inline(b.content),b.children?documentText(b.children):''].filter(Boolean).join('\n')).filter(Boolean).join('\n\n');
}

export function documentStartsWithTitle(card:Card):boolean{
 const first=card.blocks?.[0];
 const title=first?(first.type==='heading'?documentText([first]):''):(card.body.match(/^\s*#{1,6}\s+(.+?)(?:\r?\n|$)/)?.[1]||'');
 return title.trim()===card.title.trim();
}
