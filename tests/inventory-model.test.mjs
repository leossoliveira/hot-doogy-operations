import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {latestInventoryFor} from '../src/inventory-model.js';

const item={id:'item',rowId:'row',locationId:'store',baseUnitName:'Each',stocktakeUom:'Bag',units:[{id:'unit-bag',name:'Bag',factor:10,stocktake:true},{id:'unit-case',name:'Case',factor:100,stocktake:false}]};
const database=(changes={})=>({rows:[{itemId:'item',locationId:'store',qty:3,uom:'Bag',baseQty:30,date:'2026-10-01',countedAt:'2026-10-01T17:00:00Z',precision:'reported_time',moment:null,scope:'item_store_total',source:'completed_stock_count',areas:[],exceptions:[],...changes}]});
const localCount=(date,moment,qty=7,createdAt='2026-10-04T15:00:00Z')=>({id:'local',locationId:'store',date,moment,createdAt,lines:[{rowId:'row',itemId:'item',qty,uom:'Bag'}]});

test('current stocktake conversion changes presentation without changing stored count records',()=>{
  const input=database(),before=JSON.stringify(input),changed={...item,stocktakeUom:'Case',units:item.units.map(unit=>({...unit,stocktake:unit.name==='Case'}))};
  const result=latestInventoryFor(changed,{},input);
  assert.equal(result.qty,0.3);assert.equal(result.uom,'Case');assert.equal(result.baseQty,30);assert.equal(JSON.stringify(input),before);
});

test('removing the current stocktake unit preserves the recorded unit instead of picking an arbitrary conversion',()=>{
  const unset={...item,stocktakeUom:null,units:[{id:'case',name:'Case',factor:100,stocktake:false}]};
  const result=latestInventoryFor(unset,{},database());
  assert.equal(result.qty,3);assert.equal(result.uom,'Bag');
});
