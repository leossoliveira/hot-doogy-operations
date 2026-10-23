import test from 'node:test';
import assert from 'node:assert/strict';
import {readCursorPages} from '../server/paginated-read.mjs';
import {readTables,TABLES,workspaceReadGroups} from '../server/live-data.mjs';
import {ORGANIZATION_ID} from '../server/supabase-config.mjs';
const pause=()=>new Promise(resolve=>setImmediate(resolve));
const rows=(count,skew=false)=>Array.from({length:count},(_,i)=>({id:`${(skew?0x10000000+i:Math.floor(i/count*0x100000000)).toString(16).padStart(8,'0')}-0000-4000-8000-000000000000`,value:i}));
function select(data,path){const p=new URL(path,'http://test').searchParams;return data.filter(row=>p.getAll('id').every(filter=>{const [op,value]=filter.split('.');return op==='gt'?row.id>value:op==='gte'?row.id>=value:row.id<value;})).slice(0,Number(p.get('limit')));}
test('larger continuation pages retain all rows across empty, short, exact and skewed ranges',async()=>{
 for(const count of [0,1,499,500,501,999,1000,1001,1499,1500,1501,2445,2499,2500,2501,3715,3735])for(const skew of [false,true]){
  const data=rows(count,skew),firstPage=data.slice(0,500);let calls=0;
  const actual=await readCursorPages(async path=>{calls++;return select(data,path);},'/history?order=id',{pageSize:1000,firstPageSize:500,firstPage});
  assert.deepEqual(actual,data);assert.equal(new Set(actual.map(row=>row.id)).size,count);
  if(count<500)assert.equal(calls,0);else assert.equal(calls,Math.floor((count-500)/1000)+1);
 }
});
test('history refuses nonadvancing cursors and propagates continuation failure',async()=>{
 const data=rows(3000);
 await assert.rejects(readCursorPages(async()=>Array(1000).fill(data[499]),'/history',{pageSize:1000,firstPageSize:500,firstPage:data.slice(0,500)}),/did not advance/);
 await assert.rejects(readCursorPages(async path=>{if(path.includes(data[1499].id))throw Error('page failed');return select(data,path);},'/history?order=id',{pageSize:1000,firstPageSize:500,firstPage:data.slice(0,500)}),/page failed/);
});
test('large histories and sales across simultaneous users share the same two-read ceiling',async()=>{
 const data={invoice_lines:rows(3715),purchase_order_lines:rows(3735),inventory_transactions:rows(2445),sales_item_facts:rows(16050)};
 let active=0,peak=0;const tokens=new Set();
 const auth={request:async(path,{token,body,signal})=>{
  tokens.add(token);assert.equal(signal.aborted,false);active++;peak=Math.max(peak,active);
  try{await pause();
   if(body?.p_tables)return Object.fromEntries(body.p_tables.map(table=>[table,(data[table]||[]).slice(0,table==='sales_item_facts'?1000:500)]));
   if(path.endsWith('/workspace_sales_page'))return data.sales_item_facts.filter(row=>(!body.p_after||row.id>body.p_after)&&(!body.p_lower||row.id>=body.p_lower)&&(!body.p_upper||row.id<body.p_upper)).slice(0,body.p_limit);
   assert.equal(new URL(path,'http://test').searchParams.get('organization_id'),'eq.'+ORGANIZATION_ID);
   return select(data[path.split('?')[0].split('/').at(-1)],path);
  }finally{active--;}
 }};
 const results=await Promise.all(['a','b','c'].map(token=>readTables(auth,token,'owner',{batch:true})));
 assert.equal(peak,2);assert.equal(tokens.size,3);
 for(const result of results){assert.equal(Object.keys(result).length,TABLES.length);for(const [table,expected] of Object.entries(data))assert.deepEqual(result[table],expected);}
 const groups=workspaceReadGroups(TABLES);assert.deepEqual(groups[0],['sales_item_facts']);assert.ok(groups.every(group=>group.length<=8));assert.deepEqual(groups.flat().sort(),[...TABLES].sort());
});
