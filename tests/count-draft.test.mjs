import test from 'node:test';
import assert from 'node:assert/strict';
import {createCountSync,sectionIsPublished} from '../src/count-draft.js';
import {countSessions} from '../src/count-history.js';
test('draft writes serialize versions, snapshot input and retry the same ambiguous request',async()=>{
 const calls=[];let fail=true;
 const sync=createCountSync({id:'s',locationId:'l',request:async body=>{calls.push(structuredClone(body));if(fail){fail=false;throw Error('Connection lost');}return {version:body.expectedVersion+1};}});
 const state={notes:'first'};const first=sync.save(state);state.notes='second';await assert.rejects(first);
 await sync.save(state);assert.equal(calls.length,3);assert.deepEqual(calls[0],calls[1]);assert.equal(calls[0].state.notes,'first');assert.equal(calls[2].expectedVersion,1);assert.equal(calls[2].state.notes,'second');
 const results=await Promise.all([sync.save({notes:'third'}),sync.save({notes:'fourth'},'section','Freezer')]);assert.deepEqual(results.map(r=>r.version),[3,4]);assert.equal(calls.at(-1).expectedVersion,3);assert.equal(calls.at(-1).section,'Freezer');
});
test('published section includes hidden rows and recognizes blank as zero; edits invalidate completion',()=>{
 const lines=[{rowId:'b',itemId:'b',itemUnitId:'u',qty:''},{rowId:'a',itemId:'a',itemUnitId:'u',qty:'2'}],published=[{itemId:'a',itemUnitId:'u',qty:2},{itemId:'b',itemUnitId:'u',qty:0}];
 assert.equal(sectionIsPublished(lines,published),true);assert.equal(sectionIsPublished(lines,undefined),false);assert.equal(sectionIsPublished([{...lines[0],qty:1},lines[1]],published),false);
});
test('partially published draft appears once in history and completes without losing its lines',()=>{
 const obs=[{id:'o',sessionId:'s',locationId:'l',inventoryItemId:'i',quantity:0}],draft={id:'s',locationId:'l',createdBy:'actor',status:'draft',createdAt:'2026-10-19T12:00:00Z',state:{notes:'Keep',lines:[{itemId:'i',issue:'Broken'}]}};
 let rows=countSessions(obs,[],[],[draft]);assert.equal(rows.length,1);assert.equal(rows[0].status,'draft');assert.equal(rows[0].lines[0].qty,0);assert.equal(rows[0].createdBy,'actor');assert.equal(rows[0].issues[0].text,'Broken');
 rows=countSessions(obs,[],[],[{...draft,status:'completed',completedAt:'2026-10-19T13:00:00Z'}]);assert.equal(rows[0].status,'completed');assert.equal(rows[0].countedAt,'2026-10-19T13:00:00Z');assert.equal(rows[0].notes,'Keep');
});

test('retrying completion after a lost response returns its receipt without submitting again',async()=>{
 let calls=0;const sync=createCountSync({id:'s',locationId:'l',version:2,request:async body=>{calls++;if(calls===1)throw Error('Response lost');return {version:3,status:'completed'};}});
 await assert.rejects(sync.save({notes:'done'},'complete'));const result=await sync.save({notes:'done'},'complete');assert.equal(result.status,'completed');assert.equal(calls,2);
});
