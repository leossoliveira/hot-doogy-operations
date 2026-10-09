import {measure} from './preparation-sales.js';
import {periodWindow,shiftDay} from './preparation-model.js';

// Sales identify a store, not the storage area from which an item was taken.
export function inventoryCoverage(item,stock,source,batches,today){
 const unknown=reason=>({days:null,reason});
 if(stock.qty==null||stock.partial||!Number.isFinite(Number(stock.qty)))return unknown('Complete stock quantity unavailable');
 if(!source)return unknown('Sales usage unavailable');
 const end=(source.days||[]).filter(d=>d.locationId===item.locationId&&d.date<today).map(d=>d.date).sort().at(-1);
 if(!end)return unknown('Sales history unavailable');
 const start=shiftDay(end,-6),window=periodWindow(start,end);
 if(!(source.rows||[]).some(r=>r.itemId===item.id&&r.locationId===item.locationId&&r.date>=start&&r.date<=end))return unknown('No calculated usage for this item');
 const usage=measure(item,[item.locationId],window,source,batches);
 if(usage.qty==null||!Number.isFinite(usage.qty)||usage.qty<0)return unknown('Incomplete sales history');
 if(usage.qty===0)return unknown('No consumption in this period');
 return {days:Math.max(0,Number(stock.qty))/(usage.qty/7),start,end,partial:!!usage.partial};
}

// Preview fallback: physical depletion, including losses; never invoice quantities.
export function inventoryBasedCoverage(item,stock,history){
 const unknown=reason=>({days:null,reason});
 const unit=(item.units||[]).find(u=>u.stocktake),factor=Number(unit?.factor);
 if(stock.qty==null||stock.partial||!Number.isFinite(Number(stock.qty))||!(factor>0))return unknown('Complete stock quantity unavailable');
 if(!history?.sessions||!Array.isArray(history.movements))return unknown('Inventory history unavailable');
 const expected=(item.areas||[]).filter(a=>a.locationId===item.locationId).map(a=>a.id).sort().join('|');
 const counts=history.sessions.filter(s=>s.locationId===item.locationId&&s.status==='completed').flatMap(s=>{
  const lines=(s.lines||[]).filter(l=>l.itemId===item.id),at=Date.parse(s.countedAt||'');
  if(!lines.length||!Number.isFinite(at))return [];
  // Imported observations were item/store totals; legacy counts must cover all assigned areas.
  if(s.source==='observations'&&lines.length!==1)return [];
  if(s.source!=='observations'&&(!expected||lines.map(l=>l.areaId).sort().join('|')!==expected))return [];
  const values=lines.map(l=>l.quantityBase??l.baseQty);
  if(values.some(v=>v==null||!Number.isFinite(Number(v))||Number(v)<0))return [];
  return [{at,total:values.reduce((n,v)=>n+Number(v),0),id:s.id}];
 }).sort((a,b)=>b.at-a.at);
 const latest=counts[0],prior=counts.find(c=>latest&&latest.at-c.at>=86400000);
 if(!prior)return unknown('Two comparable counts needed');
 let net=0;
 const seen=new Set();
 for(const m of history.movements.filter(m=>m.itemId===item.id&&m.locationId===item.locationId)){
  const at=Date.parse(m.occurredAt||'');if(!Number.isFinite(at))return unknown('Movement dates need review');
  if(at<=prior.at||at>latest.at||seen.has(m.id))continue;seen.add(m.id);
  if(['sale_consumption','waste','prep_consumption','stock_count_adjustment'].includes(m.type))continue;
  if(!['purchase_receipt','prep_production','transfer_in','transfer_out'].includes(m.type))return unknown('Movement types need review');
  if(m.baseQty==null||!Number.isFinite(Number(m.baseQty)))return unknown('Movement quantities need review');
  net+=Number(m.baseQty);
 }
 const elapsed=(latest.at-prior.at)/86400000,used=prior.total+net-latest.total;
 if(used<=0)return unknown('No measurable depletion between counts');
 return {days:Number(stock.qty)*factor/(used/elapsed),basis:'inventory',partial:true,start:new Date(prior.at).toISOString().slice(0,10),end:new Date(latest.at).toISOString().slice(0,10)};
}
