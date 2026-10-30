import test from 'node:test';
import assert from 'node:assert/strict';
import {createPdfLayoutProxy} from '../lib/pdf-layout-proxy.ts';
import {pdfLayoutPort} from '../lib/pdf-layout-port.mjs';

test('layout bridge rejects foreign pages and never forwards credentials or caller destinations',async()=>{
 let seen;
 const proxy=createPdfLayoutProxy(async(url,init)=>{seen={url,init};return Response.json({stage:'prepared'});});
 assert.equal((await proxy(new Request('https://foreign.example/api/pdf-layout',{method:'POST',body:'{}'}))).status,403);
 assert.equal((await proxy(new Request('http://localhost:3001/api/pdf-layout',{method:'POST',headers:{origin:'https://foreign.example'},body:'{}'}))).status,403);
 assert.equal(seen,undefined);
 const response=await proxy(new Request('http://localhost:3001/api/pdf-layout?url=https://foreign.example',{method:'POST',headers:{origin:'http://localhost:3001',cookie:'private-cookie',authorization:'private-credential','content-type':'application/json'},body:JSON.stringify({action:'status',jobId:'test'})}));
 assert.equal(response.status,200);assert.equal(seen.url,'http://127.0.0.1:3021/api');
 assert.equal(seen.init.headers.get('cookie'),null);assert.equal(seen.init.headers.get('authorization'),null);assert.equal(seen.init.headers.get('origin'),null);
 assert.equal(seen.init.headers.get('X-Lumior-Layout'),'1');
 assert.deepEqual(JSON.parse(new TextDecoder().decode(seen.init.body)),{action:'status',jobId:'test'});
});
test('layout bridge returns the exact PDF bytes and a useful unavailable-service error',async()=>{
 const bytes=new TextEncoder().encode('%PDF-1.7\nverified-pdf-bytes');
 const proxy=createPdfLayoutProxy(async()=>new Response(bytes,{headers:{'content-type':'application/pdf','content-length':String(bytes.length)}}));
 const response=await proxy(new Request('http://localhost:3001/api/pdf-layout',{method:'POST',body:'{}'}));
 assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);assert.equal(response.headers.get('cache-control'),'no-store');
 const unavailable=createPdfLayoutProxy(async()=>{throw new Error('private local diagnostic');});
 const failure=await unavailable(new Request('http://localhost:3001/api/pdf-layout'));
 assert.equal(failure.status,503);const message=await failure.text();assert.match(message,/普通翻译/);assert.ok(!message.includes('diagnostic'));
});

test('layout bridge uses only the configured loopback port for health and API requests',async()=>{
 const calls=[];
 const proxy=createPdfLayoutProxy(async(url)=>{calls.push(url);return Response.json({available:true});},{port:'43221'});
 await proxy(new Request('http://localhost:43220/api/pdf-layout?port=80&url=https://foreign.example'));
 await proxy(new Request('http://localhost:43220/api/pdf-layout',{method:'POST',body:'{}'}));
 assert.deepEqual(calls,['http://127.0.0.1:43221/health','http://127.0.0.1:43221/api']);
});

test('layout port defaults to 3021 and rejects invalid configuration before fetching',()=>{
 assert.equal(pdfLayoutPort(),3021);
 assert.equal(pdfLayoutPort('65535'),65535);
 assert.equal(pdfLayoutPort(1),1);
 for(const port of [0,65536,-1,1.5,'',' ','3021/path','127.0.0.1:3021','1e3',true,NaN,Infinity]){
  assert.throws(()=>pdfLayoutPort(port),RangeError);
  assert.throws(()=>createPdfLayoutProxy(async()=>{throw new Error('must not fetch');},{port}),RangeError);
 }
});
