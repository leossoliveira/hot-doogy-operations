import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createPhotoAdmission} from '../server/photo-admission.mjs';
const response=()=>Object.assign(new EventEmitter(),{destroyed:false});
test('thumbnail bursts are bounded before authorization and drain after failures',async()=>{
 const admit=createPhotoAdmission(2);let active=0,peak=0;
 const jobs=Array.from({length:30},(_,i)=>(async()=>{
  const release=await admit(response());active++;peak=Math.max(peak,active);
  try{await new Promise(resolve=>setImmediate(resolve));if(i===3)throw Error('storage failed');}
  finally{active--;release();release();}
 })());
 const results=await Promise.allSettled(jobs);
 assert.equal(peak,2);assert.equal(active,0);assert.equal(results.filter(r=>r.status==='rejected').length,1);
 const release=await admit(response());release();
});
test('disconnected queued thumbnails do not run and queue overload is bounded',async()=>{
 const admit=createPhotoAdmission(1,1),first=await admit(response()),closed=response();
 const waiting=admit(closed);await assert.rejects(admit(response()),e=>e.status===503);
 closed.destroyed=true;closed.emit('close');assert.equal(await waiting,null);
 const next=admit(response());first();const release=await next;release();
 assert.equal(closed.listenerCount('close'),0);
 assert.equal(await admit(Object.assign(response(),{destroyed:true})),null);
});
