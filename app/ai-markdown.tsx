'use client';
/* oxlint-disable next/no-img-element -- Citation icons are small bundled SVGs. */
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {Children,isValidElement} from 'react';
import {MermaidDiagram} from './mermaid-diagram';
import {useI18n} from './i18n';
import {localizeAiSystemText} from './ai-ui-text';
import {aiCitationFormat,citationPlugin,type AiCitationFormat} from '../lib/ai-citations.ts';
import './document-content.css';

export function AiMarkdown({text,sources,onCitation,onCitationHover,citationFormat}:{text:string;sources?:{title:string;location?:string}[];onCitation:(n:number)=>void;onCitationHover?:(n:number|null)=>void;citationFormat?:AiCitationFormat}){
 const {t}=useI18n();
 return <div className="ai-markdown"><Markdown remarkPlugins={[remarkGfm,citationPlugin(citationFormat)]} skipHtml components={{
  a:({href,children,node})=>{const match=href?.match(/^#lumior-citation-(\d+)$/);if(match){if(citationFormat===aiCitationFormat&&node?.properties['data-lumior-source']!==aiCitationFormat)return <>{children}</>;const n=Number(match[1]);const source=sources?.[n-1];return source?<button className="citation-mark" title={[source.title,source.location&&localizeAiSystemText(source.location,t)].filter(Boolean).join(' · ')} aria-label={t('View citation {number}','查看引用 {number}',{number:n})} onClick={()=>onCitation(n)} onPointerEnter={()=>onCitationHover?.(n)} onPointerLeave={()=>onCitationHover?.(null)} onFocus={()=>onCitationHover?.(n)} onBlur={()=>onCitationHover?.(null)}><img className="research-icon" src="/assets/research-ui/book.svg" alt=""/>{n}</button>:<>{children}</>;}
   return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;},
  pre:({children})=>{const child=Children.toArray(children)[0];if(isValidElement<{className?:string;children?:unknown}>(child)&&child.props.className==='language-mermaid')return <MermaidDiagram source={typeof child.props.children==='string'?child.props.children:''}/>;return <pre>{children}</pre>;},
  img:({alt})=><span>{alt||t('Image','图片')}</span>,
  table:({children})=><div className="ai-markdown-table"><table>{children}</table></div>,
 }}>{text}</Markdown></div>;
}
