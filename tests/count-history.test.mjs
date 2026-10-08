import test from 'node:test';
import assert from 'node:assert/strict';
import {countSessions,historyRows,historyDateTime,groupCountLines} from '../src/count-history.js';
import {projectData} from '../server/live-data.mjs';
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

test('groups history alphabetically by area and item without duplicating location totals',()=>{
 const items=[{id:'a',locationId:'l',name:'Zucchini',sku:'100',areaName:'Back Shelf'}, {id:'b',locationId:'l',name:'Ápple Juice',sku:'3802188',areaName:'Back Shelf'}, {id:'c',locationId:'l',name:'Milk',areaName:'Cooler'}, {id:'a',locationId:'other',name:'Wrong location',areaName:'Other'}];
 const lines=[{itemId:'c',qty:2,areaName:'Archived area'},{itemId:'a',qty:0},{itemId:'b',qty:21}];
 const groups=groupCountLines(lines,items,'l');
 assert.deepEqual(groups.map(g=>g.area),['Archived area','Back Shelf']);
 assert.deepEqual(groups[1].rows.map(r=>r.displayName),['Ápple Juice','Zucchini']);
 assert.equal(groups.flatMap(g=>g.rows).length,3);
 assert.equal(groups[1].rows[1].qty,0);
 assert.equal(groupCountLines(lines,items,'l','apple')[0].rows[0].itemId,'b');
 assert.equal(groupCountLines(lines,items,'l','3802188')[0].rows[0].itemId,'b');
 assert.deepEqual(groupCountLines(lines,items,'l','absent'),[]);
});
