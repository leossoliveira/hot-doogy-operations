import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {createAuth} from '../server/auth.mjs';
import {readCursorPages} from '../server/paginated-read.mjs';
import {readTables} from '../server/live-data.mjs';
import {createWorkspaceReader} from '../server/workspace-read.mjs';
import {drainServer} from '../server/graceful-shutdown.mjs';
import {createSaveAttempt} from '../src/save-attempt.js';
import {queueSalesSummary,salesSummary} from '../server/sales-summary.mjs';

const pause=()=>new Promise(r=>setImmediate(r));
test('database validation, conflict and timeout are distinguished from gateway failures for every RPC',async()=>{
 for(const route of ['operations_command','save_llm_invoice_draft','catalog_create','hr_save','my_day_save'])for(const [code,status] of [['P0001',422],['23505',409],['40001',409],['42501',403],['57014',503],['23503',422]]){
  // Catalog creation has an existing 400 validation contract.
  const expected=route==='catalog_create'&&['P0001','23505','23503'].includes(code)?(code==='P0001'?422:400):status;
  const auth=createAuth({fetcher:async()=>({ok:false,status:400,json:async()=>({code,message:'Invalid data.'})})});
  await assert.rejects(auth.request('/rest/v1/rpc/'+route,{method:'POST',body:{}}),e=>e.status===expected);
 }
});
test('keyset pages preserve all rows, detect a non-advancing source and stop on failure',async()=>{
 const calls=[];const result=await readCursorPages(async url=>{calls.push(url);return url.includes('gt.b')?[{id:'c'}]:[{id:'a'},{id:'b'}];},'/rows?order=id',{pageSize:2});
 assert.deepEqual(result.map(r=>r.id),['a','b','c']);assert.equal(calls.length,2);assert.ok(calls.every(url=>!url.includes('offset=')));
 await assert.rejects(readCursorPages(async()=>[{id:'a'}],'/rows?order=id',{pageSize:1}),/advance/);
 let reads=0;await assert.rejects(readTables({request:async()=>{reads++;throw Error('failed first table');}},'test','owner'),/failed first table/);await pause();assert.ok(reads<=4);
});
test('overlapping refreshes share work only inside one session and writes invalidate in-flight reads',async()=>{
 const releases=[];let count=0;const reader=createWorkspaceReader({read:()=>{count++;return new Promise(r=>releases.push(r));}}),session={token:'a',member:{role:'owner'}},other={token:'b',member:{role:'owner'}};
 const first=reader.read({},session),same=reader.read({},session),different=reader.read({},other);assert.equal(first,same);await pause();assert.equal(count,2);
 reader.invalidate(session);const after=reader.read({},session);await pause();assert.equal(count,3);
 releases.forEach((r,i)=>r(i));assert.deepEqual(await Promise.all([first,same,different,after]),[0,0,1,2]);
});
test('unknown save outcome replays the exact payload and definitive rejection unlocks correction',async()=>{
 const attempt=createSaveAttempt();let changes=1,builds=0;const build=()=>({id:'original',value:changes,build:++builds});
 await assert.rejects(attempt.run(build,async value=>{assert.equal(value.value,1);throw Object.assign(Error('lost response'),{status:503});}));changes=2;
 const result=await attempt.run(build,async value=>value);assert.equal(result.value,1);assert.equal(builds,1);assert.equal(attempt.pending,null);
 await assert.rejects(attempt.run(build,async()=>{throw Object.assign(Error('statement rolled back'),{status:503,rejected:true});}));assert.equal(attempt.pending,null);
 assert.equal((await attempt.run(build,async x=>x)).value,2);
});
test('ordinary workspace reads never launch sales calculations',async()=>{
 const session={};let calls=0;const options={start:false,calculate:async()=>{calls++;}};
 for(let i=0;i<30;i++)assert.equal(queueSalesSummary({},session,{},options).status,'idle');await pause();assert.equal(calls,0);
});
test('background calculations share a global one-query budget and use bounded pages',async()=>{
 let active=0,peak=0,total=0;const auth={request:async(path,{body})=>{active++;peak=Math.max(peak,active);assert.equal(body.p_limit,25);await pause();active--;total++;return {rows:[],itemRows:[],days:[],issues:[]};}};
 await Promise.all(Array.from({length:3},(_,i)=>salesSummary(auth,{token:String(i)},{sales_item_facts:Array.from({length:101},()=>({source_row_id:'row'}))})));
 assert.equal(peak,1);assert.equal(total,15);
});
test('deployment shutdown drains accepted writes before closing the server',async()=>{
 let finish;const started=new Promise(r=>finish=r);let release;const gate=new Promise(r=>release=r);
 const server=http.createServer(async(req,res)=>{finish();await gate;res.end('saved');});server.listen(0,'127.0.0.1');await once(server,'listening');
 let drained=false,done;const completed=new Promise(resolve=>done=resolve);const request=fetch(`http://127.0.0.1:${server.address().port}`,{method:'POST',body:'write'});await started;
 const shutdown=drainServer(server,{timeout:1000,onDrained:()=>{drained=true;done();}});shutdown();await pause();assert.equal(drained,false);release();assert.equal(await (await request).text(),'saved');await completed;assert.equal(drained,true);shutdown();
});

test('read-only POST timeouts do not claim unsaved changes',async()=>{
 const auth=createAuth({fetcher:async()=>({ok:false,status:500,json:async()=>({code:'57014'})})});
 for(const route of ['workspace_read_batch','operations_auth_status','operations_command']){
  await assert.rejects(auth.request('/rest/v1/rpc/'+route,{method:'POST',body:{}}),error=>error.status===503&&error.message.includes('Your changes have not been saved')===(route==='operations_command'));
 }
});
