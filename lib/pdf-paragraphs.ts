export type SourceRect={x:number;y:number;width:number;height:number};
export type SourceParagraph={start:number;end:number;rects:SourceRect[]};
type TextItem={str?:string;transform?:number[];width?:number;height?:number};
export function pdfParagraphs(items:TextItem[],text:string,viewport:{width:number;height:number;convertToViewportPoint:(x:number,y:number)=>number[]}):SourceParagraph[]{
 type Line={start:number;end:number;x:number;y:number;right:number;height:number;rect:SourceRect};
 const lines:Line[]=[];let cursor=0;
 for(const item of items){
  const value=item.str?.split('\u0000').join('').trim();if(!value||!item.transform)continue;
  const start=text.indexOf(value,cursor);if(start<0)continue;cursor=start+value.length;
  const [x,bottom]=viewport.convertToViewportPoint(item.transform[4],item.transform[5]);
  const height=Math.max(2,Math.abs(item.height||item.transform[3]||10)),y=bottom-height,right=x+Math.max(1,item.width||height);
  const last=lines.at(-1);
  if(last&&Math.abs(last.y-y)<height*.35&&x>=last.x-2&&x-last.right<viewport.width*.06){
   last.end=cursor;last.right=Math.max(last.right,right);last.height=Math.max(last.height,height);last.rect.width=(last.right-last.x)/viewport.width*100;
  }else lines.push({start,end:cursor,x,y,right,height,rect:{x:x/viewport.width*100,y:y/viewport.height*100,width:(right-x)/viewport.width*100,height:height/viewport.height*100}});
 }
 if(!lines.length)return text?[{start:0,end:text.length,rects:[]}]:[];
 const groups:Line[][]=[];
 for(const line of lines){
  const group=groups.at(-1),last=group?.at(-1);
  const newParagraph=!last||line.y<last.y-2||line.y-last.y>Math.max(line.height,last.height)*1.6||Math.abs(line.x-last.x)>viewport.width*.1||Math.abs(line.height-last.height)>Math.max(line.height,last.height)*.25||(line.x>Math.min(...group!.map(l=>l.x))+line.height*.9&&/[.!?。！？:]\s*$/.test(text.slice(last.start,last.end)));
  if(newParagraph)groups.push([line]);else group!.push(line);
 }
 return groups.map((group,i)=>({start:i===0?0:group[0].start,end:groups[i+1]?.[0].start??text.length,rects:group.map(line=>line.rect)}));
}
