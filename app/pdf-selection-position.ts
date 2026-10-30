export type CursorPoint={x:number;y:number};
export function selectionToolbarPosition(point:CursorPoint,viewport:{width:number;height:number},size={width:280,height:154}){
 return {x:Math.max(8,Math.min(point.x-20,viewport.width-size.width-8)),y:Math.max(8,Math.min(point.y+14,viewport.height-size.height-8))};
}
export function selectionToolbarVisibility(point:CursorPoint,anchor:CursorPoint,rect:{left:number;right:number;top:number;bottom:number}):'visible'|'faded'|'closed'{
 const toRect=Math.hypot(Math.max(rect.left-point.x,0,point.x-rect.right),Math.max(rect.top-point.y,0,point.y-rect.bottom));
 const toAnchor=Math.hypot(point.x-anchor.x,point.y-anchor.y);
 const target={x:Math.max(rect.left,Math.min(anchor.x,rect.right)),y:rect.top};
 const vx=target.x-anchor.x,vy=target.y-anchor.y,length=vx*vx+vy*vy;
 const t=length?Math.max(0,Math.min(1,((point.x-anchor.x)*vx+(point.y-anchor.y)*vy)/length)):0;
 const corridor=Math.hypot(point.x-anchor.x-t*vx,point.y-anchor.y-t*vy);
 if(toRect<16||toAnchor<28||corridor<22)return 'visible';
 if(Math.min(toRect,toAnchor)>160)return 'closed';
 return 'faded';
}
