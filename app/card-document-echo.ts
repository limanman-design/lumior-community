import type {Card} from './canvas-model';

type Source={blocks:NonNullable<Card['blocks']>}|{body:string;image?:string;detail?:string};
const source=(card:Pick<Card,'blocks'|'body'|'image'|'detail'>):Source=>card.blocks?.length?{blocks:card.blocks}:{body:card.body,image:card.image,detail:card.detail};
const equal=(a:Source|null,b:Source)=>a!==null&&('blocks'in a?'blocks'in b&&(a.blocks===b.blocks||JSON.stringify(a.blocks)===JSON.stringify(b.blocks)):!('blocks'in b)&&a.body===b.body&&a.image===b.image&&a.detail===b.detail);

/** Own immutable echoes take the identity fast path; cloned echoes also leave the caret alone. */
export class CardDocumentEcho{
 private last:Source|null=null;
 receive(card:Pick<Card,'blocks'|'body'|'image'|'detail'>):boolean{
  const next=source(card);
  if(equal(this.last,next)){this.last=next;return false;}
  this.last=next;
  return true;
 }
 local(blocks:NonNullable<Card['blocks']>,body:string){this.last=source({blocks,body});}
}
