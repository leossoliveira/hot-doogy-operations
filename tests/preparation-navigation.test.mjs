import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as tick} from 'node:timers/promises';
import {createPreparationUI} from '../src/preparation-ui.js';
import {createReportsUI} from '../src/reports-ui.js';
import {REPORT_CATALOG,reportRoute} from '../src/reports-model.js';
import {routeScope} from '../src/workspace-scope.js';
import {routeModule,effectiveProfile} from '../src/permission-profiles.js';
import {canViewRoute,setAccessProfile} from '../src/access.js';

function fixture(readOnly=false){
 const data={locations:[{id:'plaza',name:'Sherwood Plaza'},{id:'mall',name:'Natick Mall'}],recipes:[],salesPeriods:{facts:[],batches:[]},preparationHistory:{batches:[]}};
 const local={production:[{id:'batch',local:true,status:'completed',itemId:'prep',name:'Completed prep',locationId:'plaza',locationName:'Sherwood Plaza',qty:2,uom:'Bag',completedAt:'2026-10-23T14:00:00Z'}]};
 const state={store:'all'};let renders=0;
 const ui=createPreparationUI({data:()=>data,local:()=>local,items:()=>[],state:()=>state,readOnly:()=>readOnly,render:()=>{renders++;},icon:()=>'',toast:()=>{}});
 return {ui,state,get renders(){return renders;}};
}
test('Prep opens completed history without tabs, usage requests or PDF errors',()=>{
 const previous=globalThis.fetch;let requests=0;globalThis.fetch=()=>{requests++;throw Error('Unexpected usage request');};
 try{
  const {ui}=fixture();const html=ui.page();
  assert.match(html,/BATCH \/ PREP ITEM/);assert.doesNotMatch(html,/<h2>Production history|[0-9]+ completed batches/);assert.match(html,/Completed prep/);assert.match(html,/data-action="prep-planning"/);assert.match(html,/data-action="prep-new-batch"/);assert.match(html,/Print labels/);
  assert.doesNotMatch(html,/Prep sections|prep-tab|prep-export-pdf|prep-start/);assert.equal(requests,0);
 }finally{globalThis.fetch=previous;}
});
test('Planning opens directly, retains draft input across routes, and history cancels stale usage responses',async()=>{
 const previous=globalThis.fetch;const pending=[];
 globalThis.fetch=()=>new Promise(resolve=>pending.push(resolve));
 try{
  const f=fixture();assert.match(f.ui.page('planning'),/Coverage period/);assert.equal(pending.length,1);
  f.ui.input({id:'prep-plan-notes',value:'Keep this production note',dataset:{}});
  f.ui.input({id:'',value:'3',dataset:{prepQty:'prep'}});assert.equal(f.ui.dirty,true);
  assert.match(f.ui.page(),/BATCH \/ PREP ITEM/);
  pending[0]({ok:true,json:async()=>({status:'ready',result:{rows:[],days:[]}})});await tick();assert.equal(f.renders,0);
  assert.match(f.ui.page('usage'),/Prep usage/);assert.equal(pending.length,2);
  f.ui.page();assert.match(f.ui.page('planning'),/Keep this production note/);assert.equal(f.ui.dirty,true);
  f.ui.leavePage();
  for(const resolve of pending.slice(1))resolve({ok:true,json:async()=>({status:'ready',result:{rows:[],days:[]}})});
  await tick();assert.equal(f.renders,0);
 }finally{globalThis.fetch=previous;}
});
test('Reports links to Prep usage and planning retains existing role and profile restrictions',()=>{
 const spec=REPORT_CATALOG.find(r=>r.id==='prep-usage');assert.equal(spec.group,'Operations');
 const reports=createReportsUI({state:()=>({route:'reports'}),heading:()=>'',icon:()=>''});assert.match(reports.catalog(),/href="#report-prep-usage"/);
 for(const route of ['preparation','prep-planning','report-prep-usage'])assert.equal(routeScope(route),'operations');
 assert.equal(routeModule('prep-planning'),'preparation');assert.equal(routeModule(reportRoute(spec.id)),'reports');
 setAccessProfile(null);assert.equal(canViewRoute('staff','prep-planning'),false);assert.equal(canViewRoute('staff','preparation'),true);
 const {ui}=fixture(true);assert.doesNotMatch(ui.page(),/data-action="prep-planning"/);assert.match(ui.page('planning'),/BATCH \/ PREP ITEM/);
 setAccessProfile(effectiveProfile('manager',{preparation:{view:false}}));assert.equal(canViewRoute('manager','prep-planning'),false);setAccessProfile(null);
});
