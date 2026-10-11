import {inventoryCoverage,inventoryBasedCoverage} from './inventory-coverage.js';

// A store's sales cannot identify the storage area used. Always estimate a store total.
export function liveInventory(item,history,source,batches,asOf){
 const unknown=reason=>({qty:null,reason});
 const now=Date.parse(asOf),unit=(item.units||[]).find(u=>u.stocktake),factor=Number(unit?.factor);
 if(!Number.isFinite(now)||!(factor>0))return unknown('Count unit conversion unavailable');
 if(!history?.sessions||!Array.isArray(history.movements))return unknown('Inventory history unavailable');
 const expected=(item.areas||[]).filter(a=>a.locationId===item.locationId).map(a=>a.id).sort().join('|');
 const counts=history.sessions.filter(s=>s.locationId===item.locationId&&s.status==='completed').flatMap(s=>{
  const at=Date.parse(s.countedAt||''),lines=(s.lines||[]).filter(l=>l.itemId===item.id);
  if(!Number.isFinite(at)||at>now||!lines.length)return [];
  if(s.source==='observations'?lines.length!==1:!expected||lines.map(l=>l.areaId).sort().join('|')!==expected)return [];
  const values=lines.map(l=>l.quantityBase??l.baseQty);
  if(values.some(v=>v==null||!Number.isFinite(Number(v))||Number(v)<0))return [];
  return [{at,qty:values.reduce((sum,v)=>sum+Number(v),0)/factor}];
 }).sort((a,b)=>b.at-a.at);
 const count=counts[0];if(!count)return unknown('Complete dated count needed');
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
 let coverage=inventoryCoverage(item,{qty:1},source,batches,today);
 if(coverage.reason==='No calculated usage for this item')coverage=inventoryBasedCoverage(item,{qty:1},{...history,sessions:history.sessions.filter(s=>Date.parse(s.countedAt||'')<=now)});
 const daily=coverage.reason==='No consumption in this period'?0:coverage.days>0?1/coverage.days:null;
 if(daily==null)return unknown(coverage.reason||'Consumption average unavailable');
 let net=0;const seen=new Set();
 for(const m of history.movements.filter(m=>m.itemId===item.id&&m.locationId===item.locationId)){
  const at=Date.parse(m.occurredAt||'');if(!Number.isFinite(at))return unknown('Movement dates need review');
  if(at<=count.at||at>now||seen.has(m.id))continue;seen.add(m.id);
  // Average consumption replaces actual consumption postings, never subtract both.
  if(['sale_consumption','prep_consumption','stock_count_adjustment'].includes(m.type))continue;
  if(!['purchase_receipt','prep_production','transfer_in','transfer_out','waste'].includes(m.type))return unknown('Movement types need review');
  if(m.baseQty==null||!Number.isFinite(Number(m.baseQty)))return unknown('Movement quantities need review');
  net+=Number(m.baseQty)/factor;
 }
 const raw=count.qty+net-daily*(now-count.at)/86400000;
 return {daily,start:coverage.start,end:coverage.end,qty:Math.max(0,raw),uom:unit.name||unit.abbreviation,basis:coverage.basis||'sales',partial:!!coverage.partial,asOf,exhausted:raw<0};
}
