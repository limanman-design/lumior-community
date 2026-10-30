// The displayed 100% uses the former 120% card size. World coordinates stay unchanged.
export const CANVAS_ZOOM_BASE=1.2;
export const CANVAS_ZOOM_MIN=.12*CANVAS_ZOOM_BASE;
export const CANVAS_ZOOM_MAX=2*CANVAS_ZOOM_BASE;
export const CANVAS_ZOOM_GAIN=1.2;
// Zoom steps and continuous gestures use the same gain in logarithmic space.
export const CANVAS_ZOOM_STEP=Math.pow(1.15,CANVAS_ZOOM_GAIN);
type Point={x:number;y:number};
type View=Point&{zoom:number};

export function canvasWheelZoom(deltaY:number,deltaMode:number,canvasHeight:number,pinch:boolean):{change:number;cap:number}{
 const pixels=deltaY*(deltaMode===1?16:deltaMode===2?canvasHeight:1);
 const boost=1.1*1.05*CANVAS_ZOOM_GAIN;
 const sensitivity=(pinch?.0054:.0036*1.1)*1.32*boost;
 return {change:-Math.min(80,Math.max(-80,pixels))*sensitivity,cap:(pinch?.0792:.08712)*boost};
}

export function canvasZoomPercent(zoom:number):number{return Math.round(zoom/CANVAS_ZOOM_BASE*100);}
export function toWorld(p:Point,v:View):Point{return {x:(p.x-v.x)/v.zoom,y:(p.y-v.y)/v.zoom};}
export function zoomAt(v:View,p:Point,z:number):View{
 const zoom=Math.min(CANVAS_ZOOM_MAX,Math.max(CANVAS_ZOOM_MIN,z));
 const w=toWorld(p,v);
 return {x:p.x-w.x*zoom,y:p.y-w.y*zoom,zoom};
}
