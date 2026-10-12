import test from 'node:test';
import assert from 'node:assert/strict';
import {countSessions,historyRows,historyDateTime,countDetailRows} from '../src/count-history.js';
import {projectData} from '../server/live-data.mjs';
test('completed count uses the employee recorded on matching observations',()=>{
 const data=projectData({stock_counts:[{id:'s',location_id:'l',status:'completed',completed_at:'2026-10-12T14:09:00Z'}],store_count_observations:[{id:'o',session_id:'s',location_id:'l',inventory_item_id:'i',employee_name:'Maria Maia',quantity:3}]});
 assert.equal(data.inventoryHistory.sessions[0].employeeName,'Maria Maia');
 assert.equal(data.inventoryHistory.sessions[0].countedAt,'2026-10-12T14:09:00Z');
});
test('groups counted items by session and location, excludes unfinished legacy counts',()=>{
 const rows=countSessions([{id:'a',sessionId:'s',locationId:'l',employeeName:'Maria',countedOn:'2026-10-08'},{id:'b',sessionId:'s',locationId:'l'},{id:'c',sessionId:'s',locationId:'other'}],[{id:'draft',status:'draft'},{id:'old',locationId:'l',status:'completed',completedAt:'2026-10-07T15:00:00Z'}]);
 assert.equal(rows.length,3);assert.equal(rows.find(x=>x.id==='s'&&x.locationId==='l').employeeName,'Maria');
});
test('merges saved and local counts without duplicates, filters locations and orders newest first',()=>{
 const rows=historyRows([{id:'a',locationId:'l',date:'2026-10-01'}],[{id:'a',locationId:'l',date:'2026-10-01'},{id:'b',locationId:'l',date:'2026-10-08'},{id:'c',locationId:'other',date:'2026-10-09'}],'l');
 assert.deepEqual(rows.map(x=>x.id),['b','a']);
});
test('preserves device date across UTC midnight and never invents legacy time',()=>{
 assert.deepEqual(historyDateTime({countedAt:'2026-10-09T02:30:00Z',countOffsetMinutes:240}),{date:'10/08/2026',time:'10:30 PM'});
 assert.deepEqual(historyDateTime({date:'2026-10-08'}),{date:'10/08/2026',time:'Not recorded'});
});
test('live projection retains completed sessions without requiring active catalog items',()=>{
 const data=projectData({store_count_observations:[{id:'o',session_id:'s',location_id:'l',inventory_item_id:'deleted',employee_name:'Maria',counted_on:'2026-10-08',created_at:'2026-10-08T12:00:00Z'}]});
 assert.equal(data.inventoryHistory.sessions.length,1);assert.equal(data.inventoryHistory.sessions[0].employeeName,'Maria');
});
test('count details retain zero quantities, all entries and legacy notes',()=>{
 const rows=countSessions([{id:'o1',sessionId:'s',locationId:'l',inventoryItemId:'i',quantity:0,itemUnitId:'u'},{id:'o2',sessionId:'s',locationId:'l',inventoryItemId:'j',quantity:3}], [{id:'old',locationId:'l',status:'completed',notes:'Original notes'}],[{sessionId:'old',itemId:'x',entries:[{quantity:2,inventoryItemUnitId:'box'},{quantity:1,inventoryItemUnitId:'each'}]}]);
 assert.equal(rows.find(r=>r.id==='s').lines.length,2);
 assert.equal(rows.find(r=>r.id==='s').lines[0].qty,0);
 assert.equal(rows.find(r=>r.id==='old').notes,'Original notes');
 assert.equal(rows.find(r=>r.id==='old').lines[0].entries.length,2);
});

test('lists items alphabetically with recorded area quantities and honest location totals',()=>{
 const items=[{id:'a',locationId:'l',name:'Zucchini',sku:'100',areaName:'Back Shelf'}, {id:'b',locationId:'l',name:'Ápple Juice',sku:'3802188',areaName:'Back Shelf'}];
 const lines=[{itemId:'a',qty:0,areaName:'Cooler'},{itemId:'b',qty:21},{itemId:'a',qty:2,areaName:'Shelf'}];
 const rows=countDetailRows(lines,items,'l');
 assert.deepEqual(rows.map(r=>r.displayName),['Ápple Juice','Zucchini','Zucchini']);
 assert.deepEqual(rows.map(r=>r.displayArea),['Area not recorded','Cooler','Shelf']);
 assert.deepEqual(rows.map(r=>r.qty),[21,0,2]);
 assert.equal(countDetailRows(lines,items,'l','apple')[0].itemId,'b');
 assert.equal(countDetailRows(lines,items,'l','3802188')[0].itemId,'b');
 assert.deepEqual(countDetailRows(lines,items,'l','absent'),[]);
});
