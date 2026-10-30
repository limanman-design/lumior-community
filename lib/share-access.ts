export type ShareEnv = {LUMIOR_SHARE_PASSWORD?:string;LUMIOR_SHARE_SECRET?:string};
const encoder=new TextEncoder();
const cookieName='lumior_share';
const lifetime=60*60*24;
function hex(bytes:ArrayBuffer){return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');}
async function sign(value:string,secret:string){const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return hex(await crypto.subtle.sign('HMAC',key,encoder.encode(value)));}
async function equal(a:string,b:string){const [x,y]=await Promise.all([crypto.subtle.digest('SHA-256',encoder.encode(a)),crypto.subtle.digest('SHA-256',encoder.encode(b))]);const xx=new Uint8Array(x),yy=new Uint8Array(y);let diff=0;for(let i=0;i<xx.length;i++)diff|=xx[i]^yy[i];return diff===0;}
function screen(error=''){return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lumior · 私密预览</title><style>*{box-sizing:border-box}body{margin:0;background:#101010;color:#eee;font:16px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;min-height:100dvh;display:grid;place-items:center;padding:24px}.box{width:min(100%,380px);padding:36px;background:#191919;border:1px solid #303030;border-radius:20px}h1{font-size:30px;font-weight:550;letter-spacing:-1px;margin:0 0 12px}p{color:#999;font-size:14px;line-height:1.6;margin:0 0 28px}label{display:block;font-size:14px;margin-bottom:10px}input,button{width:100%;border-radius:9px;font:inherit;padding:13px 14px}input{background:#101010;border:1px solid #454545;color:#fff;outline:none}input:focus{border-color:#aaa}button{margin-top:18px;background:#eee;color:#141414;border:0;cursor:pointer}button:hover{background:#fff}.error{color:#edaaa0;font-size:14px;margin-top:12px}</style><main class="box"><h1>Lumior</h1><p>私密原型预览 · 输入访问密码以继续</p><form action="/__share/login" method="post"><label for="password">访问密码</label><input id="password" name="password" type="password" required maxlength="128" autocomplete="current-password" autofocus>${error?`<div class="error" role="alert">${error}</div>`:''}<button type="submit">进入画板</button></form></main></html>`;}
const headers={'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'self' https://*.chatgpt.com https://chatgpt.com"};
export async function shareAccess(request:Request,env:ShareEnv):Promise<Response|null>{
 const url=new URL(request.url);
 // Only local development is accessible without configured sharing secrets.
 if(!env.LUMIOR_SHARE_PASSWORD||!env.LUMIOR_SHARE_SECRET){if(url.hostname==='localhost'||url.hostname==='127.0.0.1')return null;return new Response('Private preview is unavailable.',{status:503,headers:{'Cache-Control':'no-store'}});}
 const secret=env.LUMIOR_SHARE_SECRET+env.LUMIOR_SHARE_PASSWORD;
 if(url.pathname==='/__share/login'&&request.method==='POST'){
  if(request.headers.get('origin')!==url.origin)return new Response('Forbidden',{status:403});
  if(Number(request.headers.get('content-length')||0)>2048)return new Response('Request too large',{status:413});
  const body=await request.text();if(body.length>2048)return new Response('Request too large',{status:413});
  const password=new URLSearchParams(body).get('password')||'';
  if(password.length<=128&&await equal(password,env.LUMIOR_SHARE_PASSWORD)){
   const expires=Math.floor(Date.now()/1000)+lifetime,value=String(expires),signature=await sign(value,secret);
   return new Response(null,{status:303,headers:{Location:'/', 'Cache-Control':'no-store','Set-Cookie':`${cookieName}=${value}.${signature}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${lifetime}`}});
  }
  return new Response(screen('密码不正确，请重新输入。'),{status:401,headers});
 }
 const token=request.headers.get('cookie')?.split(';').map(c=>c.trim()).find(c=>c.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'';
 const [expires,signature]=token.split('.');const now=Math.floor(Date.now()/1000);
 if(/^\d{10}$/.test(expires||'')&&Number(expires)>now&&Number(expires)<=now+lifetime&&/^[a-f0-9]{64}$/.test(signature||'')&&await equal(signature,await sign(expires,secret)))return null;
 if(request.method==='GET'&&request.headers.get('accept')?.includes('text/html'))return new Response(screen(),{status:200,headers});
 return new Response('Password required',{status:401,headers:{'Cache-Control':'no-store'}});
}
