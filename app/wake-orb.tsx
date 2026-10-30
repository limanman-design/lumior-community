'use client';
import {useEffect,useRef} from 'react';

// Adapted from the user's original AI Wake Orb prototype: three Gaussian light fields.
export function WakeOrb({compact=false,active=true,speed=1}:{compact?:boolean;active?:boolean;speed?:number}={}){
 const ref=useRef<HTMLCanvasElement>(null);
 useEffect(()=>{
  const canvas=ref.current;if(!canvas)return;
  const context=canvas.getContext('2d');if(!context)return;const ctx=context;
  const orb=canvas.parentElement;if(!orb)return;
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');let frame=0;
// The compact icon uses half-resolution rendering and at most 30 drawn frames/s.
// Use fewer, larger dots for the small toolbar icon; accelerate the field without adding frames.
const renderScale=canvas.width/172;ctx.setTransform(renderScale,0,0,renderScale,0,0);
const frameInterval=1000/(compact?30:60);let lastDraw=-Infinity;
let visible=true;
const N=compact?4:6,spacing=compact?34:27,cx=86,cy=86,baseR=compact?10.5:7.1;
const start=performance.now();let wakeStart=-1,hover=false;
const pointer={x:cx,y:cy},attract={x:cx,y:cy};
const lerp=(a:number,b:number,t:number)=>a+(b-a)*t, clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const easeOutCubic=(t:number)=>1-Math.pow(1-t,3);
function field(x:number,y:number,gx:number,gy:number,s:number){const dx=x-gx,dy=y-gy;return Math.exp(-(dx*dx+dy*dy)/(2*s*s));}
function draw(now:number){
 frame=0;
 if(document.hidden||!visible)return;
 if(active&&!reduced.matches&&now-lastDraw<frameInterval-.5){frame=requestAnimationFrame(draw);return;}
 lastDraw=now;
 const motionSpeed=Number.isFinite(speed)?Math.max(.25,Math.min(4,speed)):1;
 const t=(active&&!reduced.matches?(now-start)/1000:0)*1.8*(compact?1.2:1)*motionSpeed;ctx.clearRect(0,0,172,172);
 ctx.save();ctx.beginPath();ctx.arc(cx,cy,81,0,Math.PI*2);ctx.clip();
 const g1={x:cx+22*Math.sin(t*0.42+0.3)+5*Math.sin(t*1.11+1.8),y:cy+18*Math.sin(t*0.31+1.7)+4*Math.cos(t*0.93+0.5)};
 const g2={x:cx+30*Math.sin(t*0.27+2.2)*Math.cos(t*0.18+0.4),y:cy+26*Math.cos(t*0.36+2.6)};
 const g3={x:cx+18*Math.cos(t*0.22+4.2),y:cy+31*Math.sin(t*0.25+3.0)*Math.cos(t*0.15+1.4)};
 attract.x=lerp(attract.x,hover?pointer.x:g1.x,hover?0.12:0.035);attract.y=lerp(attract.y,hover?pointer.y:g1.y,hover?0.12:0.035);
 let wakeProgress=-1,wakeAmp=0;
 if(wakeStart>0){wakeProgress=(now-wakeStart)/960;if(wakeProgress<=1){const gather=wakeProgress<0.28?easeOutCubic(wakeProgress/0.28):1;const bloom=wakeProgress<0.28?0:Math.sin(Math.PI*((wakeProgress-0.28)/0.72));wakeAmp=0.35*gather+0.9*Math.max(0,bloom);}else{wakeStart=-1;}}
 const startX=cx-(N-1)*spacing/2,startY=cy-(N-1)*spacing/2;
 for(let row=0;row<N;row++)for(let col=0;col<N;col++){
   // Remove all four corner dots so both sizes have a circular silhouette.
   if((row===0||row===N-1)&&(col===0||col===N-1))continue;
   const x=startX+col*spacing,y=startY+row*spacing;
   const f1=field(x,y,attract.x,attract.y,hover?24:22),f2=field(x,y,g2.x,g2.y,24),f3=field(x,y,g3.x,g3.y,21),center=field(x,y,cx,cy,29);
   const waveA=0.07*(1+Math.sin(t*1.8+col*0.85+row*0.45))/2,waveB=0.05*(1+Math.cos(t*1.2+row*0.82-col*0.5))/2,shimmer=0.03*(1+Math.sin(t*2.5+row*1.1+col*1.3));
   let b=0.19+0.50*f1+0.36*f2+0.30*f3+waveA+waveB+shimmer;
   b*=0.97+0.12*Math.sin(t*0.7+(row+col)*0.3);
   if(hover)b+=0.09*f1+0.055;
   if(wakeProgress>=0){const gatherRing=field(x,y,cx,cy,12+12*Math.max(0,0.35-wakeProgress)*3);const bloomRing=(1-wakeProgress)*0.1+wakeAmp*(0.60*center+0.40*f1);b+=0.26*gatherRing+0.64*bloomRing;}
   b=clamp(b,0,1);
   // Suppress the ambient field while preserving moving highlights.
   b=Math.pow(clamp((b-0.20)/0.80,0,1),1.35);
   const r=baseR*(0.80+0.45*b),alpha=(compact?.14:.035)+(compact?.86:.965)*b;

   // refined outer halo: tighter and cleaner
   if(b>0.32){ctx.save();ctx.shadowBlur=(12+9*b)*renderScale;ctx.shadowColor=`rgba(255,255,255,${0.18+0.22*b})`;ctx.fillStyle=`rgba(255,255,255,${0.06+0.09*b})`;ctx.beginPath();ctx.arc(x,y,r*1.30,0,Math.PI*2);ctx.fill();ctx.restore();}

   // precise inner glow: brighter core, less muddy blur
   if(b>0.46){ctx.save();ctx.shadowBlur=(7+7*b)*renderScale;ctx.shadowColor=`rgba(255,255,255,${0.38+0.24*b})`;ctx.fillStyle=`rgba(255,255,255,${0.20+0.17*b})`;ctx.beginPath();ctx.arc(x,y,r*0.95,0,Math.PI*2);ctx.fill();ctx.restore();}

   // crisp core dot
   const v=Math.round(158+97*b);ctx.fillStyle=`rgba(${v},${v},${v},${alpha})`;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();
 }
 ctx.restore();
 if(active&&!reduced.matches&&!document.hidden)frame=requestAnimationFrame(draw);
}
if(active&&!reduced.matches&&!document.hidden)frame=requestAnimationFrame(draw);

 const enter=()=>{hover=true;};const leave=()=>{hover=false;};
 const pointerMove=(e:PointerEvent)=>{const r=orb.getBoundingClientRect();pointer.x=(e.clientX-r.left)/r.width*172;pointer.y=(e.clientY-r.top)/r.height*172;};
 const wake=()=>{if(active&&!reduced.matches)wakeStart=performance.now();};
 const resume=()=>{cancelAnimationFrame(frame);frame=0;lastDraw=-Infinity;if(!document.hidden&&visible)draw(performance.now());};
 const observer=new IntersectionObserver(entries=>{visible=entries[0]?.isIntersecting??false;resume();});observer.observe(canvas);
 orb.addEventListener('pointerenter',enter);orb.addEventListener('pointerleave',leave);orb.addEventListener('pointermove',pointerMove);orb.addEventListener('click',wake);
 reduced.addEventListener('change',resume);document.addEventListener('visibilitychange',resume);
 if(!active||reduced.matches)draw(start);
 return()=>{observer.disconnect();cancelAnimationFrame(frame);orb.removeEventListener('pointerenter',enter);orb.removeEventListener('pointerleave',leave);orb.removeEventListener('pointermove',pointerMove);orb.removeEventListener('click',wake);reduced.removeEventListener('change',resume);document.removeEventListener('visibilitychange',resume);};
 },[compact,active,speed]);
 return <canvas ref={ref} className="wake-orb" width={compact?86:172} height={compact?86:172} aria-hidden="true"/>;
}
