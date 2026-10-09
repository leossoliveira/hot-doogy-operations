import test from 'node:test';
import assert from 'node:assert/strict';
import {inventoryCoverage} from '../src/inventory-coverage.js';
import {periodWindow,shiftDay} from '../src/preparation-model.js';
const item={id:'i',locationId:'a',units:[{stocktake:true,factor:4}]};
const w=periodWindow('2026-09-10','2026-10-07');
const batches=[{locationId:'a',periodStart:new Date(w.from).toISOString(),periodEnd:new Date(w.to).toISOString()}];
const source={days:Array.from({length:28},(_,i)=>({locationId:'a',date:shiftDay(w.start,i),incompleteLines:0})),rows:[{itemId:'i',locationId:'a',date:w.start,baseQty:112},{itemId:'i',locationId:'b',date:w.start,baseQty:9999}]};
test('coverage converts consumption to count units, isolates location, and preserves zero',()=>{
 assert.equal(inventoryCoverage(item,{qty:7},source,batches,'2026-10-08').days,7);
 assert.equal(inventoryCoverage(item,{qty:0},source,batches,'2026-10-08').days,0);
});
test('coverage does not invent demand from missing, partial or zero sales',()=>{
 for(const data of [null,{...source,rows:[]},{...source,days:source.days.slice(1)},{...source,rows:[{...source.rows[0],baseQty:0}]},{...source,days:source.days.map(d=>({...d,incompleteLines:1}))}])assert.equal(inventoryCoverage(item,{qty:7},data,batches,'2026-10-08').days,null);
 assert.equal(inventoryCoverage(item,{qty:null},source,batches,'2026-10-08').days,null);
 assert.equal(inventoryCoverage(item,{qty:7,partial:true},source,batches,'2026-10-08').days,null);
});
