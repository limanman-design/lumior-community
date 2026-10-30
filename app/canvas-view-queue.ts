type View={x:number;y:number;zoom:number};
type Update=View|((view:View)=>View);

// Gesture math sees every input immediately; React paints only the latest view
// in each frame. Programmatic focus/reset supersedes any queued gesture frame.
export function createCanvasViewQueue(
 read:()=>View,
 write:(view:View)=>void,
 render:(view:View)=>void,
 requestFrame:(callback:()=>void)=>number,
 cancelFrame:(frame:number)=>void,
){
 let frame:number|null=null;
 const cancel=()=>{if(frame!==null)cancelFrame(frame);frame=null;};
 const update=(next:Update)=>{const view=typeof next==='function'?next(read()):next;write(view);return view;};
 return {
  set:(next:Update)=>{cancel();render(update(next));},
  queue:(next:Update)=>{update(next);if(frame===null)frame=requestFrame(()=>{frame=null;render(read());});},
  cancel,
 };
}
