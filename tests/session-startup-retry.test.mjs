import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceTables} from './fixtures/workspace.mjs';
import {projectData,TABLES} from '../server/live-data.mjs';
test('a session connection failure offers recovery without pretending the user signed out',async()=>{
 const raw=workspaceTables();
 const data=projectData(raw);data.meta.preparationSalesStatus='loading';data.preparationSales=null;
 let clicks;const nodes=new Map(),element=()=>({innerHTML:'',style:{setProperty(){}},classList:{add(){},remove(){},toggle(){}},querySelectorAll:()=>[],querySelector:()=>null,focus(){},remove(){},setAttribute(){}});
 const keys=['document','window','localStorage','location','history','requestAnimationFrame','fetch','setInterval','clearInterval','matchMedia','MutationObserver','innerHeight'];const old=Object.fromEntries(keys.map(k=>[k,globalThis[k]]));
 let tick,dataCalls=0,release,started;const requested=new Promise(r=>started=r);
 globalThis.matchMedia=()=>({matches:false,addEventListener(){}});globalThis.MutationObserver=class {observe(){} disconnect(){}};globalThis.innerHeight=900;
 globalThis.document={documentElement:element(),querySelector:s=>{if(!nodes.has(s))nodes.set(s,element());return nodes.get(s);},querySelectorAll:()=>[],addEventListener(type,fn){if(type==='click')clicks=fn;},body:element(),hidden:false};globalThis.window=new EventTarget();window.scrollTo=()=>{};globalThis.localStorage={getItem:()=>null};globalThis.location={hash:'#login'};globalThis.history={replaceState(){}};globalThis.requestAnimationFrame=fn=>fn();globalThis.setInterval=fn=>{tick=fn;return 1;};globalThis.clearInterval=()=>{};
 let authCalls=0;
 globalThis.fetch=async url=>{if(url==='/api/auth/session'){authCalls++;if(authCalls===1)throw TypeError('connection lost');return {ok:true,json:async()=>({user:{email:'test@example.invalid'},role:'admin'})};}if(url==='/api/photos')return new Promise(()=>{});if(url==='/api/data?scope=overview'){dataCalls++;return {ok:true,json:async()=>data};}throw Error(url);};
 try{await import('../src/app.js');assert.match(nodes.get('#app').innerHTML,/Try again/);assert.doesNotMatch(nodes.get('#app').innerHTML,/login-password/);assert.equal(dataCalls,0);const button={dataset:{action:'boot-retry'},disabled:false};await clicks({preventDefault(){},target:{closest:s=>s==='[data-action]'?button:null}});assert.match(document.title,/Overview/);assert.equal(authCalls,2);assert.equal(dataCalls,1);}finally{for(const k of keys)globalThis[k]=old[k];}
});
