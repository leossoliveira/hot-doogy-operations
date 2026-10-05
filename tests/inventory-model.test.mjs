import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {latestInventoryFor} from '../src/inventory-model.js';

const snapshot=JSON.parse(await readFile(new URL('../public/data/snapshot.json',import.meta.url),'utf8'));
const counts=JSON.parse(await readFile(new URL('../public/data/inventory-counts.json',import.meta.url),'utf8'));
const item={id:'item',rowId:'row',locationId:'store',baseUnitName:'Each',stocktakeUom:'Bag',units:[{id:'unit-bag',name:'Bag',factor:10,stocktake:true},{id:'unit-case',name:'Case',factor:100,stocktake:false}]};
const database=(changes={})=>({rows:[{itemId:'item',locationId:'store',qty:3,uom:'Bag',baseQty:30,date:'2026-10-01',countedAt:'2026-10-01T17:00:00Z',precision:'reported_time',moment:null,scope:'item_store_total',source:'completed_stock_count',areas:[],exceptions:[],...changes}]});
const localCount=(date,moment,qty=7,createdAt='2026-10-04T15:00:00Z')=>({id:'local',locationId:'store',date,moment,createdAt,lines:[{rowId:'row',itemId:'item',qty,uom:'Bag'}]});

test('all exported store associations and numeric totals reconcile with their selected area counts',()=>{
  assert.equal(counts.rows.length,318);
  assert.equal(new Set(counts.rows.map(row=>row.key)).size,318);
  const sourceKeys=new Set(snapshot.items.filter(row=>row.locationId).map(row=>`${row.id}|${row.locationId}`));
  let numeric=0;
  for(const row of counts.rows){
    assert.ok(sourceKeys.has(row.key),row.key);
    assert.equal(new Set(row.areas.map(area=>area.areaId)).size,row.areas.length);
    if(row.qty!==null){
      numeric++;
      assert.ok(Number.isFinite(row.qty)&&row.qty>=0);
      assert.ok(Math.abs(row.qty*row.unitFactor-row.baseQty)<0.00001,row.key);
      assert.ok(Math.abs(row.areas.reduce((sum,area)=>sum+area.baseQty,0)-row.baseQty)<0.00001,row.key);
      assert.equal(new Set(row.areas.map(area=>area.date)).size,1);
    }
    if(!row.areas.length)assert.equal(row.qty,null);
    if(row.precision==='moment'||row.precision==='date')assert.equal(row.countedAt,null);
  }
  assert.equal(numeric,285);
});

test('real database examples preserve the last physical quantities and confirmed zero',()=>{
  const lettuce=snapshot.items.find(row=>row.sku==='7779093');
  const result=latestInventoryFor(lettuce,{},counts);
  assert.equal(result.qty,1);assert.equal(result.uom,'Bag');assert.equal(result.date,'2026-10-01');assert.equal(result.countedAt,'2026-10-01T17:03:43.000Z');
  const panini=snapshot.items.filter(row=>row.id==='86787004-09e0-4443-a15f-f479c9892f42');
  for(const row of panini){const quantity=latestInventoryFor(row,{},counts);assert.equal(quantity.qty,row.locationName==='Sherwood Plaza'?100:0);assert.equal(quantity.uom,'Unit');if(row.locationName==='Natick Mall'){assert.equal(quantity.date,'2026-10-02');assert.equal(quantity.countedAt,null);assert.equal(quantity.precision,'date');}}
});

test('no completed count stays unknown and never becomes zero',()=>{
  assert.equal(latestInventoryFor(item,{},null).qty,null);
  const uncounted=counts.rows.find(row=>row.source==='no_completed_count');
  assert.ok(uncounted);assert.equal(latestInventoryFor({...item,id:uncounted.itemId,locationId:uncounted.locationId},{},counts).qty,null);
});

test('mixed-date areas retain a marked subtotal without presenting it as one complete count',()=>{
  const record=counts.rows.find(row=>row.mixedDates);
  const source=snapshot.items.find(row=>row.id===record.itemId&&row.locationId===record.locationId);
  const result=latestInventoryFor(source,{},counts);
  assert.equal(result.qty,null);assert.equal(result.baseQty,null);assert.equal(result.partial,true);assert.ok(result.knownSubtotal>0);assert.equal(result.areas.length,2);assert.ok(result.warnings.includes('Contagens de datas diferentes.'));
  assert.equal(new Set(result.areas.map(area=>area.date)).size,2);
});

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

test('a historical local count entered later does not replace a newer physical database count',()=>{
  const result=latestInventoryFor(item,{counts:[localCount('2026-09-30','Após o fechamento')]},database());
  assert.equal(result.qty,3);assert.equal(result.local,false);
});

test('a later local total replaces database areas and preserves explicit zero',()=>{
  const input=database(),local={counts:[localCount('2026-10-02','Antes da abertura',0)]},before=JSON.stringify({input,local});
  const result=latestInventoryFor(item,local,input);
  assert.equal(result.qty,0);assert.equal(result.local,true);assert.equal(result.scope,'item_store_total');assert.deepEqual(result.areas,[]);assert.equal(result.countedAt,null);assert.equal(result.moment,'Antes da abertura');assert.equal(JSON.stringify({input,local}),before);
});

test('same-day moments compare semantically without displaying technical reference times',()=>{
  const early=database({countedAt:null,precision:'moment',moment:'Antes da abertura',effectiveAt:'2026-10-01T14:59:00Z'});
  assert.equal(latestInventoryFor(item,{counts:[localCount('2026-10-01','Durante a operação')]},early).local,true);
  assert.equal(latestInventoryFor(item,{counts:[localCount('2026-10-01','Antes da abertura')]},database()).local,false);
  assert.equal(latestInventoryFor(item,{counts:[localCount('2026-10-01','Após o fechamento')]},database()).local,true);
  assert.equal(latestInventoryFor(item,{counts:[localCount('2026-10-01','Durante a operação')]},database()).local,false);
});

test('unknown database physical time cannot be displaced by an unproven same-day local moment',()=>{
  const record=database({countedAt:null,precision:'date'});
  assert.equal(latestInventoryFor(item,{counts:[localCount('2026-10-01','Após o fechamento')]},record).local,false);
});

test('local totals remain scoped to store and item and choose effective date before creation time',()=>{
  const local={counts:[localCount('2026-10-03','Durante a operação',4,'2026-10-03T17:00:00Z'),localCount('2026-10-02','Após o fechamento',9,'2026-10-04T17:00:00Z'),{...localCount('2026-10-04','Após o fechamento',99),locationId:'other-store'}]};
  const result=latestInventoryFor(item,local,database());assert.equal(result.qty,4);assert.equal(result.date,'2026-10-03');
  assert.equal(latestInventoryFor({...item,rowId:'another-row',id:'another-item'},local,database()).qty,null);
});

test('local counts in another known unit convert to the current stocktake unit',()=>{
  const count=localCount('2026-10-02','Durante a operação',2);count.lines[0].uom='Case';
  const result=latestInventoryFor(item,{counts:[count]},database());
  assert.equal(result.qty,20);assert.equal(result.uom,'Bag');assert.equal(result.originalQty,2);assert.equal(result.originalUom,'Case');
});
