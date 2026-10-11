import test from 'node:test';
import assert from 'node:assert/strict';
import {reportChartModel,reportChart} from '../src/report-charts.js';
import {REPORTS} from '../src/reports-model.js';
const report=(id,rows=[])=>({spec:{id},rows});
test('all 18 report charts handle empty data without invented values',()=>{
 for(const r of REPORTS){const model=reportChartModel(report(r.id));assert.deepEqual(model.points,[]);const html=reportChart(report(r.id));assert.doesNotMatch(html,/NaN|Infinity/);assert.match(html,/No chartable data|Additional data required/);}
});
test('daily line charts aggregate by date and location, preserve gaps and signed values',()=>{
 const r=report('sales',[{date:'2026-09-03',location:'A',netSales:5},{date:'2026-09-01',location:'A',netSales:10},{date:'2026-09-01',location:'A',netSales:-3},{date:'2026-09-01',location:'B',netSales:null}]);
 const original=structuredClone(r);assert.deepEqual(reportChartModel(r).points.map(p=>p.value),[7,5]);assert.deepEqual(r,original);
 const html=reportChart(r);assert.match(html,/d=" M[^L]+ M/);assert.doesNotMatch(html,/NaN|Infinity/);
});
test('heatmaps combine selected locations and keep unknown cells distinct from zero',()=>{
 const c=reportChartModel(report('hours',[{weekday:'1',hour:'09',dayName:'Monday',hourLabel:'09:00',netSales:10},{weekday:'1',hour:'09',dayName:'Monday',hourLabel:'09:00',netSales:5},{weekday:'2',hour:'09',dayName:'Tuesday',hourLabel:'09:00',netSales:0},{weekday:'3',hour:'09',netSales:null}]));
 assert.deepEqual(c.points.map(p=>p.value),[15,0]);assert.equal(c.kind,'heatmap');
});
test('supplier charts preserve signed credits, exclude other currencies and incomplete totals',()=>{
 const rows=[{supplier:'A',currency:'USD',lineTotal:10},{supplier:'A',currency:'USD',lineTotal:-3},{supplier:'B',currency:'EUR',lineTotal:100},{supplier:'C',currency:'USD',lineTotal:null}];
 assert.deepEqual(reportChartModel(report('purchases',rows)).points,[{label:'A',value:7}]);
 const cash=reportChartModel(report('cash',[{currency:'USD',date:'2026-10-01',location:'A',total:10},{currency:'EUR',date:'2026-10-01',location:'A',total:100}]));assert.equal(cash.points[0].value,10);
});
test('shared supplier demand is deduplicated, replenishment ratios do not add unlike units',()=>{
 const rows=[{itemId:'i',locationId:'a',name:'Buns',location:'A',variation:20,stock:24,current:120},{itemId:'i',locationId:'a',name:'Buns',location:'A',variation:20,stock:24,current:120},{itemId:'j',locationId:'a',name:'Sauce',location:'A',variation:-10,stock:2,current:4}];
 assert.deepEqual(reportChartModel(report('usage',rows)).points.map(p=>p.value),[20,-10]);assert.deepEqual(reportChartModel(report('reorder',rows)).points.map(p=>p.value),[20,50]);
});
test('receipt and inventory ratios preserve overdelivery, zero and unknown denominators',()=>{
 const rows=[{name:'A',ordered:10,received:0},{name:'B',ordered:10,received:12},{name:'C',ordered:0,received:3},{name:'D',ordered:10,received:null}];
 assert.deepEqual(reportChartModel(report('receiving',rows)).points.map(p=>p.value),[0,120]);
 assert.deepEqual(reportChartModel(report('inventory',[{name:'A',expected:10,count:8},{name:'B',expected:0,count:2}])).points.map(p=>p.value),[-20]);
});
test('readiness is movement counts rather than an invented cost total',()=>{
 const c=reportChartModel(report('cogs',[{cost:null},{cost:0},{cost:25}]));assert.equal(c.kind,'donut');assert.deepEqual(c.points.map(p=>p.value),[2,1]);
 assert.equal(reportChartModel(report('pnl')).kind,'unavailable');
});
test('unknown high-ranked rows cannot displace valid negative values and labels are escaped',()=>{
 const rows=[...Array.from({length:12},()=>({netSales:null})),{name:'<script>bad</script>',netSales:-5}];const r=report('mix',rows);assert.equal(reportChartModel(r).points.length,1);assert.match(reportChart(r),/&lt;script&gt;/);assert.doesNotMatch(reportChart(r),/<script>/);
});
