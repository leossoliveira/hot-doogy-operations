import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createAuth} from '../server/auth.mjs';
import {createCatalogDraft} from '../src/catalog-draft.js';
import {api} from '../src/cloud.js';
const memory=()=>{const data=new Map();return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};};
test('draft survives reopening and retries exactly the original command and payload',()=>{
 const storage=memory(),options={storage,key:'user:vendor',uuid:()=> 'command-1'};
 const first=createCatalogDraft(options);first.capture([['name','Cup lid'],['locations','one'],['locations','two']]);
 const sent=first.prepare('item',{name:'Cup lid',locations:[{id:'one'},{id:'two'}]});
 const reopened=createCatalogDraft(options);
 assert.deepEqual(reopened.value.fields,first.value.fields);
 reopened.capture([['name','Accidental edit']]);
 assert.deepEqual(reopened.prepare('item',{name:'Changed'}),sent);
 reopened.complete();assert.equal(storage.getItem(options.key),null);
});
test('draft scope, expiry, unavailable storage and definitive rejection',()=>{
 const storage=memory();let now=0;
 const draft=createCatalogDraft({storage,key:'user:a',now:()=>now,uuid:()=> 'first'});
 draft.capture([['name','Draft']]);draft.prepare('item',{name:'Draft'});draft.rejected();
 draft.capture([['name','Corrected']]);assert.equal(draft.value.fields[0][1],'Corrected');
 assert.deepEqual(createCatalogDraft({storage,key:'other:a'}).value.fields,[]);
 now=8*86400000;assert.deepEqual(createCatalogDraft({storage,key:'user:a',now:()=>now}).value.fields,[]);
 const blocked=createCatalogDraft({key:'blocked'});assert.equal(blocked.capture([['name','Kept in memory']]),false);assert.equal(blocked.value.fields.length,1);
});
const response=(data,status=200)=>({ok:status<400,status,json:async()=>data});
const req=(body,cookie)=>Object.assign(Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]),{headers:{cookie},socket:{remoteAddress:'test'},method:body?'POST':'GET'});
const res=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},writeHead(){},end(){}});
for(const failure of ['network','upstream','invalid'])test('token refresh '+failure+' preserves only recoverable sessions',async()=>{
 let now=0,mode='ok',refreshes=0;
 const auth=createAuth({now:()=>now,fetcher:async url=>{
  if(url.includes('grant_type=refresh_token')){refreshes++;if(mode==='network')throw TypeError('fetch failed');if(mode==='upstream')return response({message:'unavailable'},503);if(mode==='invalid')return response({error_code:'refresh_token_not_found'},400);}
  return response(url.includes('/token?')?{access_token:'access',refresh_token:'refresh',expires_in:3600,user:{id:'user'}}:url.endsWith('/user')?{id:'user'}:url.endsWith('/operations_auth_status')?{active:true,allowed:true,mfa_verified:false}:[{role:'manager'}]);
 }});
 const login=res();await auth.handle(req({email:'test@example.invalid',password:'test'}),login,new URL('http://localhost/api/auth/login'));
 const cookie=login.headers['Set-Cookie'].split(';')[0];now=3550000;mode=failure;
 await assert.rejects(auth.requireSession(req(null,cookie)),e=>e.status===(failure==='invalid'?401:503));
 mode='ok';
 if(failure==='invalid'){await assert.rejects(auth.requireSession(req(null,cookie)),e=>e.status===401);assert.equal(refreshes,1);}
 else{assert.equal((await auth.requireSession(req(null,cookie))).member.role,'manager');assert.equal(refreshes,2);}
});
test('API reports interrupted responses without automatically replaying a mutation',async()=>{
 const original=globalThis.fetch;let calls=0;
 try{globalThis.fetch=async()=>{calls++;return {ok:true,json:async()=>{throw SyntaxError('incomplete');}};};await assert.rejects(api('/api/catalog/create',{commandId:'same'}),e=>e.status===503&&/could not be confirmed/.test(e.message));assert.equal(calls,1);}finally{globalThis.fetch=original;}
});

test('interrupted provider body is temporary and empty successful writes remain valid',async()=>{
 const interrupted=createAuth({fetcher:async()=>({ok:true,status:200,json:async()=>{throw SyntaxError('truncated');}})});
 await assert.rejects(interrupted.request('/auth/v1/user'),e=>e.status===503);
 const empty=createAuth({fetcher:async()=>({ok:true,status:204,json:async()=>{throw SyntaxError('empty');}})});
 assert.equal(await empty.request('/rest/v1/supplier_items',{method:'PATCH',body:{active:true}}),null);
});
test('a pending receipt retains its command identity after seven days',()=>{
 const storage=memory(),original=createCatalogDraft({storage,key:'pending',now:()=>0,uuid:()=> 'original'});
 const request=original.prepare('item',{name:'Lid'});
 const reopened=createCatalogDraft({storage,key:'pending',now:()=>8*86400000});
 assert.deepEqual(reopened.value.pending,request);
});
