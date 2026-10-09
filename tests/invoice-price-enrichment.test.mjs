import test from 'node:test';
import assert from 'node:assert/strict';
import {enrichOperations} from '../server/operation-evidence.mjs';
import {invoicePriceHistory} from '../src/invoice-price-history.js';
test('invoice enrichment preserves recorded invoice prices through history rendering',()=>{
 const invoices=[{id:'invoice',supplierId:'supplier',date:'2026-10-09',lines:[{itemId:'item',quantity:2,unitPrice:12.34,itemUnitId:'unit'}]}];
 enrichOperations({orders:[],invoices,receipts:[],transfers:[],t:{inventory_transactions:[]},base:new Map(),loc:new Map(),area:new Map()});
 assert.equal(invoices[0].lines[0].unitPrice,12.34);
 assert.equal(invoicePriceHistory({itemId:'item',supplierId:'supplier'},invoices)[0].price,12.34);
});
