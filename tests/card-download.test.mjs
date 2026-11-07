import test from 'node:test';
import assert from 'node:assert/strict';
import { cardDownloadSource, mediaDownloadName, prepareCardDownload } from '../app/card-download.ts';
import { fileUrl, releaseFileUrls } from '../app/workspace-assets.ts';

const card = values => ({id:'card',title:'Media',body:'',kind:'image',x:0,y:0,width:360,...values});

test('downloads select original PDFs, images and local videos, never covers or remote video pages',()=>{
  assert.equal(cardDownloadSource(card({kind:'pdf',pdf:{url:'lumior-file:original',name:'Research.pdf',thumbnail:'blob:cover'}})).url,'lumior-file:original');
  assert.equal(cardDownloadSource(card({image:'blob:photo'})).url,'blob:photo');
  assert.equal(cardDownloadSource(card({kind:'video',video:{url:'https://youtube.com/watch?v=abc',poster:'blob:poster'}})),undefined);
  assert.equal(cardDownloadSource(card({kind:'video',video:{localUrl:'blob:original',poster:'blob:poster'}})).url,'blob:original');
  assert.equal(cardDownloadSource(card({kind:'note',image:'blob:decorative'})),undefined);
  assert.equal(cardDownloadSource(card({kind:'image'})),undefined);
});

test('stored and hydrated media preserve the original bytes and original filename without network access',async()=>{
  const original=new Blob(['%PDF-1.7 original attachment'],{type:'application/pdf'});
  const stored={id:'pdf-source',name:'Original research.pdf',size:original.size,type:original.type,blob:original};
  try {
    for(const source of ['lumior-file:pdf-source',fileUrl(stored)]) {
      const result=await prepareCardDownload(card({kind:'pdf',pdf:{url:source,name:'Renamed.pdf',thumbnail:'data:image/png;base64,broken'}}),{
        getFile:async id=>{assert.equal(id,'pdf-source');return stored;},fetcher:async()=>{throw new Error('Should not fetch stored attachments');},
      });
      assert.equal(result.blob,original);assert.equal(result.name,'Original research.pdf');assert.equal(await result.blob.text(),await original.text());
    }
  } finally {releaseFileUrls();}
});

test('static images download original bytes with credentialless bounded requests',async()=>{
  const bytes=new Uint8Array([0x89,0x50,0x4e,0x47,1,2,3]);
  const result=await prepareCardDownload(card({image:'/assets/original.png',sourceName:'Photo.png'}),{origin:'http://localhost:43272',fetcher:async(url,init)=>{
    assert.equal(url,'http://localhost:43272/assets/original.png');assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');assert.ok(init.signal);
    return new Response(bytes,{headers:{'Content-Type':'image/png'}});
  }});
  assert.deepEqual(new Uint8Array(await result.blob.arrayBuffer()),bytes);assert.equal(result.name,'Photo.png');
});

test('missing files, executable URLs, HTML errors and excessive responses fail without producing a download',async()=>{
  await assert.rejects(prepareCardDownload(card({image:'lumior-file:missing'}),{getFile:async()=>undefined}),/missing/);
  for(const image of ['javascript:alert(1)','file:///etc/passwd','https://user:secret@example.com/image.png','data:text/html;base64,SGk='])
    await assert.rejects(prepareCardDownload(card({image}),{origin:'https://lumior.work',fetcher:async()=>{assert.fail('must not fetch');}}),/Unsupported/);
  await assert.rejects(prepareCardDownload(card({image:'/missing'}),{origin:'https://lumior.work',fetcher:async()=>new Response('<html>Error</html>',{headers:{'content-type':'text/html'}})}),/unavailable/);
  let cancelled=false;
  await assert.rejects(prepareCardDownload(card({image:'/large'}),{origin:'https://lumior.work',fetcher:async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'content-length':String(26*1024*1024)}})}),/Could not read/);
  assert.equal(cancelled,true);
});

test('download names preserve media formats and remove platform-invalid names and executable extensions',()=>{
  assert.equal(mediaDownloadName('Screenshot.exe','image','image/png'),'Screenshot.png');
  assert.equal(mediaDownloadName('CON','pdf','application/pdf'),'_CON.pdf');
  assert.equal(mediaDownloadName('../folder\\file:1.jpg','image','image/jpeg'),'.._folder_file_1.jpg');
  assert.equal(mediaDownloadName('动画.gif','image','image/gif'),'动画.gif');
  assert.equal(mediaDownloadName('clip.mov','video','video/quicktime'),'clip.mov');
  assert.throws(()=>mediaDownloadName('image.mp4','image','video/mp4'),/Unexpected/);
});
