import type {Bibliography} from '../lib/bibliography';
import type {PdfExcerpt} from './pdf-annotations';
import type {PartialBlock} from '@blocknote/core';
import type {PdfTranslation} from '../lib/pdf-translation';
export {toWorld,zoomAt} from './canvas-zoom';
export type Point={x:number;y:number};
export type View=Point&{zoom:number};
export type CardVideo={url:string;poster:string;duration:number;provider?:'youtube'|'bilibili';youtubeId?:string;bilibiliId?:string;bilibiliPage?:number;startTime?:number;localUrl?:string;subtitleUrl?:string;transcriptUrl?:string};
export type Card=Point&{storedDocument?:import('./stored-document-schema').StoredDocumentRef;obsidianSource?:{libraryId:string;path:string};id:string;sharedId?:string;contentRole?:'literature'|'notePage'|'note'|'summary'|'video'|'image'|'text';sourceContentId?:string;authors?:string[];year?:number;bibliography?:Bibliography;createdAt?:string;updatedAt?:string;tags?:string[];creationDateSource?:'actual'|'simulated';pdfExcerpt?:PdfExcerpt;title:string;body:string;blocks?:PartialBlock[];width:number;height?:number;image?:string;detail?:string;sourceName?:string;pdf?:{url:string;name:string;size:number;pages:number;thumbnail:string;translation?:PdfTranslation};video?:CardVideo;databaseRef?:{databaseId:string;viewId?:string};kind:'note'|'text'|'pdf'|'video'|'image'|'database'};
export type Edge={id:string;from:string;to:string;color?:string;label?:string};
export type Board={createdAt?:string;updatedAt?:string;thesis?:import('./thesis-board').BoardThesis;aiOperations?:import('./ai-operation-history').AiOperationRecord[];demoLayoutVersion?:number;pinnedAt?:number;id:string;title:string;cards:Card[];edges:Edge[];sections?:{id:string;title:string;x:number;y:number;width:number;height:number;color:string;aiReason?:string}[]};
export const clamp=(n:number,min:number,max:number)=>Math.min(max,Math.max(min,n));
export function connect(board:Board,from:string,to:string):Board{
 if(from===to||!board.cards.some(c=>c.id===from)||!board.cards.some(c=>c.id===to))throw new Error('Choose two different cards on this whiteboard.');
 if(board.edges.some(e=>(e.from===from&&e.to===to)||(e.from===to&&e.to===from)))return board;
 return {...board,edges:[...board.edges,{id:`${from}:${to}`,from,to}]};
}
export function removeCards(board:Board,ids:string[]):Board{return {...board,cards:board.cards.filter(c=>!ids.includes(c.id)),edges:board.edges.filter(e=>!ids.includes(e.from)&&!ids.includes(e.to))};}
