import type {Board} from './canvas-model';

export type CanvasCardReference={id:string;title:string;cardId:string};
export function canvasCardReferences(boards:Board[]):Map<string,CanvasCardReference[]>{
 const references=new Map<string,CanvasCardReference[]>();
 for(const board of boards){
  const seen=new Set<string>();
  for(const card of board.cards){
   if(card.kind==='database')continue;
   const identity=card.sharedId||card.id;
   if(seen.has(identity))continue;
   seen.add(identity);
   const locations=references.get(identity)||[];
   locations.push({id:board.id,title:board.title,cardId:card.id});
   references.set(identity,locations);
  }
 }
 return references;
}

// Editing content does not change where a card lives. Reuse each unchanged
// location list so an input in one note cannot invalidate every card's props.
export function createCanvasCardReferenceCache(){
 let previousBoards:Board[]|undefined;
 let previous=new Map<string,CanvasCardReference[]>();
 return (boards:Board[])=>{
  if(boards===previousBoards)return previous;
  const next=canvasCardReferences(boards);
  for(const [id,locations] of next){
   const old=previous.get(id);
   if(old?.length===locations.length&&locations.every((location,index)=>location.id===old[index].id&&location.title===old[index].title&&location.cardId===old[index].cardId))next.set(id,old);
  }
  previousBoards=boards;
  previous=next;
  return next;
 };
}
