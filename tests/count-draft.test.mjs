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

test('a rejected unit does not trap later corrected quantities behind the failed request',async()=>{
 const calls=[];
 const sync=createCountSync({id:'s',locationId:'l',version:7,request:async body=>{calls.push(body);if(body.state.unit==='invalid')throw Object.assign(Error('Invalid unit'),{status:422});return {version:8};}});
 await assert.rejects(sync.save({unit:'invalid',qty:9}));
 await sync.save({unit:'valid',qty:9});
 assert.equal(calls.length,2);assert.equal(calls[1].expectedVersion,7);assert.notEqual(calls[0].requestId,calls[1].requestId);assert.equal(calls[1].state.qty,9);
});
test('queued corrected edits can proceed after a definitive rejection',async()=>{
 const calls=[];const sync=createCountSync({id:'s',locationId:'l',version:1,request:async b=>{calls.push(b);if(b.state.invalid)throw Object.assign(Error('bad'),{status:422});return {version:2};}});
 const bad=sync.save({invalid:true});const corrected=sync.save({qty:4});await assert.rejects(bad);assert.equal((await corrected).version,2);assert.equal(calls.length,2);
});
test('lost completion receipt followed by save or close never submits to a completed draft again',async()=>{
 const calls=[];const sync=createCountSync({id:'s',locationId:'l',version:2,request:async b=>{calls.push(b);if(calls.length===1)throw Error('Response lost');return {version:3,status:'completed'};}});
 await assert.rejects(sync.save({qty:3},'complete'));
 assert.equal((await sync.save({qty:3})).status,'completed');assert.deepEqual(calls[0],calls[1]);
 assert.equal((await sync.save({qty:4},'complete')).status,'completed');assert.equal(calls.length,2);
});
test('timeouts and throttling preserve the request identity until its outcome is known',async()=>{
 for(const status of [408,429,502]){const calls=[];const sync=createCountSync({id:'s',locationId:'l',request:async b=>{calls.push(b);if(calls.length===1)throw Object.assign(Error('retry'),{status});return {version:1};}});await assert.rejects(sync.save({qty:2}));await sync.save({qty:2});assert.deepEqual(calls[0],calls[1]);}
});

test('completion review includes hidden items in the selected section and distinguishes explicit zero',async()=>{
 const {countCompletionReview}=await import('../src/count-draft.js');
 const lines=[{section:'Freezer',qty:''},{section:'Freezer',qty:'0'},{section:'Dry',qty:'2'},{section:'Dry',qty:''}];
 assert.deepEqual(countCompletionReview(lines,'Freezer'),{total:2,filled:1,blank:1});
 assert.deepEqual(countCompletionReview(lines),{total:4,filled:2,blank:2});assert.equal(lines[0].qty,'');
 assert.equal(countCompletionReview([{qty:''}]).filled,0);
});
test('recovery ignores JSON key order, restores matching versions and retains conflicts for review',async()=>{
 const {countRecovery}=await import('../src/count-draft.js');
 const state={notes:'saved',lines:[{rowId:'r',itemId:'i',section:'S',qty:'3'}]},saved={id:'s',version:4,state};
 assert.equal(countRecovery(saved,{id:'s',version:4,state:{lines:state.lines,notes:'saved'}}).kind,'none');
 const cached={id:'s',version:4,state:{...state,notes:'unsynced'}};
 assert.equal(countRecovery(saved,cached).kind,'restore');
 assert.equal(countRecovery({...saved,version:5},cached).kind,'conflict');
 assert.equal(countRecovery(saved,{...cached,state:{...cached.state,lines:[]}}).kind,'conflict');
 assert.equal(countRecovery(saved,{...cached,id:'other'}).kind,'none');
 assert.equal(cached.state.notes,'unsynced');
});
