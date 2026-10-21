import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {readUuidPages,scheduleReads} from '../server/paginated-read.mjs';
import {createAuth} from '../server/auth.mjs';
import {photos} from '../server/photo-api.mjs';
import {replyStatic} from '../server/static-response.mjs';
import {gunzipSync} from 'node:zlib';
const pause=()=>new Promise(resolve=>setImmediate(resolve));

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
