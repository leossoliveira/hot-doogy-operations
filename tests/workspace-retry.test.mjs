import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {projectData,TABLES} from '../server/live-data.mjs';
test('a data timeout keeps authentication and offers a retry instead of returning to login',async()=>{
 const raw={};for(const t of TABLES)raw[t]=await readFile(new URL(`../audits/cloud-integration-2026-10-05/fixtures/${t}.json`,import.meta.url),'utf8').then(JSON.parse).catch(()=>[]);
 const data=projectData(raw);data.meta.preparationSalesStatus='loading';data.preparationSales=null;
 let clicks;const nodes=new Map(),element=()=>({innerHTML:'',style:{},classList:{add(){},remove(){}},querySelectorAll:()=>[],querySelector:()=>null,focus(){},remove(){},setAttribute(){}});
 const keys=['document','window','localStorage','location','history','requestAnimationFrame','fetch','setInterval','clearInterval'];const old=Object.fromEntries(keys.map(k=>[k,globalThis[k]]));
 let tick,dataCalls=0,release,started;const requested=new Promise(r=>started=r);
 globalThis.document={querySelector:s=>{if(!nodes.has(s))nodes.set(s,element());return nodes.get(s);},querySelectorAll:()=>[],addEventListener(type,fn){if(type==='click')clicks=fn;},body:element(),hidden:false};globalThis.window=new EventTarget();window.scrollTo=()=>{};globalThis.localStorage={getItem:()=>null};globalThis.location={hash:'#login'};globalThis.history={replaceState(){}};globalThis.requestAnimationFrame=fn=>fn();globalThis.setInterval=fn=>{tick=fn;return 1;};globalThis.clearInterval=()=>{};
 globalThis.fetch=async url=>{if(url==='/api/auth/session')return {ok:true,json:async()=>({user:{email:'test@example.invalid'},role:'admin'})};if(url==='/api/photos')return new Promise(()=>{});if(url==='/api/data'){dataCalls++;started();if(dataCalls===1){await new Promise(r=>release=r);throw new DOMException('Request timeout','TimeoutError');}return {ok:true,json:async()=>data};}throw Error(url);};
 try{const boot=import('../src/app.js');await requested;await tick();window.dispatchEvent(new Event('focus'));assert.equal(dataCalls,1);release();await boot;assert.match(nodes.get('#app').innerHTML,/You’re still signed in/);assert.match(nodes.get('#app').innerHTML,/Try again/);assert.doesNotMatch(nodes.get('#app').innerHTML,/login-password/);const button={dataset:{action:'boot-retry'},disabled:false};await clicks({preventDefault(){},target:{closest:s=>s==='[data-action]'?button:null}});assert.match(document.title,/Overview/);assert.equal(dataCalls,2);}finally{for(const k of keys)globalThis[k]=old[k];}
});
