'use client';
import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState,type DragEvent,type ClipboardEvent} from 'react';
import {SideMenuExtension} from '@blocknote/core/extensions';
import {en,zh} from '@blocknote/core/locales';
import {useI18n} from './i18n';
import {useCreateBlockNote,SideMenuController,SideMenu,DragHandleButton,FormattingToolbarController,FormattingToolbar,blockTypeSelectItems} from '@blocknote/react';
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
import {documentMediaKind} from './document-media';
import {readStoredDocument,saveStoredDocument,storedDocumentError,flushStoredDocuments} from './stored-document';
import {registerDocumentBlockDrag} from './document-block-drag';
import './document-content.css';
import './document-media.css';

type EditorProps={card:Card;editable?:boolean;autoFocus?:boolean;onActivate?:()=>void;onChange?:(patch:Partial<Card>)=>void};
// Activate before the initiating pointer reaches BlockNote so the first click
// can place its caret; the next React update still owns the editable prop.
function activateDocumentEditor(editor:{isEditable:boolean}){editor.isEditable=true;}
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
function DocumentEditor({card,editable=true,autoFocus=false,onActivate,onChange,language}:EditorProps&{language:'en'|'zh'}){
 // Initialization is per card/language, never per input or geometry update.
 // A region excerpt already displays its source image in the quote above. The
 // document remains the user's records; existing saved blocks stay intact.
 const documentCard=useMemo(()=>card.pdfExcerpt&&card.image?{...card,image:undefined}:card,[card]);
 const [initialContent]=useState(()=>cardDocument(documentCard));
 const [echo]=useState(()=>new CardDocumentEcho());
 const dictionary=useMemo(()=>{
  const base=language==='zh'?zh:en;
  // The current code block preserves code formatting but has no highlighter.
  return {...base,slash_menu:{...base.slash_menu,code_block:{...base.slash_menu.code_block,subtext:language==='zh'?'保留缩进与等宽字体的代码块':'Code with preserved indentation and monospace text'}}};
 },[language]);
 const blockTypes=useMemo(()=>blockTypeSelectItems(dictionary).filter(item=>item.type!=='heading'||Number(item.props?.level)<=4),[dictionary]);
 const placeholder=editorPlaceholder(language,!!card.pdfExcerpt);
 const wrapper=useRef<HTMLDivElement>(null);
 const mounted=useRef(true);
 const pendingImports=useRef(new Set<AbortController>());
 const [importing,setImporting]=useState(0);
 const [fileError,setFileError]=useState('');
 const uploadFile=useCallback((file:File)=>storeUploadedFile(file,file.name),[]);
 const editor=useCreateBlockNote({schema:documentSchema,dictionary:{...dictionary,placeholders:{...dictionary.placeholders,default:placeholder,emptyDocument:placeholder}},initialContent,uploadFile,links:{onClick:event=>{const anchor=event.target instanceof Element?event.target.closest('a[href]'):null;const id=anchor&&contentLinkId(anchor.getAttribute('href')||'');if(!id)return false;event.preventDefault();window.dispatchEvent(new CustomEvent(openContentLinkEvent,{detail:id}));return true;}},resolveFileUrl:async url=>resolveDocumentImage(resolveWorkspace(url))},[]);
 useEffect(()=>{mounted.current=true;const pending=pendingImports.current;return()=>{mounted.current=false;for(const operation of pending)operation.abort();};},[]);
 useEffect(()=>{if(!wrapper.current)return;return registerDocumentBlockDrag({element:wrapper.current,view:editor.prosemirrorView,isEditable:()=>editor.isEditable,onDragEnd:()=>{const menu=editor.getExtension(SideMenuExtension);menu?.blockDragEnd();if(menu?.menuFrozen)menu.unfreezeMenu();menu?.hideMenuIfNotFrozen();}});},[editor]);
 useEffect(()=>{if(autoFocus&&editable)editor.focus();},[autoFocus,editable,editor]);
 const current=useRef(onChange);
 useLayoutEffect(()=>{current.current=onChange;},[onChange]);
 const syncing=useRef(false);
 useLayoutEffect(()=>{if(!echo.receive(documentCard))return;syncing.current=true;
  try{editor.replaceBlocks(editor.document,cardDocument(documentCard,text=>editor.tryParseMarkdownToBlocks(text)));}
  finally{syncing.current=false;}
 },[echo,editor,documentCard]);
 const change=useCallback(()=>{
  if(!editable||syncing.current)return;
  const blocks=structuredClone(editor.document);
  const body=documentText(blocks);
  echo.local(blocks,body);
  current.current?.({blocks,body});
 },[editable,editor,echo]);
 const insertFiles=async(files:File[],point?:{x:number;y:number})=>{
  if(!editor.isEditable||!files.length)return;
  setFileError('');
  let anchor=editor.getTextCursorPosition().block;
  let placement:'before'|'after'='after';
  if(point){
   const pos=editor.prosemirrorView.posAtCoords({left:point.x,top:point.y});
   const node=pos&&editor.prosemirrorView.domAtPos(pos.pos).node;
   const element=node instanceof Element?node:node?.parentElement;
   const block=element?.closest<HTMLElement>('[data-id]');
   const found=block?.dataset.id&&editor.getBlock(block.dataset.id);
   if(found){anchor=found;const rect=block!.getBoundingClientRect();placement=point.y<(rect.top+rect.bottom)/2?'before':'after';}
  }
  const operation=new AbortController();
  pendingImports.current.add(operation);setImporting(count=>count+1);
  try{
   // Store bytes before inserting, so closing or undoing a pending import never
   // leaves an empty media block behind. A batch is one complete undo step.
   const blocks=await Promise.all(files.map(async file=>({type:documentMediaKind(file),props:{name:file.name,url:await uploadFile(file)}})));
   if(!mounted.current||operation.signal.aborted||!editor.isEditable||!editor.getBlock(anchor.id))return;
   editor.insertBlocks(blocks,anchor,placement);
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
 return <div ref={wrapper} onDragEnterCapture={dragFiles} onDragOverCapture={dragFiles} onDropCapture={receiveFiles} onPasteCapture={receiveFiles} onKeyDownCapture={event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='z')for(const operation of pendingImports.current)operation.abort();}} onPointerDownCapture={()=>{if(!editable&&onActivate){activateDocumentEditor(editor);onActivate();}}} className={`block-document ${editable?'is-editable':'is-readonly'}`}>
  {importing>0&&<output className="document-file-status">{language==='zh'?'正在保存文件…':'Saving files…'}</output>}
  {fileError&&<p className="document-file-error" role="alert">{fileError}</p>}
  <BlockNoteView editor={editor} theme="dark" editable={editable} sideMenu={false} formattingToolbar={false} onChange={change}><FormattingToolbarController formattingToolbar={()=> <FormattingToolbar blockTypeSelectItems={blockTypes}/>}/><SideMenuController sideMenu={()=> <SideMenu><DragHandleButton/></SideMenu>}/></BlockNoteView>
 </div>;
}
