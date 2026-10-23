import test from 'node:test';
import assert from 'node:assert/strict';
import {createReadBudget} from '../server/read-budget.mjs';
import {createWorkspaceReader} from '../server/workspace-read.mjs';
import {createRefreshLoop} from '../src/cloud.js';
const pause=()=>new Promise(resolve=>setImmediate(resolve));
test('default read budget bounds concurrent work across callers',async()=>{
 const budget=createReadBudget();let active=0,peak=0;
 await Promise.all(Array.from({length:20},()=>budget.read(async()=>{active++;peak=Math.max(peak,active);await pause();active--;})));
 assert.equal(peak,4);
});
test('full and expired queues reject without running stale work; subsequent work recovers',async()=>{
 let now=0,release,ran=0;const budget=createReadBudget(1,{maxQueue:2,maxWaitMs:100,now:()=>now});
 const first=budget.read(()=>new Promise(resolve=>release=resolve));await pause();
 const queued=budget.read(()=>ran++),calculation=budget.calculate(()=>ran++);
 const settled=Promise.allSettled([queued,calculation]);
 await assert.rejects(budget.read(()=>ran++),e=>e.status===503);
 now=101;release();await first;
 for(const result of await settled){assert.equal(result.status,'rejected');assert.equal(result.reason.status,503);}
 assert.equal(ran,0);assert.equal(await budget.calculate(()=>42),42);assert.equal(await budget.read(()=>43),43);
});
test('workspace overload cooldown survives writes and does not retain successful data',async()=>{
 let now=0,calls=0,fail=true;const reader=createWorkspaceReader({now:()=>now,read:async()=>{calls++;if(fail)throw Object.assign(Error('busy'),{status:503});return {calls};}}),session={token:'one',member:{role:'manager'}};
 await assert.rejects(reader.read({},session));reader.invalidate(session);
 await assert.rejects(reader.read({},session));assert.equal(calls,1);
 now=30000;fail=false;assert.deepEqual(await reader.read({},session),{calls:2});assert.deepEqual(await reader.read({},session),{calls:3});
});
test('authorization errors do not start workspace overload cooldown',async()=>{
 let calls=0;const reader=createWorkspaceReader({read:async()=>{calls++;throw Object.assign(Error('denied'),{status:403});}}),session={token:'one',member:{role:'manager'}};
 await assert.rejects(reader.read({},session));await assert.rejects(reader.read({},session));assert.equal(calls,2);
});
test('focus storms obey minimum interval and failures back off before recovery',async()=>{
 let now=0,calls=0,fail=false;const target=new EventTarget(),loop=createRefreshLoop({target,interval:1000,now:()=>now,canRefresh:()=>true,onError:()=>{},refresh:async()=>{calls++;if(fail)throw Error('busy');}});
 try{
  await loop.tick();for(let i=0;i<20;i++)target.dispatchEvent(new Event('focus'));await pause();assert.equal(calls,1);
  now=1000;fail=true;await loop.tick();assert.equal(calls,2);
  now=2000;await loop.tick();assert.equal(calls,2);
  now=3000;await loop.tick();assert.equal(calls,3);
  now=6000;await loop.tick();assert.equal(calls,3);
  now=7000;fail=false;await loop.tick();assert.equal(calls,4);
  now=8000;await loop.tick();assert.equal(calls,5);
 }finally{loop.stop();}
});
test('post-save refresh yields to form closure and coalesces notifications',async()=>{
 const {createDeferredRefresh}=await import('../src/cloud.js');const events=[],scheduled=[];
 const refresh=createDeferredRefresh({schedule:fn=>scheduled.push(fn),run:owner=>events.push('refresh '+owner)});
 refresh('old');refresh('latest');events.push('closed');assert.deepEqual(events,['closed']);assert.equal(scheduled.length,1);
 scheduled.shift()();assert.deepEqual(events,['closed','refresh latest']);refresh('next');assert.equal(scheduled.length,1);
});
