import test from 'node:test';
import assert from 'node:assert/strict';
import {preparationPages} from '../server/preparation-pages.mjs';
import {salesSummary} from '../server/sales-summary.mjs';
const id=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
const page=(processed,hasMore,cursor,signature='catalog')=>({meta:{processed,hasMore,nextCursor:cursor,catalogSignature:signature},rows:[],itemRows:[],days:processed?[{date:'2026-10-01',locationId:'store',totalLines:processed,incompleteLines:0}]:[],issues:[]});
test('short time-bounded pages advance by confirmed cursor and retain scope/signature',async()=>{
 const calls=[];let n=0;
 for await(const part of preparationPages({request:async(path,{token,body})=>{
  calls.push({path,token,body});return ++n===1?page(2,true,id(2)):page(1,false,id(3));
 }},{token:'user'},'preparation_usage_period_page',{p_start:'2026-10-01',p_end:'2026-10-02',p_location:'store'}))assert.ok(part);
 assert.equal(calls.length,2);assert.equal(calls[1].body.p_after,id(2));assert.equal(calls[1].body.p_signature,'catalog');
 assert.ok(calls.every(c=>c.body.p_limit===250&&c.body.p_location==='store'&&c.token==='user'));
});
test('16,050 cached sales require 65 calls without a final empty page',async()=>{
 let calls=0;const raw={sales_item_facts:[],inventory_items:[]};
 const result=await salesSummary({request:async(path,{body})=>{
  calls++;assert.equal(path,'/rest/v1/rpc/operations_preparation_sales_page');
  const offset=body.p_after?Number(body.p_after.slice(-12)):0,processed=Math.min(250,16050-offset);
  return page(processed,offset+processed<16050,id(offset+processed));
 }},{token:'user'},raw);
 assert.equal(calls,65);assert.equal(result.days[0].totalLines,16050);
});
test('invalid progress, catalog changes and broken pages cannot publish partial summaries',async()=>{
 for(const bad of [page(0,true,null),page(251,false,id(251)),page(1,true,'bad'),page(1,true,id(1),'different'),{...page(1,true,id(2)),days:[]}]){
  let calls=0;const session={token:'user'};
  await assert.rejects(salesSummary({request:async()=>++calls===1?page(1,true,id(1)):bad},session,{sales_item_facts:[]}),/Incomplete sales response/);
  assert.equal(session.salesSummary,undefined);
 }
 let calls=0;
 await assert.rejects(async()=>{for await(const p of preparationPages({request:async()=>{calls++;throw Error('network');}},{token:'u'},'operations_preparation_sales_page'))void p;},/network/);
 assert.equal(calls,1);
});
