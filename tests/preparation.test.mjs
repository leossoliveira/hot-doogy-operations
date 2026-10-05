import test from 'node:test';
import assert from 'node:assert/strict';
import {createPreparationPlan,completeProduction,stockWithProduction,periodWindow,suggestedProduction,partialProduction,batchPreparedBy} from '../src/preparation-model.js';
const unit={itemUnitId:'bag-id',id:'bag',name:'Bag',factor:10,stocktake:true};
const items=['plaza','mall'].map(locationId=>({id:'prep',rowId:locationId,locationId,locationName:locationId,name:'Prep',internalName:'Prep',type:'prepared',active:true,locationActive:true,stocktakeUom:'Bag',units:[unit]}));
const recipes=[{id:'recipe',outputItemId:'prep',versionId:'v',type:'prep',status:'active'}],locations=[{id:'plaza',name:'Plaza'},{id:'mall',name:'Mall'}];
const empty=()=>({production:[],transfers:[],counts:[]});
const plan={rows:[{itemId:'prep',name:'Prep',qty:'3',margin:20}],fromLocationId:'plaza',toLocationId:'mall',date:'2026-10-05'};
const now='2026-10-04T18:00:00Z';
test('validates inverted dates and preserves weekday alignment for a multiweek range',()=>{assert.throws(()=>periodWindow('2026-10-05','2026-10-01'));assert.equal(periodWindow('2026-09-20','2026-10-03').previousStart,'2026-09-06');});
test('planning atomically creates linked drafts without stock entries',()=>{const local=empty(),next=createPreparationPlan(local,plan,items,recipes,locations,'plan',now);assert.equal(local.production.length,0);assert.equal(next.production.length,1);assert.equal(next.transfers.length,1);assert.equal(next.transfers[0].status,'draft');assert.equal(next.transfers[0].lines[0].batchId,next.production[0].id);assert.equal(next.production[0].stockEntry,undefined);assert.deepEqual(createPreparationPlan(next,plan,items,recipes,locations,'plan',now),next);});
test('rejects invalid quantities, same-store routes and missing recipe/unit mappings',()=>{assert.throws(()=>createPreparationPlan(empty(),{...plan,rows:[{itemId:'prep',qty:-1}]},items,recipes,locations,'p',now));assert.throws(()=>createPreparationPlan(empty(),{...plan,toLocationId:'plaza'},items,recipes,locations,'p',now));assert.throws(()=>createPreparationPlan(empty(),plan,items,[],locations,'p',now));});
test('actual output replaces planned quantity for stock exactly once',()=>{const local=createPreparationPlan(empty(),plan,items,recipes,locations,'plan',now),batch=local.production[0];const count={countSessionId:'c',date:'2026-10-01'};const next=completeProduction(local,batch,4,now,count,now);assert.equal(next.production[0].stockEntry.baseQty,40);assert.equal(next.production[0].plannedQty,3);assert.equal(local.production[0].status,'draft');assert.deepEqual(completeProduction(next,batch,4,now,count,now),next);assert.throws(()=>completeProduction(local,batch,4,'2026-10-05T18:00:00Z',count,now));});
test('new output adds to the count; later physical count absorbs the earlier batch',()=>{const stock={itemId:'prep',locationId:'plaza',qty:2,baseQty:20,date:'2026-10-01',countSessionId:'c',countedAt:'2026-10-01T15:00:00Z',precision:'reported_time'};const local=createPreparationPlan(empty(),plan,items,recipes,locations,'plan',now);const next=completeProduction(local,local.production[0],4,now,stock,now);assert.equal(stockWithProduction(items[0],next,{rows:[stock]}).qty,6);const newer={...stock,qty:5,baseQty:50,countSessionId:'new',date:'2026-10-05',countedAt:'2026-10-05T15:00:00Z'};assert.equal(stockWithProduction(items[0],next,{rows:[newer]}).qty,5);});
test('unknown count is not replaced with fabricated zero balance',()=>{const local=createPreparationPlan(empty(),plan,items,recipes,locations,'plan',now);const next=completeProduction(local,local.production[0],4,now,{},now);assert.equal(stockWithProduction(items[0],next,null).qty,null);});

test('a backdated batch preceding an exact same-day count is already included',()=>{const stock={itemId:'prep',locationId:'plaza',qty:2,baseQty:20,date:'2026-10-04',countSessionId:'c',countedAt:'2026-10-04T15:00:00Z',precision:'reported_time'};const local=createPreparationPlan(empty(),plan,items,recipes,locations,'plan',now);const next=completeProduction(local,local.production[0],4,'2026-10-04T14:00:00Z',stock,now);assert.equal(stockWithProduction(items[0],next,{rows:[stock]}).qty,2);});

test('planning partial subtracts the destination count, preserving surplus and unknown values',()=>{
  assert.equal(partialProduction(suggestedProduction(3.75,25),2),2.6875);
  assert.equal(partialProduction(suggestedProduction(0.75,20),3),-2.1);
  assert.equal(partialProduction(0,0),0);
  assert.equal(partialProduction(0.3,0.1),0.2);
  for(const missing of [null,undefined,'']){
    assert.equal(partialProduction(1,missing),null);
    assert.equal(partialProduction(missing,1),null);
  }
});

test('prepared by uses the recorded preparer, including explicit label corrections',()=>{
  assert.equal(batchPreparedBy({preparedBy:'Ana',notes:'Prepared by Martiese.'}),'Ana');
  assert.equal(batchPreparedBy({notes:'Prepared by Martiese Sousa at Sherwood Plaza.'}),'Martiese Sousa');
  assert.equal(batchPreparedBy({notes:'Prepared by Alessia overriding Martiese label per Leonardo.'}),'Alessia');
  assert.equal(batchPreparedBy({notes:'Prepared by Alessia, overrides Martiese label.'}),'Alessia');
  assert.equal(batchPreparedBy({notes:'Prepared by Martiese. Registered from production record.'}),'Martiese');
  assert.equal(batchPreparedBy({notes:'Registered by Leonardo.'}),null);
  assert.equal(batchPreparedBy({}),null);
});
