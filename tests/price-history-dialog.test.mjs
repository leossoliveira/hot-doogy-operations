import test from 'node:test';
import assert from 'node:assert/strict';
import {createSupplierUI} from '../src/supplier-ui.js';
test('price history click opens invoice chart dialog instead of catalog history markup',()=>{
 let opened;
 const ui=createSupplierUI({catalog:()=>({items:[{itemId:'i',supplierItemId:'s',supplierId:'vendor',name:'Item',units:[]}]}),local:()=>({}),state:()=>({store:'all'}),data:()=>({invoices:[{id:'invoice',number:'123',date:'2026-10-09',supplierId:'vendor',lines:[{itemId:'i',itemUnitId:'u',uom:'Case',quantity:1,unitPrice:10}]}]}),openModal:(...args)=>{opened=args;},btn:()=>'',icon:()=>'',notice:()=>''});
 ui.actions['price-history']({dataset:{id:'s'}});
 assert.equal(opened[0],'Invoice price history');
 assert.match(opened[1],/<svg/);
 assert.match(opened[1],/#123/);
});
