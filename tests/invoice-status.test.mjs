import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {updateInvoiceStatus} from '../server/invoice-status.mjs';
import {isUnpaidInvoice,validInvoiceStatusChange} from '../src/invoice-status.js';
import {databaseErrorMessage} from '../server/database-errors.mjs';
const id='11111111-1111-4111-8111-111111111111';
const url=new URL(`http://localhost/api/invoices/${id}/status`);
const body={status:'paid',expectedStatus:'approved',expectedUpdatedAt:'2026-10-05T12:00:00.123456+00:00'};
function req(payload=body){return Object.assign(Readable.from([Buffer.from(JSON.stringify(payload))]),{method:'POST'});}
function res(){return {writeHead(status){this.status=status;},end(value){this.body=JSON.parse(value);}};}
test('financial roles save only the requested status with the session token and concurrency version',async()=>{
 for(const role of ['owner','admin','manager']){
  let call;const response=res();
  await updateInvoiceStatus(req({...body,organizationId:'untrusted',total:0}),response,url,{request:async(path,options)=>{call={path,...options};return {id,status:'paid',changed:true};}},{member:{role},token:'test-token'});
  assert.equal(response.status,200);assert.equal(response.body.status,'paid');assert.equal(call.token,'test-token');
  assert.equal(call.path,'/rest/v1/rpc/update_invoice_status');
  assert.deepEqual(Object.keys(call.body).sort(),['p_expected_status','p_expected_updated_at','p_invoice_id','p_organization_id','p_status']);
  assert.equal(call.body.p_invoice_id,id);assert.notEqual(call.body.p_organization_id,'untrusted');assert.equal(call.body.p_expected_updated_at,body.expectedUpdatedAt);
 }
});
test('other roles are denied before any database mutation',async()=>{
 for(const role of ['employee','chef',undefined])await assert.rejects(updateInvoiceStatus(req(),res(),url,{request:()=>assert.fail('Database must not be called')},{member:{role}}),error=>error.status===403);
});
test('rejects unknown states and absent concurrency versions',async()=>{
 for(const payload of [null,{}, {...body,status:'received'}, {...body,expectedStatus:'bad'}, {...body,expectedUpdatedAt:''}, {...body,expectedUpdatedAt:'garbage'}]){
  assert.equal(Boolean(validInvoiceStatusChange(payload)),false);
  await assert.rejects(updateInvoiceStatus(req(payload),res(),url,{request:()=>assert.fail('Database must not be called')},{member:{role:'admin'}}),error=>error.status===400);
 }
});
test('database guard failures and concurrent changes never return a success response',async()=>{
 for(const status of [403,409,502]){const error=Object.assign(Error('Rejected'),{status}),response=res();await assert.rejects(updateInvoiceStatus(req(),response,url,{request:async()=>{throw error;}},{member:{role:'admin'}}),e=>e===error);assert.equal(response.status,undefined);}
});
test('paid and canceled invoices do not inflate unpaid totals',()=>{
 assert.equal(isUnpaidInvoice({status:'paid'}),false);assert.equal(isUnpaidInvoice({status:'cancelled'}),false);
 for(const status of ['uploaded','processing','review','approved'])assert.equal(isUnpaidInvoice({status}),true);
});
test('document and conflict errors explain how to recover without leaking database details',()=>{
 assert.match(databaseErrorMessage({message:'INVOICE_S3_REQUIRED: internal detail'}),/Upload and verify/);
 assert.match(databaseErrorMessage({code:'40001'}),/Reload its status/);
});
