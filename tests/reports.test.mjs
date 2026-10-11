import test from 'node:test';
import assert from 'node:assert/strict';
import {REPORTS,reportRoute,buildReport,reportCsv} from '../src/reports-model.js';
import {createReportsUI} from '../src/reports-ui.js';
import {canViewRoute} from '../src/access.js';
import {projectData} from '../server/live-data.mjs';
const base=()=>({locations:[{id:'a',name:'Sherwood'},{id:'b',name:'Natick'}],suppliers:[{id:'s',name:'Vendor'}],meta:{extractedAt:'2026-10-11T12:00:00Z'},ingredientItems:[{id:'i',name:'Ingredient',baseUom:'lb',categoryId:'food'}],costInputs:{menus:[{id:'m',name:'Hot dog',categoryId:'food'}],categories:[{id:'food',name:'Food'}]},salesPeriods:{facts:[],batches:[]},salesDaily:[],recipes:[],items:[],supplierCatalog:{items:[],storageAreas:[]}});
const sale=(fields={})=>({locationId:'a',menuItemId:'m',date:'2026-10-03',occurredAt:'2026-10-04T03:30:00Z',quantity:2,grossSales:20,discounts:-2,netSales:18,...fields});
test('sales use inclusive New York dates, location and category before aggregating',()=>{
 const d=base();d.salesPeriods.facts=[sale(),sale({locationId:'b',netSales:40}),sale({date:'2026-10-04',occurredAt:'2026-10-04T04:00:00Z',netSales:80})];
 const r=buildReport('sales',d,{start:'2026-10-03',end:'2026-10-03',category:'food'},'a');assert.equal(r.rows.length,1);assert.equal(r.rows[0].netSales,18);
 const h=buildReport('hours',d,{hour:'23'},'a');assert.equal(h.rows[0].dayName,'Saturday');assert.equal(h.rows[0].hourLabel,'23:00–23:59');assert.equal(h.rows[0].netSales,18);
 assert.equal(buildReport('sales',d,{category:'other'}).rows.length,0);
 assert.throws(()=>buildReport('sales',d,{start:'2026-10-05',end:'2026-10-01'}),/End date/);
 assert.throws(()=>buildReport('sales',d,{start:'2026-02-30'}),/valid/);
});
test('unknown sales amounts are not zero; negative adjustments disable misleading ABC',()=>{
 const d=base();d.salesPeriods.facts=[sale(),sale({netSales:null})];assert.equal(buildReport('sales',d).rows[0].netSales,null);
 d.salesPeriods.facts=[sale(),sale({menuItemId:'other',netSales:-3})];const r=buildReport('mix',d);assert.equal(r.rows.reduce((s,r)=>s+r.netSales,0),15);assert.ok(r.rows.every(r=>r.abc===null));
});
test('invoice lines preserve credit amounts and exclude drafts and cancellations',()=>{
 const d=base();d.invoices=['approved','paid','cancelled'].map((status,i)=>({id:String(i),number:String(i),date:'2026-10-01',locationId:'a',supplierId:'s',status,total:i===1?-10:20,lines:[{itemId:'i',quantity:i===1?-1:2,lineTotal:i===1?-10:20,uom:'lb'}]}));
 const r=buildReport('purchases',d,{item:'i',supplier:'s'},'a');assert.equal(r.rows.length,2);assert.equal(r.metrics[0].value,10);assert.equal(buildReport('purchases',d,{status:'credit'}).rows.length,1);
});
test('payment reports never invent payment dates; payable date basis applies to due dates',()=>{
 const d=base();d.invoices=[{locationId:'a',supplierId:'s',status:'paid',currency:'USD',total:20,date:'2026-09-01',dueDate:'2026-10-01'},{locationId:'a',supplierId:'s',status:'paid',currency:'USD',total:30,date:'2026-09-01',paymentDate:'2026-10-03',dueDate:'2026-10-01',paymentMethod:'cash'}];
 const r=buildReport('cash',d,{start:'2026-10-01',end:'2026-10-04'});assert.equal(r.rows.length,1);assert.equal(r.metrics[0].value,30);assert.match(r.warnings[0],/1 paid invoices/);
 assert.equal(buildReport('payables',d,{start:'2026-10-01',dateBasis:'due'}).rows.length,2);assert.equal(buildReport('payables',d,{start:'2026-10-01'}).rows.length,0);
});
test('price deltas use prior approved scope and normalized units even outside selected dates',()=>{
 const d=base();d.supplierCatalog.items=[{id:'s1',itemId:'i',supplierId:'s',name:'Ingredient',priceHistory:[{id:'1',date:'2026-09-01',amount:20,unitFactor:10,status:'approved'},{id:'2',date:'2026-09-10',amount:999,unitFactor:10,status:'pending'},{id:'3',date:'2026-10-01',amount:30,unitFactor:10,status:'approved'}]}];
 const r=buildReport('prices',d,{start:'2026-10-01'},'a');assert.equal(r.rows.length,1);assert.equal(r.rows[0].previous,2);assert.equal(r.rows[0].change,50);assert.match(r.rows[0].location,/shared/);
});
test('undated production stays visible without date filters, excluded with explanation otherwise',()=>{
 const d=base();d.preparationHistory={batches:[{itemId:'i',locationId:'a',status:'completed',plannedBase:10,actualBase:0,createdAt:'2026-10-01T12:00Z'},{itemId:'i',locationId:'b',status:'completed',plannedBase:10,actualBase:12,completedAt:'2026-10-02T12:00Z'}]};
 assert.equal(buildReport('production',d,{},'a').rows[0].yield,0);const r=buildReport('production',d,{start:'2026-10-01'},'a');assert.equal(r.rows.length,0);assert.ok(r.warnings.some(w=>w.includes('1 otherwise matching')));
});
test('receiving leaves unverified receipt and ordered quantity unknown; transfers match both locations',()=>{
 const d=base();d.orders=[{locationId:'a',lines:[{itemId:'i',orderedQuantity:5,receivedQuantity:null},{itemId:'i',receivedQuantity:2}]}];const rows=buildReport('receiving',d).rows;assert.equal(rows[0].remaining,null);assert.equal(rows[1].remaining,null);
 d.transfers=[{fromLocationId:'a',toLocationId:'b',lines:[{itemId:'i',requestedQuantity:5,dispatchedQuantity:4,receivedQuantity:3}]}];assert.equal(buildReport('transfers',d,{},'a').rows[0].transit,1);assert.equal(buildReport('transfers',d,{destination:'a'},'b').rows.length,0);
});
test('projected completed counts retain unknown expected quantities and base-unit variances',()=>{
 const d=projectData({locations:[{id:'a',name:'Store'}],inventory_items:[{id:'i',internal_name:'Ingredient'}],stock_counts:[{id:'c',location_id:'a',status:'completed',completed_at:'2026-10-03T12:00:00Z'}],stock_count_lines:[{id:'l',stock_count_id:'c',inventory_item_id:'i',counted_base_quantity:8,expected_base_quantity:10}]});
 const r=buildReport('inventory',d,{start:'2026-10-03',end:'2026-10-03'},'a');assert.equal(r.rows[0].count,8);assert.equal(r.rows[0].variance,-2);
});
test('all report models render with no data, unavailable models do not fabricate metrics',()=>{
 const d=base();for(const spec of REPORTS){const r=buildReport(spec.id,d);assert.ok(r.columns.length);assert.ok(r.warnings.length);assert.equal(canViewRoute('staff',reportRoute(spec.id)),false);}
 for(const id of ['tickets','pnl'])assert.equal(buildReport(id,d).rows.length,0);
 assert.equal(buildReport('waste',d).metrics[0].value,null);
 assert.ok(buildReport('usage',d).warnings.some(w=>w.includes('both start and end')));
});
test('sorting is numeric with unknown values last and CSV escapes formulas and carries coverage',()=>{
 const d=base();d.waste=[{name:'=1+1',inventoryItemId:'i',quantity:2,estimatedCost:null},{inventoryItemId:'i',quantity:10,estimatedCost:4},{inventoryItemId:'i',quantity:1,estimatedCost:8}];
 const r=buildReport('waste',d,{sort:'cost',direction:'desc'});assert.deepEqual(r.rows.map(r=>r.cost),[8,4,null]);r.rows[0].name='=1+1';const csv=reportCsv(r);assert.match(csv,/'=1\+1/);assert.match(csv,/America\/New_York/);assert.match(csv,/Only recorded waste/);
});
test('report UI includes compatible controls and escapes untrusted report cells',()=>{
 const d=base(),s={route:'report-waste',store:'all'};d.ingredientItems[0].name='<script>unsafe</script>';d.waste=[{inventoryItemId:'i',locationId:'a',quantity:1}];
 const ui=createReportsUI({data:()=>d,local:()=>({}),state:()=>s,render:()=>{},heading:()=>'',btn:()=>'',icon:()=>'',download:()=>{}});
 assert.match(ui.page(),/&lt;script&gt;/);assert.match(ui.page(),/data-report-filter="reason"/);assert.doesNotMatch(ui.page(),/data-report-filter="supplier"/);
 s.route='report-food-cost';assert.doesNotMatch(ui.page(),/data-report-filter="start"/);assert.match(ui.catalog(),/report-pnl/);
});
test('usage and replenishment preserve supplier associations, coverage, counts and order units',()=>{
 const d=base(),units=[{id:'each',itemUnitId:'iu',name:'Each',factor:1,stocktake:true},{id:'case',itemUnitId:'case-iu',name:'Case',factor:12,ordering:true}];
 const vendor={id:'v',supplierItemId:'v',itemId:'i',supplierId:'s',supplierName:'Vendor',name:'Buns',units,stores:[{id:'a'}],orderingUnitId:'case'};
 d.supplierCatalog.items=[vendor];d.items=[{id:'i',rowId:'i-a',locationId:'a',type:'purchased',units:units.map(u=>({...u,id:u.itemUnitId}))}];
 d.purchasingSales={rows:[{date:'2026-09-20',locationId:'a',itemId:'i',baseQty:120},{date:'2026-09-13',locationId:'a',itemId:'i',baseQty:100}],days:[{date:'2026-09-20',locationId:'a',incompleteLines:0},{date:'2026-09-13',locationId:'a',incompleteLines:0}]};
 d.salesPeriods.batches=[{locationId:'a',periodStart:'2026-09-01T04:00:00Z',periodEnd:'2026-10-01T04:00:00Z'}];d.inventoryCounts={rows:[{itemId:'i',locationId:'a',baseQty:24,date:'2026-09-20',exceptions:[]}]};
 const f={start:'2026-09-20',end:'2026-09-20',supplier:'s'},local={counts:[]};
 const r=buildReport('reorder',d,f,'a',local).rows[0];assert.equal(r.current,120);assert.equal(r.stock,24);assert.equal(r.orderQty,8);assert.equal(r.orderUnit,'Case');
 d.purchasingSales.days=[];assert.equal(buildReport('usage',d,f,'a',local).rows[0].current,null);
});
