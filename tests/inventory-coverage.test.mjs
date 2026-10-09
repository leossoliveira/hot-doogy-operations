import test from 'node:test';
import assert from 'node:assert/strict';
import {inventoryCoverage} from '../src/inventory-coverage.js';
import {periodWindow,shiftDay} from '../src/preparation-model.js';
const item={id:'i',locationId:'a',units:[{stocktake:true,factor:4}]};
const w=periodWindow('2026-10-01','2026-10-07');
const batches=[{locationId:'a',periodStart:new Date(w.from).toISOString(),periodEnd:new Date(w.to).toISOString()}];
const source={days:Array.from({length:7},(_,i)=>({locationId:'a',date:shiftDay(w.start,i),incompleteLines:0})),rows:[{itemId:'i',locationId:'a',date:w.start,baseQty:28},{itemId:'i',locationId:'b',date:w.start,baseQty:9999}]};
test('coverage converts consumption to count units, isolates location, and preserves zero',()=>{
 assert.equal(inventoryCoverage(item,{qty:7},source,batches,'2026-10-08').days,7);
 assert.equal(inventoryCoverage(item,{qty:0},source,batches,'2026-10-08').days,0);
});
test('coverage does not invent demand from missing or zero sales',()=>{
 for(const data of [null,{...source,rows:[]},{...source,days:source.days.slice(1)},{...source,rows:[{...source.rows[0],baseQty:0}]}])assert.equal(inventoryCoverage(item,{qty:7},data,batches,'2026-10-08').days,null);
 assert.equal(inventoryCoverage(item,{qty:null},source,batches,'2026-10-08').days,null);
 assert.equal(inventoryCoverage(item,{qty:7,partial:true},source,batches,'2026-10-08').days,null);
});

test('weekly coverage labels partial calculated consumption without suppressing it',()=>{
 const result=inventoryCoverage(item,{qty:7},{...source,days:source.days.map(d=>({...d,incompleteLines:1}))},batches,'2026-10-08');
 assert.equal(result.days,7);assert.equal(result.partial,true);
 assert.equal(result.start,'2026-10-01');assert.equal(result.end,'2026-10-07');
});

test('inventory preview includes posted receipts, excludes sales to avoid double counting, and converts units',async()=>{
 const {inventoryBasedCoverage}=await import('../src/inventory-coverage.js');
 const history={sessions:[{id:'1',locationId:'a',status:'completed',source:'observations',countedAt:'2026-10-01T12:00:00Z',lines:[{itemId:'i',quantityBase:40}]},{id:'2',locationId:'a',status:'completed',source:'observations',countedAt:'2026-10-08T12:00:00Z',lines:[{itemId:'i',quantityBase:32}]}],movements:[{id:'m',itemId:'i',locationId:'a',occurredAt:'2026-10-03T12:00:00Z',type:'purchase_receipt',baseQty:20},{id:'s',itemId:'i',locationId:'a',occurredAt:'2026-10-04T12:00:00Z',type:'sale_consumption',baseQty:-28}]};
 assert.equal(inventoryBasedCoverage(item,{qty:8},history).days,8);
 assert.equal(inventoryBasedCoverage(item,{qty:0},history).days,0);
 assert.equal(inventoryBasedCoverage(item,{qty:8},{...history,sessions:history.sessions.slice(1)}).days,null);
 assert.equal(inventoryBasedCoverage(item,{qty:8},{...history,movements:[{...history.movements[0],type:'unknown'}]}).days,null);
});
