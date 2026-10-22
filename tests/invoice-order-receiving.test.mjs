import test from 'node:test';
import assert from 'node:assert/strict';
import {enrichOperations} from '../server/operation-evidence.mjs';
const scope={organizationId:'org',locationId:'store',supplierId:'supplier'};
function fixture(overrides={}){
 const invoice={...scope,id:'invoice',purchaseOrderId:'order',status:'paid',lines:[],extraction:{receiving:{status:'received',receivedBy:'Martiese Sousa',receivedDate:'2026-10-17'}},...overrides};
 const order={...scope,id:'order',status:'ordered',dbStatus:'ordered',statusLabel:'Awaiting receipt',lines:[{id:'line',orderedPurchaseQty:35}],receipts:[],invoices:[invoice]};
 return {orders:[order],invoices:[invoice],receipts:[],transfers:[],t:{inventory_transactions:[]},base:new Map(),loc:new Map(),area:new Map()};
}
test('approval declaration drives order status without inventing quantities or stock',()=>{
 const data=fixture();enrichOperations(data);const o=data.orders[0];
 assert.equal(o.status,'received');assert.equal(o.dbStatus,'ordered');assert.equal(o.statusLabel,'Received');
 assert.equal(o.receiptEvidence.computedStatus,'invoice_received');assert.equal(o.invoiceReceiving[0].receivedBy,'Martiese Sousa');
 assert.equal(o.lines[0].receivedQuantity,null);assert.deepEqual(o.receipts,[]);assert.deepEqual(o.transactions,[]);
});
test('payment, drafts, cancelled invoices, other scopes and unconfirmed deliveries cannot confirm receipt',()=>{
 for(const overrides of [{extraction:{}},{status:'draft'},{status:'cancelled'},{status:'rejected'},{locationId:'other'},{supplierId:'other'},{organizationId:'other'},{purchaseOrderId:'other'}]){
  const data=fixture(overrides);enrichOperations(data);assert.equal(data.orders[0].status,'ordered');
 }
});
test('one received invoice does not confirm another pending delivery',()=>{
 const data=fixture();data.orders[0].invoices.push({...data.invoices[0],id:'other',extraction:{}});
 enrichOperations(data);assert.equal(data.orders[0].status,'ordered');
});
test('partial warehouse receipt remains partial despite invoice declaration',()=>{
 const data=fixture();data.orders[0].status='partially_received';const r={id:'receipt',status:'completed',lines:[{purchaseOrderLineId:'line',quantityReceived:2}]};
 data.receipts.push(r);data.orders[0].receipts.push(r);enrichOperations(data);assert.equal(data.orders[0].status,'partially_received');assert.equal(data.orders[0].lines[0].receivedQuantity,2);
});

test('order detail shows the confirmed receiver, date and effective status',async()=>{
 const {createOperationUI}=await import('../src/operation-ui.js');
 const data=fixture();enrichOperations(data);let body='';
 createOperationUI({e:String,preciseNumber:String,money:String,date:String,status:String,icon:()=>'',pair:(k,v)=>`${k}: ${v}`,notice:String,btn:()=>'',openModal:(_title,html)=>{body=html;}}).showOrder(data.orders[0]);
 assert.match(body,/Status: received/);assert.match(body,/Martiese Sousa/);assert.match(body,/10\/17\/2026/);
 assert.match(body,/Received — confirmed during invoice approval/);assert.doesNotMatch(body,/Awaiting receipt/);
});
