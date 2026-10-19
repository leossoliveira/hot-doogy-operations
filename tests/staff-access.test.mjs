import test from 'node:test';
import assert from 'node:assert/strict';
import {canViewRoute,canUseAction} from '../src/access.js';
import {requireStaffRequest,requireStaffCommand} from '../server/staff-access.mjs';
import {readTables,projectData} from '../server/live-data.mjs';
test('Staff sees only the requested modules and read-only actions',()=>{
 for(const route of ['overview','inventory','preparation','transfers','recipes'])assert.ok(canViewRoute('staff',route));
 for(const route of ['sales','reports','suppliers','purchases','invoices','settings'])assert.equal(canViewRoute('staff',route),false);
 for(const action of ['new-transfer','edit-recipe','save-recipe','prep-new-batch','prep-finish','recipe-photo-upload','item-photo-remove','export-sales','new-order','unknown'])assert.equal(canUseAction('staff',action),false,action);
 for(const action of ['new-count','save-count','start-count','count-issue','item','recipe','transfer','inventory-history','page-next','prep-batch','prep-export-pdf','login-screen'])assert.ok(canUseAction('staff',action));
 assert.ok(canViewRoute('admin','invoices'));assert.ok(canUseAction('manager','new-count'));
});
test('Staff API denies writes and restricted documents including direct paths',()=>{
 for(const path of ['/api/data','/api/photos','/api/preparation/usage','/api/inventory/counter'])assert.doesNotThrow(()=>requireStaffRequest('staff','GET',path));
 for(const path of ['/api/catalog/create','/api/photos','/api/photos/items/11111111-1111-4111-8111-111111111111'])for(const method of ['POST','PUT','PATCH','DELETE'])assert.throws(()=>requireStaffRequest('staff',method,path),{status:403});
 for(const path of ['/api/invoices/a/documents/b/download','/api/invoices/a/status','/api/unknown'])assert.throws(()=>requireStaffRequest('staff','GET',path),{status:403});
 assert.doesNotThrow(()=>requireStaffRequest('admin','POST','/api/command'));
});
test('Staff data never requests or projects sales and purchasing documents',async()=>{
 const calls=[];const raw=await readTables({request:async url=>{calls.push(url);return [];}},'synthetic-token','staff');
 for(const table of ['sales_item_facts','sales_import_batches','purchase_orders','purchase_order_lines','purchase_receipts','invoices','invoice_lines','invoice_documents']){
  assert.equal(calls.some(url=>url.startsWith(`/rest/v1/${table}?`)),false,table);assert.deepEqual(raw[table],[]);
 }
 const data=projectData(raw);assert.deepEqual(data.salesPeriods.facts,[]);assert.deepEqual(data.orders,[]);assert.deepEqual(data.invoices,[]);
 assert.ok(calls.some(url=>url.startsWith('/rest/v1/recipes?')));
});

test('Staff command allows count-only batches and rejects mixed or malformed payloads',()=>{
 assert.doesNotThrow(()=>requireStaffRequest('staff','POST','/api/command'));
 assert.doesNotThrow(()=>requireStaffCommand('staff',{action:'batch',payload:{changes:[{action:'counts',payload:{}}]}}));
 for(const body of [null,{}, {action:'counts'}, {action:'batch',payload:{changes:[]}}, {action:'batch',payload:{changes:[{action:'counts'},{action:'recipe'}]}}, {action:'batch',payload:{changes:[null]}}, {action:'batch',payload:{changes:[{}]}}])assert.throws(()=>requireStaffCommand('staff',body),{status:403});
});

test('Staff can save inventory drafts and resume through History',()=>{assert.doesNotThrow(()=>requireStaffRequest('staff','POST','/api/inventory/count-draft'));assert.ok(canUseAction('staff','count-resume-history'));});
