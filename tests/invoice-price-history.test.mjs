import test from 'node:test';
import assert from 'node:assert/strict';
import {invoicePriceHistory,invoicePriceChange} from '../src/invoice-price-history.js';
const item={itemId:'i',supplierId:'s',supplierItemId:'si'};
const invoice=(id,date,price,extra={})=>({id,date,supplierId:'s',locationId:'a',status:'paid',lines:[{itemId:'i',itemUnitId:'u',quantity:2,unitPrice:price}],...extra});
test('invoice price history uses historical prices, date order and location/supplier scope',()=>{
 const h=invoicePriceHistory(item,[invoice('old','2026-01-01',10),invoice('new','2026-02-01',12),invoice('other','2026-03-01',99,{supplierId:'other'}),invoice('loc','2026-03-01',99,{locationId:'b'})],'a');
 assert.deepEqual(h.map(p=>p.price),[12,10]);assert.equal(invoicePriceChange(h).percent,20);
 assert.equal(invoicePriceChange(h.slice().reverse()).label,'Decreased');
});
test('missing prices and changed units never imply a price change',()=>{
 const h=invoicePriceHistory(item,[invoice('old','2026-01-01',10),invoice('new','2026-02-01',null)]);
 assert.equal(h[0].price,null);assert.equal(invoicePriceChange(h).delta,undefined);
 h[0].price=20;h[0].unit='different';assert.equal(invoicePriceChange(h).label,'Different units');
});
test('full item history includes other suppliers and statuses, with inclusive date windows',async()=>{
 const {filterInvoicePricePeriod}=await import('../src/invoice-price-history.js');
 const rows=[invoice('a','2026-10-11',10),invoice('b','2026-09-12',11,{supplierId:'other',status:'draft'}),invoice('c','2026-09-11',12)];
 const all=invoicePriceHistory(item,rows,'all',true);
 assert.equal(all.length,3);
 assert.deepEqual(filterInvoicePricePeriod(all,'30','2026-10-11').map(p=>p.invoiceId),['a','b']);
 assert.equal(filterInvoicePricePeriod(all,'all','2026-10-11').length,3);
});
