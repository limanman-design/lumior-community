import type {Board,Card,Point} from './canvas-model';
export type CanvasSection=NonNullable<Board['sections']>[number];
export function removeSection(board:Board,id:string):Board{
 if(!board.sections?.some(section=>section.id===id))return board;
 return {...board,sections:board.sections.filter(section=>section.id!==id)};
}
export function sectionRect(a:Point,b:Point){return {x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(a.x-b.x),height:Math.abs(a.y-b.y)};}
export function containedCards(section:Pick<CanvasSection,'x'|'y'|'width'|'height'>,cards:Card[],sizes:Record<string,number>={}){
 return cards.filter(c=>c.x>=section.x&&c.y>=section.y&&c.x+c.width<=section.x+section.width&&c.y+(sizes[c.id]||c.height||300)<=section.y+section.height).map(c=>c.id);
}
export function moveSection(board:Board,id:string,ids:string[],dx:number,dy:number):Board{return {...board,sections:board.sections?.map(s=>s.id===id?{...s,x:s.x+dx,y:s.y+dy}:s),cards:board.cards.map(c=>ids.includes(c.id)?{...c,x:c.x+dx,y:c.y+dy}:c)};}

export type SectionResizeEdge = 'left' | 'right' | 'top' | 'bottom';
/** Resize only the frame; its contents keep their own positions and dimensions. */
export function resizeSection(board: Board, id: string, edge: SectionResizeEdge, dx: number, dy: number): Board {
 const section = board.sections?.find(item => item.id === id);
 if (!section || !Number.isFinite(dx) || !Number.isFinite(dy)) return board;
 const minimum = 80;
 let { x, y, width, height } = section;
 if (edge === 'left') { x = Math.min(x + dx, x + width - minimum); width += section.x - x; }
 if (edge === 'right') width = Math.max(minimum, width + dx);
 if (edge === 'top') { y = Math.min(y + dy, y + height - minimum); height += section.y - y; }
 if (edge === 'bottom') height = Math.max(minimum, height + dy);
 if (x === section.x && y === section.y && width === section.width && height === section.height) return board;
 return { ...board, sections: board.sections!.map(item => item.id === id ? { ...item, x, y, width, height } : item) };
}
