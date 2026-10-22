import test from 'node:test';
import assert from 'node:assert/strict';
import {projectData} from '../server/live-data.mjs';
import {orderItemsTable} from '../src/order-edit.js';
import {escape as e,money,preciseNumber} from '../src/model.js';
import {mountOrderReceiving} from '../src/order-receiving.js';

test('invoice order keeps unmapped descriptions, units, SKU and printed totals',()=>{
 const raw={purchase_orders:[{id:'order',order_number:'123',supplier_id:'supplier',location_id:'store',status:'ordered'}],purchase_order_lines:[{id:'line',purchase_order_id:'order',source_invoice_line_id:'invoice-line',description:'Unknown <item>',source_unit:'CASE',source_sku:'ABC',ordered_purchase_qty:3,estimated_unit_price:0.3333,line_total:1}],invoices:[]};
 const data=projectData(raw),order=data.orders[0];
 assert.equal(order.lines.length,1);assert.equal(order.lines[0].productDescription,'Unknown <item>');
 assert.equal(order.lines[0].uom,'CASE');assert.equal(order.lines[0].sku,'ABC');assert.equal(order.lines[0].catalogPending,true);
 const html=orderItemsTable(order,e,money,preciseNumber);
 assert.match(html,/Unknown &lt;item&gt;/);assert.match(html,/Catalog match pending/);assert.match(html,/\$1\.00/);assert.doesNotMatch(html,/<item>/);
});

test('unmatched invoice products and signed credit lines cannot be selected for stock receipt',()=>{
 for(const line of [{id:'pending',catalogPending:true},{id:'credit',sourceInvoiceLineId:'source',orderedPurchaseQty:-1},{id:'unknown-quantity',sourceInvoiceLineId:'source',orderedPurchaseQty:null}]){
  let html='';
  const row={dataset:{orderLine:line.id},insertAdjacentHTML:(_,value)=>{html+=value;},querySelectorAll:()=>[]};
  const root={querySelector:()=>({tHead:{rows:[{insertAdjacentHTML(){}}]},tBodies:[{rows:[row]}]})};
  mountOrderReceiving({status:'ordered',lines:[line]},{root,e,icon:()=>'',onReportIssue(){throw Error('Must not offer receipt');}});
  assert.doesNotMatch(html,/data-receive-choice/);
  assert.match(html,line.id==='credit'?/Credit \/ adjustment/:/Match product, unit and quantity/);
 }
});
