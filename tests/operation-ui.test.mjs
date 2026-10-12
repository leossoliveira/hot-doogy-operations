import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createOperationUI} from '../src/operation-ui.js';
import {escape as e,money,date,preciseNumber} from '../src/model.js';

function render(method,record){
  let modal;
  const ui=createOperationUI({
    e,money,date,preciseNumber,
    status:value=>'<span>'+e(value??'Not specified')+'</span>',
    icon:()=>'<i></i>',
    pair:(label,value)=>'<div><small>'+e(label)+'</small><strong>'+value+'</strong></div>',
    notice:html=>'<aside>'+html+'</aside>',
    btn:(label,action,ic,cls,extra='')=>'<button data-action="'+e(action)+'" '+extra+'>'+label+'</button>',
    openModal:(title,body,footer,options)=>{modal={title,body,footer,options};}
  });
  ui[method](record);
  return modal;
}
const base={id:'test',status:'approved',lines:[],receipts:[],documents:[],timeline:[]};

test('invoice distinguishes stored zero from missing values and keeps negative credits',()=>{
  const modal=render('showInvoice',{...base,number:'ZERO',total:0,subtotal:null,tax:0,fees:-2,lines:[{name:'Zero line',quantity:0,uom:'ea',quantityBase:0,baseUom:'ea',unitPrice:0,lineTotal:0}]});
  assert.match(modal.body,/\$0\.00/);
  assert.match(modal.body,/-\$2\.00/);
  assert.match(modal.body,/<td>0<\/td>/);
  assert.match(modal.body,/Subtotal<\/small><strong><span class="muted">Not specified/);
  assert.equal(modal.options.wide,true);
  assert.equal(modal.options.className,'operation-modal invoice-detail-modal');
});
test('untrusted invoice metadata is escaped in title, notes, lines, documents and events',()=>{
  const value='<img src=x onerror=alert(1)>';
  const modal=render('showInvoice',{...base,number:value,supplierName:value,notes:value,lines:[{name:value,sku:value,quantity:1}],documents:[{fileName:value,storagePath:value,mimeType:value,fileExists:false}],timeline:[{at:'2026-10-04',text:value}]});
  assert.doesNotMatch(modal.title+modal.body,/<img/);
  assert.match(modal.body,/&lt;img/);
  assert.doesNotMatch(modal.body,/Saved path|File reference/);
  assert.doesNotMatch(modal.body,/href=|accessUrl=/);
});
test('paid invoice does not invent a payment timestamp or a received state',()=>{
  const modal=render('showInvoice',{...base,status:'paid',updatedAt:'2026-10-04T13:00:00Z'});
  assert.doesNotMatch(modal.body,/Payment on/);
  assert.match(modal.body,/awaiting_receipt/);assert.match(modal.body,/Not recorded/);
  assert.doesNotMatch(modal.body,/Payment on Oct 04/);
});
test('transfer preserves zero in-transit and absent approval independently',()=>{
  const modal=render('showTransfer',{...base,status:'completed',fromLocationName:'A',toLocationName:'B',lines:[{name:'Item',requestedQuantity:2,approvedQuantity:null,dispatchedQuantity:2,receivedQuantity:2,inTransitQuantity:0,remainingToDispatch:0,uom:'bag'}]});
  assert.match(modal.body,/<td>0<\/td><td>0<\/td>/);
  assert.match(modal.body,/<td><span class="muted">Not specified<\/span><\/td>/);
});
test('empty order keeps its stored status and does not fabricate lines or receipt evidence',()=>{
  const modal=render('showOrder',{...base,status:'ordered',lineCount:0,total:null,receiptEvidence:{computedStatus:'no_receipt_recorded',orderLineCount:0,comparableLineCount:0}});
  assert.match(modal.body,/This record has no item lines/);
  assert.match(modal.body,/No linked receipt/);
  assert.doesNotMatch(modal.body,/\$0\.00/);
});

test('order uses saved price, alphabetical products and recorded receivers/dates without removed details',()=>{
 const modal=render('showOrder',{...base,status:'ordered',notes:'Hidden order note',receipts:[{status:'completed',receiverName:'Ana'}],lines:[{name:'Zebra',catalogUnitPrice:8,estimatedUnitPrice:90,receivedQuantity:2,receivedDates:['2026-10-08T16:00:00Z']},{name:'Apple',catalogUnitPrice:0,receivedQuantity:null}]});
 assert.ok(modal.body.indexOf('Apple')<modal.body.indexOf('Zebra'));
 assert.match(modal.body,/\$90\.00/);assert.doesNotMatch(modal.body,/\$8\.00/);assert.match(modal.body,/Received \/ Date/);assert.match(modal.body,/10\/08\/2026/);assert.match(modal.body,/Ana/);
 assert.doesNotMatch(modal.body,/Item units and references|<h3>Receipts|Hidden order note|Linked inventory movements|Record references/);
});

test('order rows sort by Product Description rather than internal item name',()=>{
 const modal=render('showOrder',{...base,lines:[{id:'1',name:'A internal',productDescription:'Z supplier description',quantity:3},{id:'2',name:'Z internal',productDescription:'A supplier description',quantity:2}]});
 assert.match(modal.body,/data-table-layout="rows"/);assert.match(modal.body,/aria-sort="ascending"/);assert.match(modal.body,/Product Description/);
 assert.ok(modal.body.indexOf('A supplier description')<modal.body.indexOf('Z supplier description'));
 assert.doesNotMatch(modal.body,/A internal/);
});
