'use client';
import {PdfPanelResize} from './pdf-panel-resize';
import dynamic from 'next/dynamic';
import type {Card} from './canvas-model';
import type {Citation} from './research-demo';
import {useI18n} from './i18n';
const PdfViewer=dynamic(()=>import('./pdf-viewer'),{ssr:false});
export {VideoViewer} from './video-player';
import {VideoViewer,VideoIcon,VideoTranscribeButton} from './video-player';
export function ResearchIcon({name}:{name:string}){return <img className="research-icon" alt="" src={`/assets/research-ui/${name}.svg`}/>;}
export function ResearchSource({card,citation,onClose,onTranslate}:{card:Card;citation:Citation;onClose:()=>void;onTranslate?:()=>void}){const {t}=useI18n();return <aside className="research-source-panel" aria-label={t('Citation source','引用来源')}>{card.kind==='pdf'&&<PdfPanelResize/>}<header className="source-header"><span>{card.kind==='video'?<VideoIcon name="video"/>:card.kind==='pdf'?<ResearchIcon name="pdf"/>:<img className="research-icon" alt="" src="/assets/icon2-imgIcons8Note11.svg"/>}{card.title}</span>{card.kind==='video'&&<VideoTranscribeButton card={card}/>}<button aria-label={t('Close citation source','关闭引用来源')} onClick={onClose}><ResearchIcon name="close"/></button></header>{card.kind==='pdf'?<PdfViewer key={card.id} card={card} onExpandTranslate={onTranslate} initialPage={citation.page} focusRequest={citation} highlight={citation.origin==='live'?undefined:card.id==='greiner'&&citation.id===1?{x:17,y:19,width:72,height:16}:card.id==='bloch'&&citation.id===5?{x:9,y:25,width:79,height:9}:undefined}/>:card.kind==='image'?<div className="image-preview"><img src={card.image} alt={card.title}/><p>{card.body}</p></div>:card.kind==='video'?<VideoViewer card={card} time={citation.time} focusRequest={citation}/>:<div className="source-paragraphs">{card.body.split('\n\n').map((p,i)=><p className={i+1===citation.paragraph?'highlighted':''} key={i}><small>{t('Paragraph {number}','段落 {number}',{number:i+1})}</small>{p}</p>)}</div>}</aside>;}
