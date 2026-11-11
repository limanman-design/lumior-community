import test from 'node:test';
import assert from 'node:assert/strict';
import {connectionInput,readConnections,readConnectionInput,connectionPreviewImages} from '../app/daily-connections.ts';
import {createDailyConnectionsService} from '../lib/daily-connections-service.ts';
const source={id:'daily',title:'散步观察',excerpt:'散步帮助整理思路'};
const input={language:'zh',captures:[source],boards:[{id:'board',title:'写作',sources:[{id:'old',title:'写作准备',excerpt:'通过步行理清写作想法'}]}]};
const result={contentId:'daily',boardId:'board',sourceId:'old',reason:'可以比较散步对思考的帮助',captureQuote:'整理思路',sourceQuote:'步行理清写作'};
const request=(body=input)=>new Request('http://localhost:5188/api/daily-connections',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const sse=text=>new Response('data: '+JSON.stringify({choices:[{delta:{content:text},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
void test('discovery output requires real source IDs, literal evidence and one count per fragment',()=>{
  assert.equal(readConnections([result],input).length,1);
  for(const change of [{contentId:'invented'},{sourceId:'invented'},{boardId:'invented'},{captureQuote:'并不存在的原文'},{sourceQuote:'并不存在的原文'},{reason:''}])assert.throws(()=>readConnections([{...result,...change}],input));
  assert.throws(()=>readConnections([result,result],input));assert.deepEqual(readConnections([],input),[]);
});
void test('scope rejects malformed and excessive material rather than silently dropping it',()=>{
  assert.deepEqual(readConnectionInput(input),input);
  for(const change of [{captures:[]},{captures:Array(13).fill(source)},{boards:[]},{language:'fr'},{captures:[{...source,excerpt:'x'.repeat(601)}]}])assert.throws(()=>readConnectionInput({...input,...change}));
});
void test('capture gestures and position changes do not change the model scope',()=>{
  const record={id:'daily',daily:{at:1,position:{x:0,y:0}},card:{title:'hello',body:'world'}};
  const board={id:'b',title:'library',cards:[{id:'c',kind:'note',title:'writing',body:'ideas'}]};
  const first=connectionInput([record],[board],'zh');
  assert.deepEqual(connectionInput([{...record,daily:{...record.daily,lastUsedAt:400,position:{x:99,y:80}}}],[{...board,cards:[{...board.cards[0],x:100,y:100}]}],'zh'),first);
  assert.notDeepEqual(connectionInput([{...record,card:{...record.card,body:'edited'}}],[board],'zh'),first);
});
void test('personal-key discovery uses unified provider transport with no follow-up calls',async()=>{
  let calls=0;
  const service=createDailyConnectionsService(()=>({provider:'deepseek',model:'deepseek-flash',key:'synthetic-key'}),async(url,init)=>{
    calls++;assert.equal(init.headers.Authorization,'Bearer synthetic-key');
    assert.deepEqual(JSON.parse(JSON.parse(init.body).messages.at(-1).content),input);
    return sse(JSON.stringify([result]));
  });
  const response=await service.POST(request());assert.equal(response.status,200);assert.equal((await response.json()).connections[0].contentId,'daily');assert.equal(calls,1);
});
void test('invalid output and upstream failure are not retried; missing permission is safe',async()=>{
  let calls=0;
  const service=createDailyConnectionsService(()=>({model:'deepseek-flash',key:'synthetic-key'}),async()=>{calls++;return sse(JSON.stringify([{...result,sourceId:'fake'}]));});
  assert.equal((await service.POST(request())).status,502);assert.equal(calls,1);
  const missing=createDailyConnectionsService(()=>({model:'deepseek-flash'}),async()=>{throw new Error('must not call');});
  assert.equal((await missing.GET(new Request('http://localhost:5188/api/daily-connections'))).status,200);
  assert.equal((await missing.POST(request())).status,503);
});
void test('remote and cross-origin callers cannot submit workspace content',async()=>{
  const service=createDailyConnectionsService(()=>({model:'deepseek-flash'}));
  for(const req of [new Request('https://external.test/api/daily-connections'),new Request('http://localhost:5188/api/daily-connections',{headers:{Origin:'https://evil.test'}})])assert.equal((await service.GET(req)).status,403);
});

void test('no-AI previews show newest image, video and PDF captures; connections show only related captures',()=>{
  const records=[
    {id:'image',daily:{at:1},card:{title:'Image',image:'image.jpg'}},
    {id:'note',daily:{at:5},card:{title:'Text only'}},
    {id:'pdf',daily:{at:3},card:{title:'PDF',pdf:{thumbnail:'pdf.jpg'}}},
    {id:'video',daily:{at:2},card:{title:'Video',video:{poster:'video.jpg'}}}
  ];
  assert.deepEqual(connectionPreviewImages(records,[]).map(item=>item.id),['pdf','video','image']);
  assert.deepEqual(connectionPreviewImages(records,[{contentId:'image'}]).map(item=>item.id),['image']);
  assert.deepEqual(connectionPreviewImages(records,[{contentId:'note'}]),[{id:'note',src:'',alt:'Text only'}]);
});

void test('largest declared discovery scope reaches the provider intact; excessive input never calls it',async()=>{
  const make=(id)=>({id,title:'Title '+id,excerpt:'文'.repeat(599)+'终'});
  const scope={language:'en',captures:Array.from({length:12},(_,i)=>make('c'+i)),boards:Array.from({length:8},(_,i)=>({id:'b'+i,title:'Board '+i,sources:Array.from({length:6},(_,j)=>make(i+'s'+j))}))};
  let calls=0;
  const service=createDailyConnectionsService(()=>({model:'deepseek-flash',key:'synthetic-key'}),async(_url,init)=>{
    calls++;assert.deepEqual(JSON.parse(JSON.parse(init.body).messages.at(-1).content),scope);return sse('[]');
  });
  assert.equal((await service.POST(request(scope))).status,200);
  assert.equal((await service.POST(request({...scope,padding:'x'.repeat(200001)}))).status,400);
  assert.equal(calls,1);
});

void test('one Daily capture can connect to distinct sources without duplicating the thumbnail',()=>{
  const scope={...input,boards:[{...input.boards[0],sources:[...input.boards[0].sources,{id:'other',title:'写作讨论',excerpt:'散步与写作的关系'}]}]};
  const edges=readConnections([result,{...result,sourceId:'other',sourceQuote:'散步与写作'}],scope);
  assert.equal(edges.length,2);assert.notEqual(edges[0].id,edges[1].id);
  assert.equal(connectionPreviewImages([{id:'daily',daily:{at:1},card:{title:'photo',image:'image.jpg'}}],edges).length,1);
});

void test('automatic discovery targets board card identities only and excludes Daily-to-Daily matches',()=>{
  const captures=[{id:'daily',card:{title:'New paper',body:'A method'}},{id:'other-daily',card:{title:'Another capture',body:'Some evidence'}}];
  const board={id:'b',title:'Existing work',cards:[
    {id:'instance',sharedId:'old',kind:'note',title:'Method needed',body:'Existing question'},
    {id:'duplicate',sharedId:'old',kind:'note',title:'Method needed',body:'Existing question'},
    {id:'daily-instance',sharedId:'other-daily',kind:'note',title:'Another capture',body:'Some evidence'},
  ]};
  const scope=connectionInput(captures,[board],'en');
  assert.deepEqual(scope.boards[0].sources.map(c=>c.id),['old']);
  const relation={contentId:'daily',boardId:'b',sourceId:'old',relation:'A reusable method',reason:'A method to inspect',captureQuote:'method',sourceQuote:'question'};
  assert.equal(readConnections([relation],scope).length,1);
  assert.throws(()=>readConnections([{...relation,sourceId:'loose-global-card'}],scope));
  assert.deepEqual(connectionInput(captures,[],'en').boards,[]);
  const malformed={...scope,boards:[{...scope.boards[0],sources:[...scope.boards[0].sources,{id:'other-daily',title:'Another capture',excerpt:'Some evidence'}]}]};
  assert.throws(()=>readConnections([{...relation,sourceId:'other-daily',sourceQuote:'evidence'}],malformed));
});
