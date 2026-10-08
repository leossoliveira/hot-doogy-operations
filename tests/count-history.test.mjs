import test from 'node:test';
import assert from 'node:assert/strict';
import {countSessions,historyRows,historyDateTime} from '../src/count-history.js';
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
