import test from 'node:test';
import assert from 'node:assert/strict';
import {createReadBudget,readCalculationPage} from '../server/read-budget.mjs';
import {calculatePreparationUsage,queuePreparationUsage} from '../server/preparation-usage.mjs';
const pause=()=>new Promise(resolve=>setImmediate(resolve));
test('list reads take idle slots before the next calculation and never overlap a heavy page',async()=>{
 const budget=createReadBudget(2),events=[];let releaseCalculation,releaseReads,activeReads=0;
 const calculationGate=new Promise(resolve=>releaseCalculation=resolve),readGate=new Promise(resolve=>releaseReads=resolve);
 const first=budget.calculate(async()=>{events.push('calculation');assert.equal(activeReads,0);await calculationGate;events.push('calculation ended');});
 await pause();
 const reads=Array.from({length:2},(_,i)=>budget.read(async()=>{activeReads++;events.push('read '+i);await readGate;activeReads--;}));
 const next=budget.calculate(()=>{assert.equal(activeReads,0);events.push('next calculation');});
 await pause();assert.deepEqual(events,['calculation']);releaseCalculation();await first;await pause();assert.deepEqual(events,['calculation','calculation ended','read 0','read 1']);
 releaseReads();await Promise.all([...reads,next]);assert.equal(events.at(-1),'next calculation');
 await assert.rejects(budget.calculate(()=>{throw Error('failed');}),/failed/);assert.equal(await budget.read(()=>42),42);
});
test('confirmed calculation timeout shrinks the page without skipping or double counting records',async()=>{
 const calls=[];
 const result=await calculatePreparationUsage({request:async(_path,{body})=>{
  calls.push([body.p_offset,body.p_limit]);if(body.p_limit>12)throw Object.assign(Error('timeout'),{databaseCode:'57014'});
  const processed=Math.min(body.p_limit,25-body.p_offset);
  return {meta:{processed},rows:[{date:'2026-10-20',locationId:'store',itemId:'item',baseQty:processed}],days:[{date:'2026-10-20',locationId:'store',totalLines:processed,incompleteLines:0}]};
 }},{token:'synthetic'},{start:'2026-10-20',end:'2026-10-20',location:'store'});
 assert.deepEqual(calls,[[0,25],[0,12],[12,12],[24,12]]);assert.equal(result.rows[0].baseQty,25);assert.equal(result.days[0].totalLines,25);
 let networkCalls=0;await assert.rejects(readCalculationPage(()=>{networkCalls++;throw Error('connection lost');}),/connection lost/);assert.equal(networkCalls,1);
 const sizes=[];await assert.rejects(readCalculationPage(size=>{sizes.push(size);throw Object.assign(Error('timeout'),{databaseCode:'57014'});}),/timeout/);assert.deepEqual(sizes,[25,12,6,3,1]);
});
test('deferred preparation jobs remain single-flight past five minutes',async()=>{
 let now=0,calls=0,finish;const session={},range={start:'2026-10-20',end:'2026-10-20',location:'store'};
 const calculate=()=>{calls++;return new Promise(resolve=>finish=resolve);};
 queuePreparationUsage({},session,range,{calculate,now:()=>now});await pause();now=600000;
 assert.equal(queuePreparationUsage({},session,range,{calculate,now:()=>now}).status,'loading');await pause();assert.equal(calls,1);finish({rows:[],days:[]});await pause();
});
