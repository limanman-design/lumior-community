import handler from 'vinext/server/fetch-handler';
export default {
 async fetch(request:Request,env:Record<string,unknown>,ctx:ExecutionContext){
  const response=await handler.fetch(request,env,ctx);
  const result=new Response(response.body,response);
  result.headers.set('Cache-Control','private, no-store');
  result.headers.set('X-Robots-Tag','noindex, nofollow');
  return result;
 }
};
