import test from 'node:test';
import assert from 'node:assert/strict';
import {readSalesPage} from '../server/sales-page-read.mjs';
import {ORGANIZATION_ID} from '../server/supabase-config.mjs';
test('sales RPC retains the strictest cursor plus inclusive lower and exclusive upper bounds',async()=>{
 const cursor='10000000-0000-4000-8000-000000000000',next='50000000-0000-4000-8000-000000000000',lower='40000000-0000-0000-0000-000000000000',upper='80000000-0000-0000-0000-000000000000';
 const result=await readSalesPage(async(path,options)=>{
  assert.equal(path,'/rest/v1/rpc/workspace_sales_page');assert.deepEqual(options,{method:'POST',body:{p_organization_id:ORGANIZATION_ID,p_limit:1000,p_after:next,p_lower:lower,p_upper:upper}});return [{id:next}];
 },`/rest/v1/sales_item_facts?limit=1000&id=gt.${cursor}&id=gte.${lower}&id=lt.${upper}&id=gt.${next}`);
 assert.deepEqual(result,[{id:next}]);
});
test('sales RPC failures propagate without a fallback scan or partial results',async()=>{
 let calls=0;const failure=Object.assign(Error('timeout'),{databaseCode:'57014'});
 await assert.rejects(readSalesPage(async()=>{calls++;throw failure;},'/sales?limit=1000'),error=>error===failure);assert.equal(calls,1);
 assert.throws(()=>readSalesPage(()=>{throw Error('must not call');},'/sales?limit=1000&id=eq.bad'),/Invalid sales page filter/);
});
