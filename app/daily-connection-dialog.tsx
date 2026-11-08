'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Maximize2, Minus, Plus } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useI18n } from './i18n';
import { contentIdentity, type WorkspaceFiles } from './workspace-files';
import { dailyDisplayCard } from './daily-model';
import type { Board, Card } from './canvas-model';
import type { DailyConnection } from './daily-connections';
import type { DailyCardEditor } from './daily-home';
import './daily-connection-dialog.css';
const noop=()=>{};
type Props={connections:DailyConnection[];initialId:string;files:WorkspaceFiles;boards:Board[];busy:boolean;onClose:()=>void;onOpen:(id:string)=>void;onCompare:(connection:DailyConnection)=>void;onLink:(connection:DailyConnection)=>void;onDismiss:(connection:DailyConnection)=>void;renderCard:(card:Card,selected:boolean,measure:(id:string,height:number)=>void,editor:DailyCardEditor)=>ReactNode};
export function DailyConnectionDialog({connections,initialId,files,boards,busy,onClose,onOpen,onCompare,onLink,onDismiss,renderCard}:Props){
  const {t}=useI18n();
  const [activeId,setActiveId]=useState(initialId);
  const [evidence,setEvidence]=useState(false);
  const active=connections.find(item=>item.id===activeId)||connections[0];
  const group=connections.filter(item=>item.contentId===active?.contentId);
  const index=Math.max(0,group.findIndex(item=>item.id===active?.id)),page=Math.floor(index/3);
  const shown=group.slice(page*3,page*3+3);
  const height=Math.max(380,shown.length*310+40),sourceY=(height-260)/2;
  const [viewport,setViewport]=useState<HTMLDivElement|null>(null);
  const [view,setView]=useState({x:0,y:0,scale:.8});
  const gesture=useRef<{id:number;x:number;y:number;vx:number;vy:number}|null>(null);
  const fit=()=>{const rect=viewport?.getBoundingClientRect();if(!rect)return;const scale=Math.min(1,(rect.width-48)/1000,(rect.height-48)/height);setView({scale,x:(rect.width-1000*scale)/2,y:(rect.height-height*scale)/2});};
  useEffect(()=>{const node=viewport;if(!node)return;const observer=new ResizeObserver(()=>{const scale=Math.min(1,(node.clientWidth-48)/1000,(node.clientHeight-48)/height);setView({scale,x:(node.clientWidth-1000*scale)/2,y:(node.clientHeight-height*scale)/2});});observer.observe(node);return()=>observer.disconnect();},[height,viewport]);
  const zoom=(factor:number)=>{const rect=viewport?.getBoundingClientRect();if(!rect)return;setView(old=>{const scale=Math.max(.15,Math.min(2,old.scale*factor)),ratio=scale/old.scale;return {scale,x:rect.width/2-(rect.width/2-old.x)*ratio,y:rect.height/2-(rect.height/2-old.y)*ratio};});};
  const source=files.contents.find(item=>item.id===active?.contentId)?.card;
  const node=(card:Card,id:string,x:number,y:number,label:string,chosen:boolean)=><div className="daily-relation-node" style={{left:x,top:y}} key={id}>
    <div className="daily-relation-origin">{label}</div>
    <div className="daily-relation-card" data-selected={chosen}>
      <div inert className="daily-relation-card-content">{renderCard({...dailyDisplayCard(card),x:0,y:0,width:300,height:240},false,noop,{editing:false,imageNoteRequest:0,onChange:noop,onEdit:noop})}</div>
      <button type="button" className="daily-relation-card-hit" onClick={()=>onOpen(id)} aria-label={t('Open {title}','展开 {title}',{title:card.title})}><span><Maximize2 size={14}/>{t('Read','查看')}</span></button>
    </div>
  </div>;
  if(!active||!source)return null;
  return <Dialog open onOpenChange={open=>{if(!open)onClose();}}>
    <DialogContent className="daily-relation-dialog" data-daily-ui>
      <header><DialogTitle>{t('Possible connections','潜在联系')}</DialogTitle><DialogDescription>{source.title}</DialogDescription></header>
      <div className="daily-relation-viewport" ref={setViewport}
        onWheel={event=>{if(event.ctrlKey||event.metaKey){zoom(event.deltaY>0?.9:1.1);}else setView(old=>({...old,x:old.x-event.deltaX,y:old.y-event.deltaY}));}}
        onPointerDown={event=>{if((event.target as Element).closest('button')||![0,1,2].includes(event.button))return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);gesture.current={id:event.pointerId,x:event.clientX,y:event.clientY,vx:view.x,vy:view.y};}}
        onPointerMove={event=>{const start=gesture.current;if(start&&start.id===event.pointerId)setView(old=>({...old,x:start.vx+event.clientX-start.x,y:start.vy+event.clientY-start.y}));}}
        onPointerUp={()=>{gesture.current=null;}} onPointerCancel={()=>{gesture.current=null;}} onContextMenu={event=>event.preventDefault()}>
        <div className="daily-relation-world" style={{width:1000,height,transform:`translate(${view.x}px,${view.y}px) scale(${view.scale})`}}>
          <svg width="1000" height={height} aria-hidden="true">{shown.map((item,i)=><path key={item.id} data-active={item.id===active.id} d={`M 340 ${sourceY+140} C 430 ${sourceY+140}, 420 ${i*310+180}, 500 ${i*310+180} S 600 ${i*310+180}, 660 ${i*310+180}`}/>)}</svg>
          {node(source,active.contentId,40,sourceY,t('Daily','日常'),false)}
          {shown.map((item,i)=>{const target=boards.find(board=>board.id===item.boardId)?.cards.find(card=>contentIdentity(card)===item.sourceId)||files.contents.find(content=>content.id===item.sourceId)?.card;return <div key={item.id}>
            <button type="button" className="daily-relation-label" data-active={active.id===item.id} style={{left:500,top:i*310+180}} onClick={()=>{setActiveId(item.id);setEvidence(true);}} aria-expanded={active.id===item.id&&evidence}>{item.relation}</button>
            {target&&node(target,item.sourceId!,660,40+i*310,item.boardTitle,item.id===active.id)}
          </div>;})}
        </div>
        <div className="daily-relation-zoom"><button type="button" aria-label={t('Zoom out','缩小')} onClick={()=>zoom(.8)}><Minus size={16}/></button><button type="button" onClick={fit}>{t('Fit','适应画面')}</button><button type="button" aria-label={t('Zoom in','放大')} onClick={()=>zoom(1.25)}><Plus size={16}/></button></div>
        {group.length>3&&<div className="daily-relation-pages"><button type="button" disabled={page===0} aria-label={t('Previous connections','上一组联系')} onClick={()=>{setActiveId(group[(page-1)*3].id);setEvidence(false);}}><ArrowLeft size={16}/></button><span>{page+1} / {Math.ceil(group.length/3)}</span><button type="button" disabled={(page+1)*3>=group.length} aria-label={t('Next connections','下一组联系')} onClick={()=>{setActiveId(group[(page+1)*3].id);setEvidence(false);}}><ArrowRight size={16}/></button></div>}
      </div>
      {evidence&&<div className="daily-relation-evidence"><p>{active.reason}</p><div><blockquote>{active.captureQuote}</blockquote><blockquote>{active.sourceQuote}</blockquote></div></div>}
      <footer><button type="button" className="daily-relation-primary" disabled={busy} onClick={()=>onCompare(active)}>{t('Think together','一起想想')}</button><button type="button" disabled={busy} onClick={()=>onLink(active)}>{t('Add to board','加入画板')}</button><button type="button" className="daily-relation-dismiss" disabled={busy} onClick={()=>onDismiss(active)}>{t('Dismiss','暂不提醒')}</button></footer>
    </DialogContent>
  </Dialog>;
}
