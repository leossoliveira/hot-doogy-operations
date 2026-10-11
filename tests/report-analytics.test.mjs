import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReport} from '../src/reports-model.js';
import {withSalesComparison,temporalPoints,paretoModel,costScatterModel,referenceModel,reportAnalytics} from '../src/report-analytics.js';
import {reportChart} from '../src/report-charts.js';
const report=(id,rows,filters={})=>({spec:{id},rows,filters});
const data=()=>({locations:[{id:'a',name:'Store A'}],costInputs:{menus:[]},salesPeriods:{meta:{precision:'transaction'},facts:Array.from({length:4},(_,i)=>({locationId:'a',menuItemId:'m',date:`2026-10-0${i+1}`,occurredAt:`2026-10-0${i+1}T16:00:00Z`,netSales:(i+1)*10,quantity:i+1,grossSales:(i+1)*12,discounts:-(i+1)*2})),batches:[{locationId:'a',periodStart:'2026-10-01T04:00:00Z',periodEnd:'2026-10-05T04:00:00Z'}]}});
test('comparison aligns prior calendar dates and only reports growth with complete imports and rows',()=>{
 const d=data(),f={start:'2026-10-03',end:'2026-10-04',chartCompare:'previous'};
 const r=withSalesComparison(buildReport('sales',d,f,'a'),d,{});assert.equal(r.comparison.currentTotal,70);assert.equal(r.comparison.previousTotal,30);assert.equal(r.comparison.previousStart,'2026-10-01');assert.equal(r.comparison.rows[0].date,'2026-10-03');assert.ok(Math.abs(r.comparison.change-133.3333333)<.001);
 assert.equal(temporalPoints(r).filter(p=>p.previous).length,2);
 d.salesPeriods.batches=[];assert.equal(withSalesComparison(buildReport('sales',d,f,'a'),d,{}).comparison.change,null);
 d.salesPeriods.facts.shift();assert.equal(withSalesComparison(buildReport('sales',d,f,'a'),d,{}).comparison.change,null);
});
test('comparison preserves calendar boundaries across daylight saving and unknown amounts',()=>{
 const d=data();d.salesPeriods.facts=d.salesPeriods.facts.map((r,i)=>({...r,date:`2026-11-0${i+1}`,occurredAt:`2026-11-0${i+1}T17:00:00Z`}));
 const f={start:'2026-11-02',end:'2026-11-03',chartCompare:'previous'};const r=withSalesComparison(buildReport('sales',d,f,'a'),d,{});
 assert.equal(r.comparison.previousStart,'2026-10-31');assert.equal(r.comparison.previousEnd,'2026-11-01');assert.equal(r.comparison.change,null);
 d.salesPeriods.facts[1].netSales=null;assert.equal(withSalesComparison(buildReport('sales',d,f,'a'),d,{}).comparison.currentTotal,null);
});
test('weekly totals start Monday, use selected metric and omit unknown groups without inventing zero',()=>{
 const r=report('sales',[{date:'2026-10-04',location:'A',quantity:2},{date:'2026-10-05',location:'A',quantity:3},{date:'2026-10-06',location:'A',quantity:4},{date:'2026-10-05',location:'B',quantity:null}],{metric:'quantity',chartInterval:'week'});
 assert.deepEqual(temporalPoints(r).map(p=>[p.date,p.value]),[['2026-09-28',2],['2026-10-05',7]]);
 const html=reportChart(r);assert.match(html,/7 items/);assert.doesNotMatch(html,/NaN|Infinity/);
});
test('Pareto shares use the complete population, not only the displayed top items',()=>{
 const c=paretoModel([{name:'A',netSales:60},{name:'B',netSales:30},{name:'C',netSales:10}],'netSales',2);
 assert.equal(c.total,100);assert.equal(c.points.at(-1).cumulative,90);
 assert.equal(paretoModel([{name:'A',netSales:-1}]).valid,false);
 assert.equal(paretoModel([{name:'A',netSales:10},{name:'B',netSales:null}]).valid,false);
});
test('recipe matrix uses the worst known store per item and contribution dollars, excluding unavailable prices',()=>{
 const rows=[{itemId:'a',name:'Dog',price:10,cost:2,foodCost:20},{itemId:'a',name:'Dog',price:10,cost:3,foodCost:30},{itemId:'b',price:null,cost:2,foodCost:20}];
 assert.deepEqual(costScatterModel(rows),[{label:'Dog',x:10,y:3,margin:7,percent:30}]);
});
test('reference charts retain original units, rank gaps and do not combine quantities',()=>{
 const c=referenceModel(report('inventory',[{name:'A',count:20,expected:10,unit:'lb'},{name:'B',count:0,expected:4,unit:'each'},{name:'C',count:2,expected:0},{name:'D',count:null,expected:2}]));
 assert.deepEqual(c.points.map(p=>p.ratio),[200,0]);assert.deepEqual(c.points.map(p=>p.unit),['lb','each']);
 assert.equal(referenceModel(report('usage',[{itemId:'a',locationId:'b',current:2,previous:1},{itemId:'a',locationId:'b',current:2,previous:1}])).points.length,1);
});
test('analytics escape labels and suppress fake charts when values are unavailable',()=>{
 const html=reportAnalytics(report('mix',[{name:'<script>alert(1)</script>',netSales:10}]));assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);
 assert.equal(reportAnalytics(report('food-cost',[])),'');
});
