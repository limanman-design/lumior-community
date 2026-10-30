/* oxlint-disable typescript/await-thenable -- Preserve document parsing; supported editor versions may return a value or a promise. */
import { translate } from './i18n-core.ts';
import type {Card} from './canvas-model';
import {documentText} from './card-document';
import {storeUploadedFile} from './local-repository';
import {importedImageWidth, importedPreviewHeight} from './imported-media-layout.ts';
export type ImportedCard=Pick<Card,'title'|'body'|'kind'|'blocks'|'pdf'|'sourceName'|'height'|'image'|'video'|'bibliography'|'authors'|'year'>;
export const MAX_FILE_BYTES=25*1024*1024;
export const MAX_VIDEO_BYTES=250*1024*1024;
export function validateFile(file:Pick<File,'name'|'size'>){
 if(!file.size)throw new Error(translate("This file is empty.", "文件为空。"));
 const ext=file.name.split('.').pop()?.toLowerCase();
 if(['mp4','webm','mov'].includes(ext||'')){
  if(file.size>MAX_VIDEO_BYTES)throw new Error(translate("Please choose a video smaller than 250 MB.", "请选择小于 250 MB 的视频。"));
  return ext!;
 }
 if(file.size>MAX_FILE_BYTES)throw new Error(translate("Please choose a file smaller than 25 MB.", "请选择小于 25 MB 的文件。"));
 if(ext==='doc')throw new Error(translate("Save this older Word file as .docx, then import it again.", "请将旧版 Word 文件另存为 .docx 后重新导入。"));
 if(!['docx','pdf','txt','md','png','jpg','jpeg','webp','gif'].includes(ext||''))throw new Error(translate("Supported formats: DOCX, PDF, TXT, Markdown, PNG, JPG, WEBP, GIF, MP4, WEBM and MOV.", "支持格式：DOCX、PDF、TXT、Markdown、PNG、JPG、WEBP、GIF、MP4、WEBM 和 MOV。"));
 return ext!;
}
export async function importFile(file:File):Promise<ImportedCard>{
 const ext=validateFile(file),title=file.name.replace(/\.[^.]+$/,'')||file.name;
 if(['mp4','webm','mov'].includes(ext)){
  const preview=URL.createObjectURL(file),video=document.createElement('video');
  video.preload='auto';video.muted=true;video.playsInline=true;
  try{
   await new Promise<void>((resolve,reject)=>{
    const timer=setTimeout(()=>{video.onloadeddata=null;video.onerror=null;reject(new Error(translate("This video could not be opened in this browser.", "当前浏览器无法打开这个视频。")));},15000);
    const finish=(error?:Error)=>{clearTimeout(timer);video.onloadeddata=null;video.onerror=null;if(error)reject(error);else resolve();};
    video.onloadeddata=()=>finish();video.onerror=()=>finish(new Error(translate("This video format or codec is not supported by this browser. Try MP4 with H.264.", "当前浏览器不支持此视频格式或编码，请尝试使用 H.264 编码的 MP4。")));video.src=preview;
   });
   if(!Number.isFinite(video.duration)||video.duration<=0)throw new Error(translate("Could not read this video duration.", "无法读取视频时长。"));
   // A short seek avoids the black opening frame used by many trailers.
   await new Promise<void>(resolve=>{
    const timer=setTimeout(()=>{video.onseeked=null;resolve();},4000);
    video.onseeked=()=>{clearTimeout(timer);video.onseeked=null;resolve();};
    video.currentTime=Math.min(3,video.duration*.1);
   });
   const canvas=document.createElement('canvas');canvas.width=Math.min(960,video.videoWidth);canvas.height=Math.round(canvas.width*video.videoHeight/video.videoWidth);
   canvas.getContext('2d')?.drawImage(video,0,0,canvas.width,canvas.height);
   const cover=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/jpeg',.82));
   const url=await storeUploadedFile(file,file.name),poster=cover?await storeUploadedFile(cover,`${title}-poster.jpg`):'';
   return {title,body:'',kind:'video',sourceName:file.name,height:360,video:{url,localUrl:url,poster,duration:video.duration}};
  }finally{video.onloadeddata=null;video.onerror=null;video.onseeked=null;video.removeAttribute('src');video.load();URL.revokeObjectURL(preview);}
 }
 if(['png','jpg','jpeg','webp','gif'].includes(ext)){
  const preview=URL.createObjectURL(file);
  let height:number;
  try{const picture=new Image();picture.src=preview;await picture.decode();if(!picture.naturalWidth||!picture.naturalHeight)throw new Error(translate("Empty image", "图片为空"));height=importedPreviewHeight(picture.naturalWidth,picture.naturalHeight,importedImageWidth);}
  catch{throw new Error(translate("Could not open this image. Check that it is complete and not damaged.", "无法打开图片，请检查文件是否完整且未损坏。"));}
  finally{URL.revokeObjectURL(preview);}
  const image=await storeUploadedFile(file,file.name);return {title,body:'',sourceName:file.name,kind:'image',image,height};
 }
 if(ext==='pdf'){
  const head=await file.slice(0,1024).text();if(!head.includes('%PDF-'))throw new Error(translate("This file is not a valid PDF.", "此文件不是有效的 PDF。"));
  const url=URL.createObjectURL(new Blob([file],{type:'application/pdf'}));
  let cover;try{const {pdfCover}=await import('./pdf-runtime');cover=await pdfCover(url);}catch(error){if((error as Error).name==='PasswordException')throw new Error(translate("This PDF is password protected. Unlock it before importing.", "此 PDF 有密码保护，请解锁后再导入。"));throw new Error(translate("Could not open this PDF. Check that it is complete and not damaged.", "无法打开 PDF，请检查文件是否完整且未损坏。"));}finally{URL.revokeObjectURL(url);}
  const {cardHeight,...pdfCover}=cover;
  const savedUrl=await storeUploadedFile(new Blob([file],{type:'application/pdf'}),file.name);return {title,body:file.name,kind:'pdf',sourceName:file.name,height:cardHeight,bibliography:{status:'pending'},pdf:{url:savedUrl,name:file.name,size:file.size,...pdfCover}};
 }
 if(ext==='txt')return {title,body:await file.text(),kind:'note',sourceName:file.name,height:440};
 const {BlockNoteEditor}=await import('@blocknote/core');const editor=BlockNoteEditor.create();
 try{
  let blocks;
  if(ext==='md')blocks=await editor.tryParseMarkdownToBlocks(await file.text());
  else{
   const [{default:mammoth},{default:purify}]=await Promise.all([import('mammoth/mammoth.browser.js'),import('dompurify')]);
   let html:string;try{html=(await mammoth.convertToHtml({arrayBuffer:await file.arrayBuffer()},{includeDefaultStyleMap:true})).value;}catch{throw new Error(translate("Could not read this Word document. Save a fresh .docx copy and try again.", "无法读取 Word 文档，请另存为新的 .docx 后重试。"));}
   if(html.length>12*1024*1024)throw new Error(translate("The converted document is too large. Try splitting it into smaller documents.", "转换后的文档过大，请拆分为较小的文档后重试。"));
   const clean=purify.sanitize(html,{USE_PROFILES:{html:true},FORBID_TAGS:['style','iframe','object','embed','form'],FORBID_ATTR:['style']});
   const doc=new DOMParser().parseFromString(clean,'text/html');
   doc.querySelectorAll('img').forEach(img=>{if(!/^data:image\/(png|jpeg|gif|webp);base64,/i.test(img.getAttribute('src')||''))img.remove();});
   blocks=editor.tryParseHTMLToBlocks(doc.body.innerHTML);
  }
  const body=documentText(blocks);if(!body.trim()&&!JSON.stringify(blocks).includes('"image"'))throw new Error(translate("No readable content was found in this document.", "文档中没有可读取的内容。"));
  return {title,body,blocks,kind:'note',sourceName:file.name,height:440};
 }finally{editor.unmount();}
}
