import type {PdfLayoutArtifact,PdfTranslation} from './pdf-translation.ts';

export async function readLayoutPdf(layout:PdfLayoutArtifact,fetcher:typeof fetch=fetch){
 if(!layout.url||!Number.isSafeInteger(layout.size)||layout.size<=0||!/^([a-f0-9]{64})$/.test(layout.sha256))throw new Error('译文 PDF 的保存记录不完整，请重新生成。');
 let response:Response;
 try{response=await fetcher(layout.url);}catch{throw new Error('无法读取已保存的译文 PDF，请重新生成。');}
 if(!response.ok)throw new Error('无法读取已保存的译文 PDF，请重新生成。');
 const bytes=await response.arrayBuffer();
 const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
 if(bytes.byteLength!==layout.size||digest!==layout.sha256)throw new Error('译文 PDF 完整性校验失败，请重新生成后再导出。');
 if(!new TextDecoder().decode(bytes.slice(0,1024)).includes('%PDF-'))throw new Error('保存的译文不是有效 PDF，请重新生成。');
 return new Blob([bytes],{type:'application/pdf'});
}

export async function createLayoutTranslationFile(title:string,translation:PdfTranslation,fetcher:typeof fetch=fetch){
 if(!translation.complete||translation.mode!=='original-layout'||!translation.layout)throw new Error('请完成原版式翻译后再导出 PDF。');
 const blob=await readLayoutPdf(translation.layout,fetcher);
 return new File([blob],`${title} · 中文译文.pdf`,{type:'application/pdf'});
}
