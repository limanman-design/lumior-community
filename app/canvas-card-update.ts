import {reconcileThesisEdits} from './thesis-board.ts';
import type {Board,Card} from './canvas-model';
import {cardContentKeys} from './card-metadata.ts';

const sharedContentKeys=new Set<keyof Card>(cardContentKeys);
const identity=(card:Card)=>card.sharedId||card.id;

/**
 * Input updates already identify one card and its changed fields. Keep the
 * immutable document snapshots supplied by the editor and reuse everything
 * else, including large PDF thumbnails and other boards' translated captions.
 */
export function patchCanvasCard(before:Board,id:string,patch:Partial<Card>,boards:Board[],now=new Date().toISOString()):{board:Board;boards:Board[]}{
 const source=before.cards.find(card=>card.id===id);
 if(!source)return {board:before,boards};
 const keys=(Object.keys(patch) as (keyof Card)[]).filter(key=>!Object.is(source[key],patch[key]));
 if(!keys.length)return {board:before,boards};

 const changedContent=Object.fromEntries(keys.filter(key=>sharedContentKeys.has(key)).map(key=>[key,patch[key]])) as Partial<Card>;
 const contentKeys=Object.keys(changedContent) as (keyof Card)[];
 const sync=source.kind!=='database'&&contentKeys.length>0;
 if(sync){changedContent.updatedAt=now;contentKeys.push('updatedAt');}
 const nextSource={...source,...patch,...(sync?{updatedAt:now}:{})};
 const sharedIdentity=identity(nextSource);
 let active:Board=before;
 const nextBoards=boards.map(stored=>{
  const board=stored.id===before.id?before:stored;
  let changed=false;
  const cards=board.cards.map(card=>{
   if(board.id===before.id&&card.id===id){changed=true;return nextSource;}
   if(!sync||identity(card)!==sharedIdentity)return card;
   if(contentKeys.every(key=>Object.is(card[key],changedContent[key])))return card;
   changed=true;
   return {...card,...changedContent};
  });
  const next=changed?reconcileThesisEdits(board,{...board,cards},Date.parse(now)):board;
  if(board.id===before.id)active=next;
  return next;
 });
 return {board:active,boards:nextBoards};
}
