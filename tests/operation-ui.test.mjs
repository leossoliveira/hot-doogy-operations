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
  assert.equal(modal.options.className,'operation-modal');
});
test('untrusted invoice metadata is escaped in title, notes, lines, documents and events',()=>{
  const value='<img src=x onerror=alert(1)>';
  const modal=render('showInvoice',{...base,number:value,supplierName:value,notes:value,lines:[{name:value,sku:value,quantity:1}],documents:[{fileName:value,storagePath:value,mimeType:value,fileExists:false}],timeline:[{at:'2026-10-04',text:value}]});
  assert.doesNotMatch(modal.title+modal.body,/<img/);
  assert.match(modal.body,/&lt;img/);
  assert.match(modal.body,/File not found/);
  assert.doesNotMatch(modal.body,/href=|accessUrl=/);
});
test('paid invoice does not invent a payment timestamp or a received state',()=>{
  const modal=render('showInvoice',{...base,status:'paid',updatedAt:'2026-10-04T13:00:00Z'});
  assert.match(modal.body,/Payment date, method, and amount are not recorded separately/);
  assert.match(modal.body,/No receipt is explicitly linked/);
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
const data=JSON.parse(readFileSync(new URL('../public/data/operations-detail.json',import.meta.url),'utf8'));
test('historical receipt confirms document without inventing item quantities or a stock entry',()=>{
  const order=data.orders.find(x=>x.receiptEvidence?.computedStatus==='confirmed_received'&&!x.receipts[0].confirmedInvoiceLines.length);
  const modal=render('showOrder',order);
  assert.match(modal.body,/Received quantities — user confirmation/);
  assert.match(modal.body,/without an inventory movement/);
  assert.match(modal.body,/no quantities were estimated/);
  assert.equal(order.receipts[0].lines.length,0);
  assert.equal(order.receipts[0].historicalConfirmation.inventoryMovement,false);
});
test('historical receipt displays recorded invoice quantities and distinguishes missing UOM',()=>{
  const order=data.orders.find(x=>x.receiptEvidence?.computedStatus==='confirmed_received'&&x.receipts[0].confirmedInvoiceLines.some(l=>!l.uom));
  const modal=render('showOrder',order);
  assert.match(modal.body,/Quantity received per invoice/);
  assert.match(modal.body,/do not represent a new physical count/);
  assert.match(modal.body,/Not specified/);
  for(const r of order.receipts) assert.equal(r.receivedAt.slice(0,10),r.historicalConfirmation.invoiceDate);
});
test('real operation export preserves all declared records and line coverage',()=>{
  assert.equal(data.orders.length,260);
  assert.equal(data.invoices.length,260);
  assert.equal(data.transfers.length,2);
  assert.equal(data.orders.reduce((n,x)=>n+x.lines.length,0),233);
  assert.equal(data.invoices.reduce((n,x)=>n+x.lines.length,0),799);
  assert.equal(data.transfers.reduce((n,x)=>n+x.lines.length,0),41);
  assert.equal(data.invoices.flatMap(x=>x.documents).filter(x=>!x.fileExists).length,1);
  assert.ok(data.orders.every(x=>x.status===x.dbStatus));
  assert.ok(data.invoices.every(x=>x.status===x.dbStatus));
});
test('documented location corrections stay linked but separate from current-location movements',()=>{
  const invoice=data.invoices.find(x=>x.number==='1872502');
  assert.equal(invoice.historicalCorrections.length,32);
  assert.ok(invoice.transactions.every(t=>t.locationId===invoice.locationId));
  assert.ok(invoice.historicalCorrections.every(t=>t.locationId!==invoice.locationId));
  assert.ok(invoice.historicalCorrections.every(t=>invoice.lines.some(l=>l.id===t.sourceId)));
  const totals=new Map();
  for(const t of invoice.historicalCorrections)totals.set(t.inventoryItemId,(totals.get(t.inventoryItemId)||0)+t.quantityBase);
  assert.ok([...totals.values()].every(n=>Math.abs(n)<1e-8));
  const modal=render('showInvoice',invoice);
  assert.match(modal.body,/Corrected historical movements \(32\)/);
  assert.match(modal.body,/estornadas\/corrigidas/);
});
test('all real operation detail views render without undefined or NaN',()=>{
  for(const [method,rows] of [['showInvoice',data.invoices],['showOrder',data.orders],['showTransfer',data.transfers]]){
    for(const record of rows){
      const modal=render(method,record);
      assert.doesNotMatch(modal.body,/\bundefined\b|\bNaN\b/,method+' '+record.id);
      assert.equal(modal.options.className,'operation-modal');
    }
  }
});
