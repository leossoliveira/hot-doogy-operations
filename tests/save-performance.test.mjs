import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduleReads} from '../server/paginated-read.mjs';
import {readTables,projectData} from '../server/live-data.mjs';
import {operationsFixture} from './fixtures/save-refresh.mjs';

test('Concurrent users share a bounded read budget and histories use cursor pages',async()=>{
 let active=0,peak=0;const calls=[];
 const auth={request:async(path,{token})=>{
  assert.ok(['user-a','user-b','user-c'].includes(token));active++;peak=Math.max(peak,active);
  const url=new URL(path,'https://test.invalid'),table=url.pathname.split('/').at(-1),after=url.searchParams.get('id'),offset=after?Number(after.slice(3))+1:0,limit=Number(url.searchParams.get('limit'));
  assert.equal(url.searchParams.has('offset'),false);calls.push([token,table,offset]);await new Promise(resolve=>setImmediate(resolve));active--;
  const total=table==='stock_count_lines'?4500:0;
  return Array.from({length:Math.max(0,Math.min(limit,total-offset))},(_,i)=>({id:String(offset+i).padStart(6,'0')}));
 }};
 const values=await Promise.all(['user-a','user-b','user-c'].map(token=>readTables(auth,token,'owner')));
 assert.equal(peak,2);
 for(const raw of values){assert.equal(raw.stock_count_lines.length,4500);assert.deepEqual(raw.stock_count_lines.map(x=>Number(x.id)),Array.from({length:4500},(_,i)=>i));}
 assert.ok(calls.some(([,table,offset])=>table==='stock_count_lines'&&offset===4000));
});

test('Read scheduler releases slots after rejection and synchronous errors without caching',async()=>{
 let n=0;const read=scheduleReads(()=>{if(++n===1)throw Error('unavailable');return n;},1);
 const results=await Promise.allSettled([read(),read(),read()]);
 assert.equal(results[0].status,'rejected');assert.equal(results[1].value,2);assert.equal(results[2].value,3);
 assert.equal(await read(),4);
});

test('Indexed refresh preserves supplier prices, latest counts, versions and raw history',()=>{
 const raw=operationsFixture(30),before=structuredClone(raw),data=projectData(raw);
 assert.deepEqual(raw,before);
 for(let i=0;i<30;i++){
  const item=data.supplierCatalog.items.find(x=>x.id==='vendor-'+i);
  assert.equal(item.itemId,'item-'+i);assert.equal(item.price,10);assert.equal(item.priceHistory.length,10);
  assert.deepEqual(item.priceHistory.map(x=>x.amount),[10,9,8,7,6,5,4,3,2,1]);
  assert.equal(item.currentPrices.length,1);assert.equal(item.units[0].itemUnitId,'iu-'+i);
  const row=data.inventoryCounts.rows.find(x=>x.itemId==='item-'+i);
  assert.equal(row.baseQty,10);assert.equal(row.areas[0].entries[0].quantity,10);
  const recipe=data.recipes.find(x=>x.id==='recipe-'+i);
  assert.equal(recipe.version,3);assert.equal(recipe.activeVersionId,'recipe-'+i+'-v2');
  assert.equal(recipe.components[0].itemId,'item-'+i);assert.equal(recipe.steps[0].instruction,'Step 3');
 }
});

// Read endpoints used immediately after saving should transfer compressed data.
test('HR, careers and My Day reloads negotiate compression without changing records',async()=>{
 const {gunzipSync}=await import('node:zlib');
 const {hrAPI}=await import('../server/hr.mjs');
 const {careersAPI}=await import('../server/careers.mjs');
 const {myDayAPI}=await import('../server/my-day.mjs');
 const records=Array.from({length:30},(_,i)=>({id:'record-'+i,title:'Operational record',name:'Team member',status:'todo'}));
 for(const [handler,path,key] of [[hrAPI,'/api/hr','team'],[careersAPI,'/api/hr/careers','applications'],[myDayAPI,'/api/my-day','procedures']]){
  let body,headers;
  const auth={request:async(url,options)=>{
   assert.equal(options.token,'test-user');
   return url.includes('shift_handover_team')?{team:records}:url.includes('shift_handover_actions')?[]:records;
  }};
  await handler({method:'GET',headers:{'accept-encoding':'gzip'}},{writeHead(status,h){assert.equal(status,200);headers=h;},end(b){body=b;}},new URL(path,'http://test.invalid'),auth,{token:'test-user',member:{role:handler===myDayAPI?'staff':'admin'}});
  assert.equal(headers['Content-Encoding'],'gzip');assert.equal(headers['Cache-Control'],'no-store');
  assert.deepEqual(JSON.parse(gunzipSync(body))[key],records);
 }
});
