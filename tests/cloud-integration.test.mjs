import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createAuth} from '../server/auth.mjs';
import {projectData,readTables,TABLES} from '../server/live-data.mjs';
import {createRefreshLoop} from '../src/cloud.js';
const response=data=>({ok:true,status:200,json:async()=>data});
function request(body,cookie){return Object.assign(Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]),{headers:{cookie},socket:{remoteAddress:'test'},method:body?'POST':'GET'});}
function res(){return {headers:{},setHeader(k,v){this.headers[k]=v;},writeHead(s,h){this.status=s;Object.assign(this.headers,h);},end(s){this.body=s;}};}
test('login requires active membership; session uses HttpOnly cookie, not browser tokens',async()=>{
 const auth=createAuth({fetcher:async url=>response(url.endsWith('/operations_auth_status')?{active:true,allowed:true,mfa_verified:false}:url.includes('/token?')?{access_token:'access',refresh_token:'refresh',expires_in:3600,user:{id:'user',email:'test@example.invalid'}}:url.endsWith('/user')?{id:'user'}:[{id:'member',role:'manager',status:'active'}])});
 const r=res();await auth.handle(request({email:'test@example.invalid',password:'test-only'}),r,new URL('http://localhost/api/auth/login'));
 assert.match(r.headers['Set-Cookie'],/HttpOnly; SameSite=Strict/);assert.doesNotMatch(r.body,/access_token|refresh_token/);
 const cookie=r.headers['Set-Cookie'].split(';')[0];assert.equal((await auth.requireSession(request(null,cookie))).member.role,'manager');
 await assert.rejects(auth.requireSession(request(null,'hd_session=forged')),e=>e.status===401);
 await auth.handle(Object.assign(request({},cookie),{method:'POST'}),res(),new URL('http://localhost/api/auth/logout'));
 await assert.rejects(auth.requireSession(request(null,cookie)),e=>e.status===401);
});
test('membership removal revokes next request even with unexpired token',async()=>{
 let active=true;const auth=createAuth({fetcher:async url=>response(url.endsWith('/operations_auth_status')?{active:true,allowed:true,mfa_verified:false}:url.includes('/token?')?{access_token:'access',refresh_token:'refresh',expires_in:3600,user:{id:'user'}}:url.endsWith('/user')?{id:'user'}:active?[{role:'manager'}]:[])});const r=res();await auth.handle(request({email:'a',password:'b'}),r,new URL('http://localhost/api/auth/login'));active=false;
 await assert.rejects(auth.requireSession(request(null,r.headers['Set-Cookie'].split(';')[0])),e=>e.status===403);
});
test('data reader paginates beyond 1000 and forwards user token to RLS',async()=>{
 const seen=[];const auth={request:async(url,{token})=>{assert.equal(token,'user-token');seen.push(url);return url.startsWith('/rest/v1/sales_item_facts?')?(url.includes('offset=0')?Array.from({length:1000},(_,id)=>({id})):[{id:1001}]):[];}};
 const raw=await readTables(auth,'user-token');assert.equal(raw.sales_item_facts.length,1001);assert.ok(seen.some(s=>s.includes('organization_id=eq.')));
});
test('refresh loop defers during editing and never overlaps requests',async()=>{
 const target=new EventTarget();let allowed=false,count=0,release;const loop=createRefreshLoop({target,interval:999999,canRefresh:()=>allowed,refresh:async()=>{count++;await new Promise(r=>release=r);},onError:()=>{}});
 await loop.tick();assert.equal(count,0);allowed=true;const pending=loop.tick();await loop.tick();assert.equal(count,1);release();await pending;loop.stop();await loop.tick();assert.equal(count,1);
});
