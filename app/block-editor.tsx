'use client';
import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState,type DragEvent,type ClipboardEvent} from 'react';
import {SideMenuExtension} from '@blocknote/core/extensions';
import {en,zh} from '@blocknote/core/locales';
import {useI18n} from './i18n';
import {useCreateBlockNote,useBlockNoteEditor,useComponentsContext,SideMenuController,SideMenu,DragHandleButton,FormattingToolbarController,FormattingToolbar,blockTypeSelectItems,LinkToolbarController,LinkToolbar,type LinkToolbarProps} from '@blocknote/react';
import {BlockNoteView} from '@blocknote/shadcn';
import '@blocknote/shadcn/style.css';
import type {Card} from './canvas-model';
import {contentLinkId,openContentLinkEvent} from './content-links';
import {cardDocument,documentText} from './card-document';
import {CardDocumentEcho} from './card-document-echo';
import {documentSchema} from './document-schema';
import {resolveDocumentImage} from './document-images';
import {editorPlaceholder} from './editor-placeholder';
import {storeUploadedFile} from './local-repository';
import {resolveWorkspace} from './workspace-assets';
import {documentMediaKind,emptyMediaParagraph} from './document-media';
import {readStoredDocument,saveStoredDocument,storedDocumentError,flushStoredDocuments} from './stored-document';
import {registerDocumentBlockDrag} from './document-block-drag';
import {captureNoteSource,documentSources,noteSourceLink,parseNoteSource,numberedSources,sourceKey,sourceLabel,labelNoteSources,openNoteSourceEvent} from './note-source';
import {useNoteSourceResolver} from './note-source-context';
import {NoteReferences} from './note-references';
import './document-content.css';
import './document-media.css';

type EditorProps={card:Card;editable?:boolean;autoFocus?:boolean;onActivate?:()=>void;onChange?:(patch:Partial<Card>)=>void;sourceControls?:boolean};
// Activate before the initiating pointer reaches BlockNote so the first click
// can place its caret; the next React update still owns the editable prop.
function activateDocumentEditor(editor:{isEditable:boolean}){editor.isEditable=true;}
function DocumentLinkToolbar(props:LinkToolbarProps){
 const editor=useBlockNoteEditor();
 const Components=useComponentsContext()!;
 const {t}=useI18n();
 const source=parseNoteSource(props.url);
 if(!source)return <LinkToolbar {...props}/>;
 const open=t('View source','查看来源'),remove=t('Remove citation','移除引用');
 return <Components.LinkToolbar.Root className="bn-toolbar bn-link-toolbar">
  <span className="document-source-context">{source.title}{source.pages?.length ? ` · PDF ${t('p.','第')} ${source.pages.join(', ')}${t('',' 页')}` : ''}</span>
  <button type="button" className="bn-button" aria-label={open} onClick={()=>{props.setToolbarOpen?.(false);window.dispatchEvent(new CustomEvent(openNoteSourceEvent,{detail:props.url}));}}>{open}</button>
  <button type="button" className="bn-button" aria-label={remove} onClick={()=>{
   const view=editor.prosemirrorView,{from,to}=props.range;
   // Remove only this generated marker, never the cited passage. Ignore a
   // stale toolbar range if the document changed while it was open.
   if(from<0||to>view.state.doc.content.size||to<=from)return;
   let matches=true,found=false;
   view.state.doc.nodesBetween(from,to,node=>{if(node.isText){found=true;if(!node.marks.some(mark=>mark.type.name==='link'&&mark.attrs.href===props.url))matches=false;}});
   if(!found||!matches)return;
   view.dispatch(view.state.tr.delete(from,to));
   props.setToolbarOpen?.(false);
  }}>{remove}</button>
 </Components.LinkToolbar.Root>;
}
export default function BlockEditor(props:EditorProps){
 const {language}=useI18n();
 if(props.card.storedDocument)return <StoredDocumentEditor key={`${props.card.sharedId||props.card.id}:${language}`} {...props} language={language}/>;
 return <DocumentEditor key={`${props.card.id}:${language}`} {...props} language={language}/>;
}
function StoredDocumentEditor(props:EditorProps&{language:'en'|'zh'}){
 const {card,language}=props;
 const [loaded,setLoaded]=useState<Card|null>(null),[error,setError]=useState(''),[saving,setSaving]=useState(0),[reload,setReload]=useState(0);
 const mounted=useRef(true),metadata=useRef(card),input=useRef(card),current=useRef(props.onChange),writer=useRef({}),ownRevision=useRef<string|undefined>(undefined),draft=useRef<Partial<Card>|null>(null);
 const documentRevision=card.storedDocument?.document||card.storedDocument?.source;
 useLayoutEffect(()=>{current.current=props.onChange;input.current=card;},[props.onChange,card]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;void flushStoredDocuments().catch(()=>{});};},[]);
 useEffect(()=>{
  const card=input.current;
  if(draft.current&&ownRevision.current!==documentRevision&&metadata.current.storedDocument?.document!==card.storedDocument?.document){setError(language==='zh'?'此笔记已在另一视图修改。未保存文字仍在当前编辑器中，请先复制保留后重新打开。':'This note changed in another view. Copy your unsaved text before reopening.');return;}
  metadata.current=card;
  if(ownRevision.current===documentRevision)return;
  const abort=new AbortController();setLoaded(null);setError('');
  void readStoredDocument(card,{signal:abort.signal}).then(value=>{if(!abort.signal.aborted){setLoaded(value);setError(storedDocumentError(card)?.message||'');}},reason=>{if(!abort.signal.aborted)setError(reason instanceof Error?reason.message:String(reason));});
  return()=>abort.abort();
 // A metadata-only title/position change must not replace the editor body.
 },[documentRevision,reload,language]);
 const save=(patch:Partial<Card>)=>{
  // Citation edits are note metadata; do not rewrite a separately stored body.
  if(!Object.hasOwn(patch,'blocks')&&!Object.hasOwn(patch,'body')){metadata.current={...metadata.current,...patch};current.current?.(patch);return;}
  draft.current=patch;setLoaded(value=>value?{...value,...patch}:value);setSaving(value=>value+1);setError('');
  void saveStoredDocument(metadata.current,patch,{writer:writer.current,commit:next=>{
   metadata.current={...metadata.current,...next};ownRevision.current=next.storedDocument?.document;
   current.current?.(next);
  }}).then(()=>{if(draft.current===patch)draft.current=null;},reason=>{if(mounted.current)setError(reason instanceof Error?reason.message:String(reason));}).finally(()=>{if(mounted.current)setSaving(value=>Math.max(0,value-1));});
 };
 return <div className="stored-note-document">
  {saving>0&&<output className="document-file-status">{language==='zh'?'正在保存笔记…':'Saving note…'}</output>}
  {error&&<p className="document-file-error" role="alert">{error} <button type="button" onClick={()=>{if(draft.current)save(draft.current);else setReload(value=>value+1);}}>{language==='zh'?'重试':'Retry'}</button></p>}
  {loaded?<DocumentEditor {...props} card={{...card,blocks:loaded.blocks,body:loaded.body}} onChange={save}/>:!error&&<output className="document-file-status">{language==='zh'?'正在读取笔记…':'Loading note…'}</output>}
 </div>;
}
function DocumentEditor({card,editable=true,autoFocus=false,onActivate,onChange,language,sourceControls=false}:EditorProps&{language:'en'|'zh'}){
 // Initialization is per card/language, never per input or geometry update.
 // A region excerpt already displays its source image in the quote above. The
 // document remains the user's records; existing saved blocks stay intact.
 const documentCard=useMemo(()=>card.pdfExcerpt&&card.image?{...card,image:undefined}:card,[card]);
 const [initialContent]=useState(()=>labelNoteSources(cardDocument(documentCard),language,card.citationStyle==='gbt-7714-2025'));
 const resolveSource=useNoteSourceResolver();
 const sourceCard=useRef(card);
 useLayoutEffect(()=>{sourceCard.current=card;},[card]);
 const [sources,setSources]=useState(()=>documentSources(initialContent));
 const sourceSignature=useRef(JSON.stringify(sources));
 const [echo]=useState(()=>new CardDocumentEcho());
 const dictionary=useMemo(()=>{
  const base=language==='zh'?zh:en;
  // The current code block preserves code formatting but has no highlighter.
  return {...base,slash_menu:{...base.slash_menu,code_block:{...base.slash_menu.code_block,subtext:language==='zh'?'保留缩进与等宽字体的代码块':'Code with preserved indentation and monospace text'}}};
 },[language]);
 const blockTypes=useMemo(()=>blockTypeSelectItems(dictionary).filter(item=>item.type!=='heading'||Number(item.props?.level)<=4),[dictionary]);
 const placeholder=editorPlaceholder(language,!!card.pdfExcerpt);
 const wrapper=useRef<HTMLDivElement>(null);
 const [inlineControls,setInlineControls]=useState<HTMLDivElement|null>(null);
 // Floating menus escape the canvas transform/scroll clip. Drag handles and
 // table handles stay in the document so their hit testing and clipping remain local.
 const portalElements=useMemo(()=>({default:null,tableHandles:inlineControls}),[inlineControls]);
 const mounted=useRef(true);
 const pendingImports=useRef(new Set<AbortController>());
 const [importing,setImporting]=useState(0);
 const [fileError,setFileError]=useState('');
 const uploadFile=useCallback((file:File)=>storeUploadedFile(file,file.name),[]);
 const editor=useCreateBlockNote({schema:documentSchema,dictionary:{...dictionary,placeholders:{...dictionary.placeholders,default:placeholder,emptyDocument:placeholder}},initialContent,uploadFile,links:{onClick:event=>{const anchor=event.target instanceof Element?event.target.closest('a[href]'):null;const href=anchor?.getAttribute('href')||'';if(parseNoteSource(href)){event.preventDefault();window.dispatchEvent(new CustomEvent(openNoteSourceEvent,{detail:href}));return true;}const id=contentLinkId(href);if(!id)return false;event.preventDefault();window.dispatchEvent(new CustomEvent(openContentLinkEvent,{detail:id}));return true;}},resolveFileUrl:async url=>resolveDocumentImage(resolveWorkspace(url))},[]);
 useEffect(()=>{mounted.current=true;const pending=pendingImports.current;return()=>{mounted.current=false;for(const operation of pending)operation.abort();};},[]);
 useEffect(()=>{if(!wrapper.current)return;return registerDocumentBlockDrag({element:wrapper.current,view:editor.prosemirrorView,isEditable:()=>editor.isEditable,
  identity:()=>sourceCard.current.sharedId||sourceCard.current.id,
  source:()=>captureNoteSource(sourceCard.current,resolveSource),
  onCopyFrom:source=>{
   const view=editor.prosemirrorView,dragging=view.dragging;
   if(!dragging||dragging.slice.openStart||dragging.slice.openEnd)return;
   const schema=view.state.schema;
   const link=schema.marks.link.create({href:noteSourceLink(source)});
   const label=schema.text(sourceLabel(source,language),[link]);
   let content=dragging.slice.content.cut(0,0);
   dragging.slice.content.forEach(block=>{
    // Keep a passage and its source in the same editable block, including on
    // undo, reorder and deletion. Already cited passages retain their origin.
    let cited=false;
    block.descendants(node=>{if(node.marks.some(mark=>mark.type.name==='link'&&parseNoteSource(String(mark.attrs.href||''))))cited=true;});
    const textBlock=block.firstChild;
    if(!cited&&textBlock?.isTextblock&&textBlock.type.allowsMarkType(link.type)){
     const text=textBlock.copy(textBlock.content.addToEnd(schema.text(' ')).addToEnd(label));
     content=content.addToEnd(block.copy(block.content.replaceChild(0,text)));
    }else{
     content=content.addToEnd(block);
     if(!cited){const paragraph=schema.nodes.paragraph.create(null,label);content=content.addToEnd(schema.nodes.blockContainer.create({id:crypto.randomUUID()},paragraph));}
    }
   });
   const group=schema.nodes.blockGroup.create(null,content);
   view.dragging={...dragging,slice:group.slice(0,group.content.size)};
  },onDragEnd:()=>{const menu=editor.getExtension(SideMenuExtension);menu?.blockDragEnd();if(menu?.menuFrozen)menu.unfreezeMenu();menu?.hideMenuIfNotFrozen();}});},[editor,resolveSource,language]);
 useEffect(()=>{if(autoFocus&&editable)editor.focus();},[autoFocus,editable,editor]);
 const current=useRef(onChange);
 useLayoutEffect(()=>{current.current=onChange;},[onChange]);
 const syncing=useRef(false);
 useLayoutEffect(()=>{if(!echo.receive(documentCard))return;syncing.current=true;
  try{editor.replaceBlocks(editor.document,labelNoteSources(cardDocument(documentCard,text=>editor.tryParseMarkdownToBlocks(text)),language,card.citationStyle==='gbt-7714-2025'));}
  finally{syncing.current=false;}
  const next=documentSources(editor.document),signature=JSON.stringify(next);if(signature!==sourceSignature.current){sourceSignature.current=signature;setSources(next);}
 },[echo,editor,documentCard,language,card.citationStyle]);
 const change=useCallback(()=>{
  if(!editable||syncing.current)return;
  const nextSources=documentSources(editor.document),numbers=numberedSources(nextSources);
  const view=editor.prosemirrorView,tr=view.state.tr;
  const replacements:{from:number;to:number;href:string;label:string;text:string}[]=[];
  view.state.doc.descendants((node,pos)=>{
   if(!node.isText)return;
   const link=node.marks.find(mark=>mark.type.name==='link'),href=String(link?.attrs.href||''),source=parseNoteSource(href);
   if(!source)return;
   const label=sourceLabel(source,language,card.citationStyle==='gbt-7714-2025'?numbers.get(sourceKey(source))?.number:undefined);
   const last=replacements.at(-1);
   if(last?.to===pos&&last.href===href){last.to=pos+node.nodeSize;last.text+=node.text||'';}
   else replacements.push({from:pos,to:pos+node.nodeSize,href,label,text:node.text||''});
  });
  for(const item of replacements.reverse())if(item.text!==item.label)tr.replaceWith(item.from,item.to,view.state.schema.text(item.label,[view.state.schema.marks.link.create({href:item.href})]));
  if(tr.docChanged){syncing.current=true;try{view.dispatch(tr.setMeta('addToHistory',false));}finally{syncing.current=false;}}
  const signature=JSON.stringify(nextSources);if(signature!==sourceSignature.current){sourceSignature.current=signature;setSources(nextSources);}
  const blocks=structuredClone(editor.document);
  const body=documentText(blocks);
  echo.local(blocks,body);
  current.current?.({blocks,body});
 },[editable,editor,echo,language,card.citationStyle]);
 const priorStyle=useRef(card.citationStyle);
 useEffect(()=>{if(priorStyle.current===card.citationStyle)return;priorStyle.current=card.citationStyle;change();},[card.citationStyle,change]);
 const insertFiles=async(files:File[],point?:{x:number;y:number})=>{
  if(!editor.isEditable||!files.length)return;
  setFileError('');
  let anchor=editor.getTextCursorPosition().block;
  const selection=editor.prosemirrorState.selection;
  let placement:'before'|'after'=!point&&selection.empty&&selection.$from.parentOffset===0&&editor.document[0]?.id===anchor.id?'before':'after';
  if(point){
   const pos=editor.prosemirrorView.posAtCoords({left:point.x,top:point.y});
   const node=pos&&editor.prosemirrorView.domAtPos(pos.pos).node;
   const element=node instanceof Element?node:node?.parentElement;
   const block=element?.closest<HTMLElement>('[data-id]');
   const found=block?.dataset.id&&editor.getBlock(block.dataset.id);
   if(found){anchor=found;const rect=block!.getBoundingClientRect();placement=point.y<(rect.top+rect.bottom)/2?'before':'after';}
  }
  const replaceEmpty=emptyMediaParagraph(anchor);
  const operation=new AbortController();
  pendingImports.current.add(operation);setImporting(count=>count+1);
  try{
   // Store bytes before inserting, so closing or undoing a pending import never
   // leaves an empty media block behind. A batch is one complete undo step.
   const blocks=await Promise.all(files.map(async file=>({type:documentMediaKind(file),props:{name:file.name,url:await uploadFile(file)}})));
   const currentAnchor=editor.getBlock(anchor.id);
   if(!mounted.current||operation.signal.aborted||!editor.isEditable||!currentAnchor)return;
   if(replaceEmpty&&emptyMediaParagraph(currentAnchor))editor.replaceBlocks([currentAnchor],blocks);
   else editor.insertBlocks(blocks,currentAnchor,placement);
  }catch{if(mounted.current&&!operation.signal.aborted)setFileError(language==='zh'?'文件未能保存，请检查本地可用空间后重试。':'The file could not be saved. Check available storage and try again.');}
  finally{pendingImports.current.delete(operation);if(mounted.current)setImporting(count=>count-1);}
 };
 const receiveFiles=(event:DragEvent<HTMLDivElement>|ClipboardEvent<HTMLDivElement>)=>{
  const transfer='dataTransfer'in event?event.dataTransfer:event.clipboardData;
  if(!editor.isEditable||!transfer.files.length)return;
  event.preventDefault();event.stopPropagation();
  void insertFiles(Array.from(transfer.files),'clientX'in event?{x:event.clientX,y:event.clientY}:undefined);
 };
 const dragFiles=(event:DragEvent<HTMLDivElement>)=>{
  if(!editor.isEditable||!Array.from(event.dataTransfer.types).includes('Files'))return;
  event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='copy';
 };
 return <div ref={wrapper} onDragEnterCapture={dragFiles} onDragOverCapture={dragFiles} onDropCapture={receiveFiles} onPasteCapture={receiveFiles} onKeyDownCapture={event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='z')for(const operation of pendingImports.current)operation.abort();}} onPointerDownCapture={()=>{if(!editable&&onActivate){activateDocumentEditor(editor);onActivate();}}} onPointerDown={event=>{if(!event.currentTarget.contains(event.target as Node))event.stopPropagation();}} className={`block-document ${editable?'is-editable':'is-readonly'}`}>
  {importing>0&&<output className="document-file-status">{language==='zh'?'正在保存文件…':'Saving files…'}</output>}
  {fileError&&<p className="document-file-error" role="alert">{fileError}</p>}
  <BlockNoteView editor={editor} className="lumior-document-controls" portalElements={portalElements} theme="dark" editable={editable} sideMenu={false} formattingToolbar={false} linkToolbar={false} onChange={change}><FormattingToolbarController formattingToolbar={()=> <FormattingToolbar blockTypeSelectItems={blockTypes}/>}/><LinkToolbarController linkToolbar={DocumentLinkToolbar} floatingUIOptions={{useFloatingOptions:{placement:"top"}}}/><SideMenuController portalElement={inlineControls??undefined} sideMenu={()=> <SideMenu><DragHandleButton/></SideMenu>}/><div ref={setInlineControls} className="bn-root bn-shadcn document-inline-controls"/></BlockNoteView>
  {sourceControls&&<NoteReferences sources={sources} enabled={card.citationStyle==='gbt-7714-2025'} edits={card.citationEdits} onChange={editable&&onChange?citationEdits=>onChange({citationEdits}):undefined}/>}
 </div>;
}
