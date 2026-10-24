import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as tick} from 'node:timers/promises';
import {planningReferenceOptions,validatePlanningReference,roundProductionUp} from '../src/preparation-planning.js';
import {createPreparationPlan,periodWindow,shiftDay} from '../src/preparation-model.js';
import {createPreparationUI} from '../src/preparation-ui.js';
import {configureCommit} from '../src/cloud.js';
import {preparationPdfColumns} from '../src/preparation-pdf.js';

test('future coverage selects completed equivalent weekdays, bounded by imported sales',()=>{
 const refs=planningReferenceOptions({start:'2026-10-23',end:'2026-10-27',today:'2026-10-24',latestSaleDate:'2026-10-22'});
 assert.deepEqual(refs[0],{weeks:1,start:'2026-10-16',end:'2026-10-20'});
 const stale=planningReferenceOptions({start:'2026-10-23',end:'2026-10-27',today:'2026-10-24',latestSaleDate:'2026-10-17'});
 assert.deepEqual(stale[0],{weeks:2,start:'2026-10-09',end:'2026-10-13'});
 for(const r of refs){assert.equal(periodWindow(r.start,r.end).days,5);assert.equal(new Date(r.start).getUTCDay(),new Date('2026-10-23').getUTCDay());assert.ok(r.end<'2026-10-24');}
 const distant=planningReferenceOptions({start:'2027-02-10',end:'2027-02-15',today:'2026-10-24',latestSaleDate:'2026-10-22'});assert.ok(distant[0].end<='2026-10-22');
});
test('custom reference must be historical and match the coverage duration',()=>{
 const coverage={start:'2026-10-23',end:'2026-10-27'};
 assert.throws(()=>validatePlanningReference(coverage,{start:'2026-10-20',end:'2026-10-24'},'2026-10-24'),/completed historical/);
 assert.throws(()=>validatePlanningReference(coverage,{start:'2026-10-15',end:'2026-10-20'},'2026-10-24'),/5 days/);
 assert.deepEqual(validatePlanningReference(coverage,{start:'2026-10-09',end:'2026-10-13'},'2026-10-24'),{start:'2026-10-09',end:'2026-10-13'});
});
test('whole-unit suggestions round up, retain unknown quantities and clamp surplus',()=>{
 assert.equal(roundProductionUp(5.68),6);assert.equal(roundProductionUp(0.01),1);assert.equal(roundProductionUp(6),6);assert.equal(roundProductionUp(-2),0);assert.equal(roundProductionUp(null),null);assert.equal(roundProductionUp(''),null);
 const units=[{stocktake:true,itemUnitId:'unit',name:'Bag',factor:1}];
 const items=['origin','dest'].map(locationId=>({id:'prep',locationId,type:'prepared',units}));
 const result=createPreparationPlan({production:[],transfers:[]},{rows:[{itemId:'prep',qty:5.68}],fromLocationId:'origin',toLocationId:'dest',date:'2026-10-23'},items,[{outputItemId:'prep',type:'prep',status:'active',versionId:'v'}],[{id:'origin',name:'Origin'},{id:'dest',name:'Destination'}],'plan','2026-10-22T12:00:00Z');
 assert.equal(result.production[0].qty,6);assert.equal(result.transfers[0].lines[0].qty,6);
 assert.deepEqual(preparationPdfColumns(true).map(c=>c.id),['item','current','margin','demand','stock','qty']);
});
test('Planning requests only historical sales, rounds inputs and saves coverage plus reference',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-24T16:00:00Z')});
 const previousFetch=globalThis.fetch,previousDocument=globalThis.document,requests=[],messages=[];let saved,modal;
 const inputs={'#prep-coverage-start':{value:'2026-10-23'},'#prep-coverage-end':{value:'2026-10-27'}};
 globalThis.document={querySelector:selector=>inputs[selector]};
 globalThis.fetch=async path=>{
  const url=new URL(path,'http://test');requests.push(url);
  const days=[];for(let date=url.searchParams.get('start');date<=url.searchParams.get('end');date=shiftDay(date,1))days.push({date,locationId:'mall',totalLines:1,incompleteLines:0});
  return {ok:true,json:async()=>({status:'ready',result:{days,rows:days.map(d=>({...d,itemId:'prep',baseQty:1.04}))}})};
 };
 configureCommit(async value=>{saved=value;});
 try{
  const units=[{stocktake:true,itemUnitId:'unit',name:'Bag',factor:1}];
  const items=['plaza','mall'].map(locationId=>({id:'prep',rowId:locationId,locationId,type:'prepared',name:'Prep test',units}));
  const data={locations:[{id:'plaza',name:'Sherwood Plaza'},{id:'mall',name:'Natick Mall'}],recipes:[{outputItemId:'prep',type:'prep',status:'active',versionId:'v'}],salesDaily:[{date:'2026-10-22'}],salesPeriods:{facts:[],batches:[{locationId:'mall',periodStart:'2026-10-01T04:00:00Z',periodEnd:'2026-11-01T04:00:00Z'}]},inventoryCounts:{rows:[{itemId:'prep',locationId:'mall',qty:2,baseQty:2,date:'2026-10-22'}]}};
  const ui=createPreparationUI({data:()=>data,local:()=>({production:[],transfers:[],counts:[]}),setLocal:()=>{},items:()=>items,state:()=>({store:'all'}),render:()=>{},icon:()=>'',toast:value=>messages.push(value),openModal:(title,body)=>{modal={title,body};},close:()=>{}});
  assert.match(ui.page(),/>Add Prep</);ui.page('planning');
  ui.changed({id:'prep-coverage-start',dataset:{}});await tick();
  assert.ok(requests.every(u=>u.searchParams.get('end')<'2026-10-24'));
  assert.equal(requests.at(-1).searchParams.get('end'),'2026-10-20');
  let html=ui.page('planning');assert.match(html,/hd-date-value">Prior week/);assert.doesNotMatch(html,/Most recent available/);assert.doesNotMatch(html,/id="prep-produce-at"|id="prep-delivery"/);assert.match(html,/data-prep-qty="prep"[^>]*step="1"[^>]*value="4"/);
  ui.input({id:'prep-plan-notes',dataset:{},value:'Deliver before lunch'});
  const qty={dataset:{prepQty:'prep'},value:'4.2'};ui.input(qty);ui.changed(qty);assert.equal(qty.value,5);
  await ui.actions['prep-create-plan']();assert.equal(saved,undefined);assert.match(modal.body,/Produce at/);assert.match(modal.body,/Delivery date/);inputs['#prep-plan-form']={reportValidity:()=>true};inputs['#prep-plan-error']={textContent:''};inputs['#prep-produce-at']={value:'mall'};inputs['#prep-delivery']={value:'2026-10-25'};await ui.actions['prep-plan-confirm']();assert.equal(saved,undefined);assert.ok(inputs['#prep-plan-error'].textContent);inputs['#prep-produce-at'].value='plaza';await ui.actions['prep-plan-confirm']();assert.equal(saved.transfers[0].lines[0].qty,5);
  assert.match(saved.transfers[0].notes,/Coverage: 10\/23\/2026 – 10\/27\/2026/);assert.match(saved.transfers[0].notes,/Historical reference: 10\/16\/2026 – 10\/20\/2026/);assert.match(saved.transfers[0].notes,/Deliver before lunch/);
  ui.changed({dataset:{prepChange:'referenceMode'},value:'2'});ui.page('planning');await tick();assert.equal(requests.at(-1).searchParams.get('end'),'2026-10-13');
  html=ui.page('planning');assert.match(html,/Coverage period/);assert.doesNotMatch(html,/Coverage and route/);assert.match(html,/Recipes/);assert.match(html,/Custom/);
  assert.deepEqual(messages,['Plan and transfer request created.']);
  data.salesPeriods.batches[0].periodEnd='2026-10-18T04:00:00Z';ui.actions['prep-reference-select']({dataset:{value:'1'}});await tick();html=ui.page('planning');assert.match(html,/Sales do not cover the full reference period/);assert.match(html,/Use 2 weeks prior/);ui.actions['prep-reference-select']({dataset:{value:'2'}});await tick();html=ui.page('planning');assert.doesNotMatch(html,/Sales do not cover the full reference period/);assert.match(html,/hd-date-value">2 weeks prior/);assert.match(html,/data-prep-qty="prep"[^>]*value="4"/);
  const count=requests.length;inputs['#prep-coverage-start'].value='2026-12-01';inputs['#prep-coverage-end'].value='2026-12-05';ui.changed({id:'prep-coverage-start',dataset:{}});html=ui.page('planning');assert.match(html,/hd-date-value">Prior week/);assert.match(html,/completed historical period/);assert.equal(requests.length,count);
 }finally{globalThis.fetch=previousFetch;globalThis.document=previousDocument;configureCommit(async()=>{throw Error('Test commit not configured');});t.mock.timers.reset();}
});
