import {pdfLayoutPort} from './pdf-layout-port.mjs';

// The Worker owns model credentials; the isolated layout engine receives only
// the PDF and verified paragraph translations through this local-only bridge.
export function createPdfLayoutProxy(fetcher:typeof fetch=fetch,options:{port?:number|string}={}){
 const port=pdfLayoutPort(options.port);
 const unavailable=()=>Response.json({error:'原版式服务尚未启动，可稍后重试或使用普通翻译。'},{status:503,headers:{'Cache-Control':'no-store'}});
 return async function proxy(request:Request){
  const url=new URL(request.url);
  if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||(request.headers.get('origin')&&request.headers.get('origin')!==url.origin))return Response.json({error:'当前版式接口仅供本机使用。'},{status:403});
  if(!['GET','POST'].includes(request.method))return new Response(null,{status:405});
  const headers=new Headers({'X-Lumior-Layout':'1'});
  if(request.headers.has('content-type'))headers.set('Content-Type',request.headers.get('content-type')!);
  for(const name of ['X-Lumior-Job-Id','X-Lumior-Owner-Id','X-Lumior-Owner-Generation'])if(request.headers.has(name))headers.set(name,request.headers.get(name)!);
  try{
   // Never forward cookies, authorization, arbitrary paths or caller URLs.
   const body=request.method==='POST'?await request.arrayBuffer():undefined;
   if(body&&body.byteLength>27*1024*1024)return Response.json({error:'PDF 超过原版式翻译容量，请拆分文件。'},{status:413});
   const response=await fetcher(`http://127.0.0.1:${port}/${request.method==='GET'?'health':'api'}`,{method:request.method,headers,body,signal:AbortSignal.any([request.signal,AbortSignal.timeout(30_000)])});
   const outputHeaders=new Headers({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
   for(const name of ['content-type','content-length'])if(response.headers.has(name))outputHeaders.set(name,response.headers.get(name)!);
   return new Response(response.body,{status:response.status,headers:outputHeaders});
  }catch{if(request.signal.aborted)throw request.signal.reason;return unavailable();}
 };
}
