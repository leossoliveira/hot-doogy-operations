import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {readUuidPages,scheduleReads} from '../server/paginated-read.mjs';
import {createAuth} from '../server/auth.mjs';
import {photos} from '../server/photo-api.mjs';
import {replyStatic} from '../server/static-response.mjs';
import {gunzipSync} from 'node:zlib';
import {readTables,TABLES,workspaceReadGroups} from '../server/live-data.mjs';
import {staffTables} from '../server/staff-access.mjs';
const pause=()=>new Promise(resolve=>setImmediate(resolve));

test('batched first pages avoid repeated reads while complete remaining history retains its token and bounds',async()=>{
 const sales=Array.from({length:16050},(_,i)=>({id:`${Math.floor(i/16050*0x100000000).toString(16).padStart(8,'0')}-0000-4000-8000-${String(i).padStart(12,'0')}`}));
 for(const role of ['owner','staff']){
  let batches=0,reads=0,active=0,peak=0;const requested=[];
  const auth={request:async(path,{token,body})=>{
   assert.equal(token,'scoped-token');active++;peak=Math.max(peak,active);await pause();active--;
   if(path.endsWith('/workspace_read_batch')){batches++;assert.ok(body.p_tables.length<=8);requested.push(...body.p_tables);return Object.fromEntries(body.p_tables.map(table=>[table,table==='sales_item_facts'?sales.slice(0,1000):[]]));}
   reads++;assert.equal(path,'/rest/v1/rpc/workspace_sales_page');
   return sales.filter(row=>(!body.p_after||row.id>body.p_after)&&(!body.p_lower||row.id>=body.p_lower)&&(!body.p_upper||row.id<body.p_upper)).slice(0,body.p_limit);
  }};
  const result=await readTables(auth,'scoped-token',role,{batch:true});
  assert.deepEqual([...requested].sort(),TABLES.filter(table=>role!=='staff'||staffTables.has(table)).sort());assert.equal(batches,workspaceReadGroups(requested).length);assert.equal(peak,2);
  assert.deepEqual(result.sales_item_facts,role==='staff'?[]:sales);if(role==='staff')assert.equal(reads,0);
 }
 await assert.rejects(readTables({request:async()=>({})},'scoped-token','owner',{batch:true}),/Incomplete workspace batch/);
});

test('public assets compress, revalidate unchanged content and immediately deliver changed content',async()=>{
 const response=()=>({writeHead(status,headers){this.status=status;this.headers=headers;},end(body){this.body=body;}});
 const body=Buffer.from('const synthetic = true;\n'.repeat(200)),headers={'Content-Type':'text/javascript','X-Content-Type-Options':'nosniff'};
 const first=response();await replyStatic({method:'GET',headers:{'accept-encoding':'gzip'}},first,body,headers);
 assert.equal(first.headers['Cache-Control'],'no-cache');assert.equal(first.headers['Content-Encoding'],'gzip');assert.deepEqual(gunzipSync(first.body),body);assert.ok(first.body.length<body.length/2);
 const same=response();await replyStatic({method:'GET',headers:{'if-none-match':first.headers.ETag}},same,body,headers);assert.equal(same.status,304);assert.equal(same.body,undefined);
 const changed=response();await replyStatic({method:'GET',headers:{'if-none-match':first.headers.ETag,'accept-encoding':'gzip;q=0'}},changed,Buffer.from('changed'),headers);assert.equal(changed.status,200);assert.notEqual(changed.headers.ETag,first.headers.ETag);assert.equal(changed.body.toString(),'changed');assert.equal(changed.headers['Content-Encoding'],undefined);
 const head=response();await replyStatic({method:'HEAD',headers:{}},head,body,headers);assert.equal(head.body,undefined);assert.equal(head.headers['Content-Length'],body.length);
});

test('UUID ranges read complete history in order with bounded parallelism and unchanged filters',async()=>{
 const rows=Array.from({length:256},(_,i)=>({id:i.toString(16).padStart(2,'0')+'000000-0000-4000-8000-000000000000'}));
 let active=0,peak=0;
 const read=scheduleReads(async path=>{
  const url=new URL(path,'http://test');assert.equal(url.searchParams.get('organization_id'),'eq.synthetic');assert.equal(url.searchParams.get('order'),'id');assert.ok(!url.searchParams.has('offset'));
  active++;peak=Math.max(peak,active);await pause();active--;
  return rows.filter(row=>url.searchParams.getAll('id').every(filter=>{const [op,value]=filter.split('.');return op==='gt'?row.id>value:op==='gte'?row.id>=value:row.id<value;})).slice(0,Number(url.searchParams.get('limit')));
 },4);
 assert.deepEqual(await readUuidPages(read,'/facts?organization_id=eq.synthetic&order=id',{pageSize:7}),rows);
 assert.ok(peak>1&&peak<=4);
 let calls=0;assert.deepEqual(await readUuidPages(async()=>{calls++;return rows.slice(0,2);},'/facts?order=id',{pageSize:7}),rows.slice(0,2));assert.equal(calls,1);
 await assert.rejects(readUuidPages(async()=>[{id:'invalid'}],'/facts?order=id'),/pagination key/);
 const aborted=AbortSignal.abort(Error('cancelled'));await assert.rejects(readUuidPages(async()=>{throw Error('must not read');},'/facts?order=id',{signal:aborted}),/cancelled/);
});

test('parallel authenticated requests share live validation; the next request detects revocation',async()=>{
 let held=false,release,calls=0,revoked=false;
 const auth=createAuth({now:()=>1000,fetcher:async url=>{
  if(!url.includes('/token?')){calls++;if(held)await new Promise(resolve=>{const previous=release;release=()=>{previous?.();resolve();};});}
  return Response.json(url.includes('/token?')?{access_token:'synthetic',refresh_token:'synthetic',expires_in:3600,user:{id:'user'}}:url.endsWith('/user')?{id:'user'}:url.endsWith('/operations_auth_status')?{active:!revoked,allowed:!revoked,mfa_verified:false}:[{role:'manager'}]);
 }});
 const req=body=>Object.assign(Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]),{headers:{},socket:{remoteAddress:'synthetic'},method:body?'POST':'GET'});
 let cookie;await auth.handle(req({email:'test@example.invalid',password:'synthetic'}),{setHeader:(key,value)=>{if(key==='Set-Cookie')cookie=value.split(';')[0];},writeHead(){},end(){}},new URL('http://test/api/auth/login'));
 calls=0;held=true;
 const requests=Array.from({length:20},()=>{const r=req();r.headers.cookie=cookie;return auth.requireSession(r);});await pause();assert.equal(calls,3);held=false;release();await Promise.all(requests);
 revoked=true;const next=req();next.headers.cookie=cookie;await assert.rejects(auth.requireSession(next),error=>error.status===401);assert.equal(calls,6);
});

test('individual photos read only the requested record through the user token and deny missing access before storage',async()=>{
 const id='11111111-1111-4111-8111-111111111111',alias='22222222-2222-4222-8222-222222222222';
 for(const kind of ['items','recipes']){
  const paths=[];let accessed=0;
  const auth={request:async(path,options)=>{assert.equal(options.token,'user-token');paths.push(path);return kind==='items'?[{id:alias,inventory_item_id:id}]:[{id}];}};
  const options={loadConfig:async()=>({}),storageFactory:(_config,_fetch,aliases)=>({read:async(k,key)=>{assert.equal(k,kind);assert.equal(key,id);if(kind==='items')assert.equal(aliases[id],alias);accessed++;return Buffer.from('synthetic');}})};
  await photos({method:'GET'},{writeHead(){},end(){}},new URL(`http://test/api/photos/${kind}/${id}`),auth,{token:'user-token'},options);
  assert.equal(paths.length,1);assert.ok(paths[0].includes(`${kind==='items'?'inventory_item_id':'id'}=eq.${id}`));assert.equal(accessed,1);
  await assert.rejects(photos({method:'GET'},{},new URL(`http://test/api/photos/${kind}/${id}`),{request:async()=>[]},{token:'user-token'},options),error=>error.status===404);assert.equal(accessed,1);
 }
});

test('workspace timeouts split read-only batches without losing tables or caller scope',async()=>{
 const successful=[],sizes=[];
 const result=await readTables({request:async(path,{token,body,signal})=>{
  assert.equal(token,'scoped-token');assert.equal(signal.aborted,false);
  assert.ok(path.endsWith('/workspace_read_batch'));sizes.push(body.p_tables.length);
  if(body.p_tables.length>2)throw Object.assign(Error('timeout'),{databaseCode:'57014'});
  successful.push(...body.p_tables);
  return Object.fromEntries(body.p_tables.map(table=>[table,[]]));
 }},'scoped-token','owner',{batch:true});
 assert.deepEqual(successful.sort(),[...TABLES].sort());assert.equal(Object.keys(result).length,TABLES.length);assert.ok(sizes.includes(8)&&sizes.includes(2));
 for(const code of ['42501','57014']){
  let calls=0;
  await assert.rejects(readTables({request:async()=>{calls++;throw Object.assign(Error('failed'),{databaseCode:code});}},'scoped-token','owner',{batch:true}),/failed/);
  assert.ok(calls<=TABLES.length*2);
 }
});

test('history continuation starts before an unrelated first batch finishes, without returning partial data',async()=>{
 let releaseSlow,continued,finished=false;
 const slow=new Promise(resolve=>{releaseSlow=resolve;}),continuation=new Promise(resolve=>{continued=resolve;});
 const rows=Array.from({length:501},(_,i)=>({id:String(i).padStart(6,'0')}));
 let active=0,peak=0;
 const pending=readTables({request:async(path,{body,token,signal})=>{
  assert.equal(token,'pipeline-token');assert.equal(signal.aborted,false);active++;peak=Math.max(peak,active);
  try{
   if(body?.p_tables){
    if(body.p_tables.includes('waste_events'))await slow;
    return Object.fromEntries(body.p_tables.map(table=>[table,table==='invoice_lines'?rows.slice(0,500):[]]));
   }
   assert.match(path,/\/invoice_lines\?/);assert.match(path,/id=gt.000499/);continued();return rows.slice(500);
  }finally{active--;}
 }},'pipeline-token','owner',{batch:true}).then(value=>{finished=true;return value;});
 try{
  // The slow batch is intentionally held: waiting for all first pages would
  // deadlock here. No timing threshold is needed to demonstrate the overlap.
  await Promise.race([continuation,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Continuation blocked by unrelated batch')),1000);timer.unref();})]);
  assert.equal(finished,false);assert.ok(peak<=8);
 }finally{releaseSlow();}
 const result=await pending;assert.deepEqual(result.invoice_lines,rows);assert.equal(Object.keys(result).length,TABLES.length);
});

test('a late first-page failure aborts the workspace even after other histories complete',async()=>{
 let continued;const continuation=new Promise(resolve=>{continued=resolve;});let sharedSignal;
 await assert.rejects(readTables({request:async(path,{body,signal})=>{
  sharedSignal=signal;
  if(body?.p_tables){
   if(body.p_tables.includes('waste_events')){await continuation;throw Error('late batch failure');}
   return Object.fromEntries(body.p_tables.map(table=>[table,table==='invoice_lines'?Array.from({length:500},(_,i)=>({id:String(i).padStart(6,'0')})):[]]));
  }
  continued();return [];
 }},'pipeline-token','owner',{batch:true}),/late batch failure/);
 assert.equal(sharedSignal.aborted,true);
});
