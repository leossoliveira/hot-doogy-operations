import test from 'node:test';
import assert from 'node:assert/strict';
import {purchasingSales} from '../server/purchasing-sales.mjs';
import {salesSummary} from '../server/sales-summary.mjs';
import {purchasingRows,purchasingDemand,purchaseHistory,alphabetical} from '../src/purchasing-model.js';

function fixture(){
 const units=[{id:'each',itemUnitId:'each-item',name:'Each',factor:1,stocktake:true},{id:'case',itemUnitId:'case-item',name:'Case',factor:12,ordering:true}];
 const vendor={id:'v1',supplierItemId:'v1',itemId:'i',supplierId:'a',supplierName:'Alpha',name:'Buns',sku:'A1',active:true,supplierActive:true,supplierBusinessActive:true,units,stores:[{id:'l',active:true,locationActive:true}],stocktakeUnitIds:['each'],orderingUnitId:'case'};
 const source={rows:[{date:'2026-09-20',locationId:'l',itemId:'i',baseQty:120},{date:'2026-09-13',locationId:'l',itemId:'i',baseQty:100}],days:[{date:'2026-09-20',locationId:'l',totalLines:1,incompleteLines:0},{date:'2026-09-13',locationId:'l',totalLines:1,incompleteLines:0}]};
 const data={locations:[{id:'l'}],suppliers:[{id:'a',name:'Alpha'},{id:'b',name:'Beta'}],supplierCatalog:{items:[vendor,{...vendor,id:'v2',supplierItemId:'v2',supplierId:'b',supplierName:'Beta',sku:'B2'}]},items:[{id:'i',rowId:'i-l',locationId:'l',type:'purchased',active:true,locationActive:true,units:units.map(u=>({...u,id:u.itemUnitId}))}],purchasingSales:source,salesPeriods:{batches:[{locationId:'l',periodStart:'2026-09-01T04:00:00Z',periodEnd:'2026-10-01T04:00:00Z'}]},inventoryCounts:{rows:[{itemId:'i',locationId:'l',baseQty:24,date:'2026-09-20',exceptions:[]}]}};
 return {data,filter:{start:'2026-09-20',end:'2026-09-20',locationId:'l'},local:{counts:[]}};
}
test('all supplier associations display shared usage once each and filter by vendor SKU',()=>{
 const {data,local,filter}=fixture(),rows=purchasingRows(data,local,filter);assert.equal(rows.length,2);assert.deepEqual(rows.map(r=>r.current),[120,120]);assert.equal(rows[0].previous,100);assert.equal(rows[0].variation,20);assert.equal(rows[0].stock,24);
 assert.deepEqual(purchasingRows(data,local,{...filter,query:'B2'}).map(r=>r.key),['v2']);assert.equal(purchasingRows(data,local,{...filter,supplierId:'a'}).length,1);
 data.supplierCatalog.items[1].supplierActive=false;assert.equal(purchasingRows(data,local,filter).length,1);
});
test('planning converts count units to supplier pack sizes without rounding or losing unknown stock',()=>{
 const {data,local,filter}=fixture(),r=purchasingRows(data,local,filter)[0];assert.deepEqual(purchasingDemand(r,20),{demand:144,net:120,orderQty:10});assert.equal(purchasingDemand({...r,stock:300},0).orderQty,0);assert.equal(purchasingDemand({...r,stock:null},0).orderQty,null);assert.equal(purchasingDemand(r,'').demand,null);assert.equal(purchasingDemand({...r,orderingUnit:null},0).orderQty,null);
});
test('unknown usage, missing coverage, partial estimates, and covered zero are distinct',()=>{
 const {data,local,filter}=fixture();data.purchasingSales.rows=data.purchasingSales.rows.filter(r=>r.date==='2026-09-13');assert.equal(purchasingRows(data,local,filter)[0].current,0);
 data.purchasingSales.days[0].incompleteLines=1;assert.equal(purchasingRows(data,local,filter)[0].partial,true);
 data.purchasingSales.days=[];assert.equal(purchasingRows(data,local,filter)[0].current,null);
 data.purchasingSales.rows=[];assert.match(purchasingRows(data,local,filter)[0].reason,/manually/);
 data.purchasingSales=null;assert.match(purchasingRows(data,local,filter)[0].reason,/unavailable/);
 assert.throws(()=>purchasingRows(data,local,{...filter,end:'2026-09-01'}),/valid period/);
});
function rawRecipes(){return {inventory_items:[{id:'prep',item_type:'prepared'},{id:'nested',item_type:'prepared'},{id:'i',item_type:'purchased'}],recipes:[{id:'r',active:true,output_inventory_item_id:'prep',production_location_id:'kitchen'},{id:'r2',active:true,output_inventory_item_id:'nested'}],recipe_versions:[{id:'v',recipe_id:'r',status:'active',yield_quantity:2,yield_item_unit_id:'out'},{id:'draft',recipe_id:'r',status:'draft',yield_quantity:999,yield_item_unit_id:'out'},{id:'v2',recipe_id:'r2',status:'active',yield_quantity:1,yield_item_unit_id:'nested-unit'}],inventory_item_units:[{id:'out',inventory_item_id:'prep',quantity_in_base_unit:10},{id:'nested-unit',inventory_item_id:'nested',quantity_in_base_unit:1},{id:'unit',inventory_item_id:'i',quantity_in_base_unit:1}],recipe_components:[{recipe_version_id:'v',component_inventory_item_id:'nested',component_item_unit_id:'nested-unit',quantity:4,waste_percent:0,location_id:'kitchen'},{recipe_version_id:'v',component_inventory_item_id:'i',component_item_unit_id:'unit',quantity:1000,location_id:'other'},{recipe_version_id:'v2',component_inventory_item_id:'i',component_item_unit_id:'unit',quantity:2,waste_percent:0.2},{recipe_version_id:'draft',component_inventory_item_id:'i',component_item_unit_id:'unit',quantity:9999}]};}
test('active prep versions expand nested ingredients, production scope, yields and waste; direct sales stay additive',()=>{
 const raw=rawRecipes(),source={itemRows:[{date:'2026-09-20',locationId:'l',itemId:'prep',baseQty:40},{date:'2026-09-20',locationId:'l',itemId:'i',baseQty:3}],days:[]},r=purchasingSales(source,raw);
 assert.deepEqual(r.rows,[{date:'2026-09-20',locationId:'l',itemId:'i',baseQty:23}]);assert.deepEqual(r.expansionWarnings,[]);assert.equal(purchasingSales({rows:[]},raw),null);
 raw.recipe_components.push({recipe_version_id:'v2',component_inventory_item_id:'prep',component_item_unit_id:'out',quantity:1});assert.ok(purchasingSales(source,raw).expansionWarnings.length);
 raw.recipe_versions.push({...raw.recipe_versions[0],id:'v-duplicate'});assert.equal(purchasingSales(source,raw).rows[0].baseQty,3);
});
test('purchase history filters partial receipts and clamps pagination after filters change',()=>{
 const orders=Array.from({length:126},(_,i)=>({id:String(i),number:'PO-'+i,status:i<26?'partially_received':'draft',locationId:i===125?'other':'l',supplierName:'Alpha'}));
 assert.equal(purchaseHistory(orders).rows.length,25);assert.equal(purchaseHistory(orders,{pageSize:'50'}).rows.length,50);assert.equal(purchaseHistory(orders,{pageSize:'100'}).rows.length,100);assert.equal(purchaseHistory(orders,{pageSize:'all',page:9}).rows.length,126);
 let p=purchaseHistory(orders,{status:'awaiting_receipt',page:8});assert.equal(p.page,2);assert.equal(p.rows.length,1);assert.equal(p.end,26);
 p=purchaseHistory(orders,{locationId:'l',status:'draft',pageSize:'all'});assert.equal(p.total,99);assert.equal(p.pages,1);
 assert.equal(purchaseHistory(orders,{status:'received'}).start,0);assert.equal(purchaseHistory(orders,{query:'PO-125'}).total,1);
});
test('supplier names sort naturally A–Z regardless of case',()=>{assert.deepEqual(['Zeta','alpha','Supplier 10','Supplier 2','Beta'].map(name=>({name})).sort(alphabetical).map(x=>x.name),['alpha','Beta','Supplier 2','Supplier 10','Zeta']);});
test('background summary aggregates all purchasing pages without changing Prep totals and caches the result',async()=>{
 const raw={inventory_items:[{id:'i',item_type:'purchased'}],sales_item_facts:Array.from({length:201},()=>({source_row_id:'id'}))},session={token:'test'},calls=[];
 const auth={request:async(path,{body})=>{calls.push(body.p_after);return {meta:{processed:201,hasMore:false,nextCursor:'10000000-0000-4000-8000-000000000201',catalogSignature:'catalog'},rows:[],itemRows:[{date:'2026-09-20',locationId:'l',itemId:'i',baseQty:12}],days:[{date:'2026-09-20',locationId:'l',totalLines:201,incompleteLines:0}],issues:[]};}};
 const result=await salesSummary(auth,session,raw);assert.deepEqual(result.rows,[]);assert.equal(result.purchasingSales.rows[0].baseQty,12);assert.equal(result.days[0].totalLines,201);assert.equal(await salesSummary(auth,session,raw),result);assert.equal(calls.length,1);
});

test('order history combines supplier, status and inclusive New York dates across daylight saving time',()=>{
 const base={supplierId:'a',supplierName:'Alpha',locationId:'l',status:'ordered'};
 const orders=[{...base,id:'before',orderedAt:'2026-11-01T03:59:59Z'},{...base,id:'start',orderedAt:'2026-11-01T04:00:00Z'},{...base,id:'end',orderedAt:'2026-11-02T04:59:59Z'},{...base,id:'after',orderedAt:'2026-11-02T05:00:00Z'},{...base,id:'draft',status:'draft',createdAt:'2026-11-01T17:00:00Z'},{...base,id:'other',supplierId:'b',orderedAt:'2026-11-01T17:00:00Z'},{...base,id:'missing'}];
 const filters={start:'2026-11-01',end:'2026-11-01',supplierId:'a',status:'awaiting_receipt'};
 assert.deepEqual(purchaseHistory(orders,filters).rows.map(o=>o.id),['start','end']);
 assert.deepEqual(purchaseHistory(orders,{...filters,status:'draft'}).rows.map(o=>o.id),['draft']);
 assert.equal(purchaseHistory(orders,{supplierId:'a',start:'2026-11-02'}).total,1);
 assert.equal(purchaseHistory(orders,{supplierId:'a',end:'2026-10-31'}).total,1);
 assert.equal(purchaseHistory(orders).total,7);
 assert.throws(()=>purchaseHistory(orders,{start:'2026-11-02',end:'2026-11-01'}),/on or after/);
 assert.throws(()=>purchaseHistory(orders,{start:'2026-02-30'}),/valid order dates/);
});

test('purchasing usage comes from sales, not physical counts or quantities purchased',()=>{
 const {data,local,filter}=fixture();
 const original=purchasingRows(data,local,filter)[0];
 data.inventoryCounts.rows[0].baseQty=9000;
 data.orders=[{supplierId:'a',lines:[{itemId:'i',qty:500}]}];
 const changedStock=purchasingRows(data,local,filter)[0];
 assert.equal(changedStock.current,original.current);assert.equal(changedStock.stock,9000);
 data.purchasingSales.rows[0].baseQty=240;
 assert.equal(purchasingRows(data,local,filter)[0].current,240);
});

test('Planning works first and retains its own dates, supplier and entered quantities after Usage changes',async()=>{
 const {createPurchasingUI}=await import('../src/purchasing-ui.js');
 const {data,local}=fixture();data.meta={};
 const state={store:'l',q:'',page:1},inputs={'#purchase-start':{value:'2026-09-20'},'#purchase-end':{value:'2026-09-20'}},messages=[];
 const previousDocument=globalThis.document;globalThis.document={querySelector:selector=>inputs[selector]};
 try{
  let plan;
  const ui=createPurchasingUI({data:()=>data,local:()=>local,state:()=>state,render:()=>{},toast:m=>messages.push(m),heading:()=>'',icon:()=>'',orderTable:()=>'',newOrder:value=>{plan=value;}});
  ui.page('planning');
  assert.match(ui.page('planning'),/id="purchase-start" type="date" value=""/);
  ui.changed({id:'purchase-start',dataset:{}});ui.changed({dataset:{purchaseChange:'supplier'},value:'a'});
  ui.input({dataset:{purchaseQty:'v1'},value:'2'});ui.actions['purchase-review']();
  assert.equal(plan.supplierId,'a');assert.equal(plan.lines[0].qty,2);assert.match(plan.notes,/09\/20\/2026/);
  ui.page('usage');
  assert.match(ui.page('usage'),/id="purchase-start" type="date" value=""/);
  assert.match(ui.page('usage'),/aria-label="Supplier: All"/);
  inputs['#purchase-start'].value='2026-09-13';inputs['#purchase-end'].value='2026-09-13';ui.changed({id:'purchase-start',dataset:{}});ui.changed({dataset:{purchaseChange:'supplier'},value:'b'});
  ui.page('planning');
  assert.match(ui.page('planning'),/id="purchase-start" type="date" value="2026-09-20"/);
  ui.actions['purchase-review']();assert.equal(plan.supplierId,'a');assert.equal(plan.lines[0].qty,2);assert.match(plan.notes,/09\/20\/2026/);assert.deepEqual(messages,[]);
 }finally{if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;}
});

test('multiple suppliers and empty selection filter usage and history consistently',()=>{
 const {data,local,filter}=fixture();
 assert.equal(purchasingRows(data,local,{...filter,supplierId:['a','b']}).length,2);
 assert.equal(purchasingRows(data,local,{...filter,supplierId:['b']})[0].key,'v2');
 assert.equal(purchasingRows(data,local,{...filter,supplierId:[]}).length,0);
 const orders=['a','b','c'].map(supplierId=>({id:supplierId,supplierId,status:'draft'}));
 assert.equal(purchaseHistory(orders,{supplierId:['a','b']}).total,2);
 assert.equal(purchaseHistory(orders,{supplierId:[]}).total,0);
});

test('history supports multiple statuses including partial receipts and empty selection',()=>{
 const orders=['draft','ordered','partially_received','received'].map(status=>({id:status,status}));
 assert.equal(purchaseHistory(orders,{status:['awaiting_receipt','draft']}).total,3);
 assert.equal(purchaseHistory(orders,{status:['received']}).total,1);
 assert.equal(purchaseHistory(orders,{status:[]}).total,0);
});

test('delivery sorting is chronological before pagination and keeps missing dates last',()=>{
 const orders=[{id:'none'},{id:'new',expectedAt:'2026-10-05'},{id:'old',expectedAt:'2025-12-31'}];
 assert.deepEqual(purchaseHistory(orders,{deliverySort:'asc'}).rows.map(x=>x.id),['old','new','none']);
 assert.deepEqual(purchaseHistory(orders,{deliverySort:'desc'}).rows.map(x=>x.id),['new','old','none']);
});


test('Purchasing opens history without tabs and exposes separate planning and usage pages',async()=>{
 const {createPurchasingUI}=await import('../src/purchasing-ui.js');
 const {data,local}=fixture();data.meta={};const state={store:'all',q:'',page:1};
 const ui=createPurchasingUI({data:()=>data,local:()=>local,state:()=>state,render:()=>{},toast:()=>{},heading:(_group,title,_description,actions='')=>`<h1>${title}</h1>${actions}`,icon:()=>'',orderTable:()=>'<table>Order history</table>',orders:()=>[],newOrder:()=>{}});
 const history=ui.page();assert.match(history,/Order history/);assert.match(history,/New immediate order/);assert.match(history,/data-action="purchase-planning"/);assert.doesNotMatch(history,/Purchasing sections|purchase-tab|Usage by Supplier/);
 assert.match(ui.page('planning'),/Purchase planning/);assert.match(ui.page('planning'),/Back to orders/);
 assert.match(ui.page('usage'),/Usage by Supplier/);assert.match(ui.page('usage'),/Back to reports/);
 assert.match(ui.page(),/Order history/);
});


test('order summary counts all matching pages and includes partial receipts; summary clicks filter only the list and preserve every status total',async()=>{
 const {createPurchasingUI}=await import('../src/purchasing-ui.js');
 const {data,local}=fixture();data.meta={};const state={store:'l',q:'',page:1};let shown=[];
 const orders=[...Array.from({length:27},(_,i)=>({id:`draft-${i}`,status:'draft',locationId:'l',supplierName:'Alpha'})),{id:'placed',status:'ordered',locationId:'l',supplierName:'Alpha'},{id:'partial',status:'partially_received',locationId:'l',supplierName:'Alpha'},{id:'received',status:'received',locationId:'l',supplierName:'Alpha'},{id:'canceled',status:'cancelled',locationId:'l',supplierName:'Alpha'},{id:'elsewhere',status:'received',locationId:'other',supplierName:'Alpha'}];
 const ui=createPurchasingUI({data:()=>data,local:()=>local,state:()=>state,render:()=>{},toast:()=>{},heading:()=>'',icon:()=>'',orderTable:rows=>{shown=rows;return '';},orders:()=>orders,newOrder:()=>{}});
 const count=(html,status)=>Number(html.match(new RegExp(`data-status="${status}"[\\s\\S]*?<strong>([0-9]+)</strong>`))[1]);
 let html=ui.page();assert.equal(count(html,'draft'),27);assert.equal(count(html,'awaiting_receipt'),2);assert.equal(count(html,'received'),1);assert.equal(shown.length,25);
 state.page=2;ui.actions['purchase-summary-filter']({dataset:{status:'awaiting_receipt'}});html=ui.page();assert.equal(state.page,1);assert.deepEqual(shown.map(o=>o.id),['placed','partial']);assert.match(html,/data-status="awaiting_receipt" aria-pressed="true"/);assert.equal(count(html,'draft'),27);assert.equal(count(html,'received'),1);
 ui.actions['purchase-summary-filter']({dataset:{status:'awaiting_receipt'}});html=ui.page();assert.equal(shown.length,2);assert.match(html,/data-status="awaiting_receipt" aria-pressed="true"/);
 ui.actions['purchase-summary-filter']({dataset:{status:'received'}});html=ui.page();assert.deepEqual(shown.map(o=>o.id),['received']);assert.equal(count(html,'awaiting_receipt'),2);assert.equal(count(html,'received'),1);assert.equal(count(html,'draft'),27);
 ui.actions['purchase-history-clear']();html=ui.page();assert.equal(shown.length,25);assert.equal(count(html,'draft'),27);
 state.q='not found';html=ui.page();assert.equal(count(html,'draft'),0);assert.equal(count(html,'received'),0);
 state.q='';state.store='other';html=ui.page();assert.equal(count(html,'received'),1);assert.equal(count(html,'draft'),0);
 assert.doesNotMatch(ui.page('planning'),/aria-label="Order summary"/);
});
