import {countUnit,periodWindow,shiftDay,isQuantity} from './preparation-model.js';
import {parseLocalDateTime} from './period-model.js';

// Demand is derived exclusively from sold quantities and registered recipe mappings.
// Preparations used inside another preparation are included without subtracting stock.
export function expandPreparationSales(source,recipes){
  if(!source)return null;
  const outputs=new Map();
  for(const r of recipes.filter(r=>r.type==='prep'&&r.status==='active'&&r.outputItemId)){
    const list=outputs.get(r.outputItemId)||[];list.push(r);outputs.set(r.outputItemId,list);
  }
  const result=new Map(),warnings=new Set();
  function add(row,itemId,baseQty,path=[]){
    const key=`${row.date}|${row.locationId}|${itemId}`;
    const target=result.get(key)||{date:row.date,locationId:row.locationId,itemId,baseQty:0};
    target.baseQty+=baseQty;result.set(key,target);
    if(path.includes(itemId)){warnings.add("Circular sub-recipe reference; partial breakdown.");return;}
    const choices=outputs.get(itemId)||[];
    if(choices.length!==1){warnings.add("Sub-recipe does not have a single active recipe; partial breakdown.");return;}
    const r=choices[0],scope=r.productionLocationId||row.locationId;
    const children=(r.components||[]).filter(c=>c.itemType==='prepared'&&(!c.locationId||c.locationId===scope));
    if(!children.length)return;
    const yieldBase=Number(r.yieldQuantity)*Number(r.yieldUnitFactor);
    if(!(yieldBase>0)){warnings.add("Sub-recipe yield is missing; partial breakdown.");return;}
    for(const c of children){
      if(!isQuantity(c.quantity)||!(Number(c.unitFactor)>0)||!(Number(c.wastePercent??0)>=0&&Number(c.wastePercent??0)<1)){
        warnings.add("Sub-recipe conversion is missing; partial breakdown.");continue;
      }
      if(path.includes(c.itemId)||c.itemId===itemId){warnings.add("Circular sub-recipe reference; partial breakdown.");continue;}
      add(row,c.itemId,baseQty/yieldBase*Number(c.quantity)*Number(c.unitFactor)/(1-Number(c.wastePercent||0)),[...path,itemId]);
    }
  }
  const seen=new Set();
  for(const row of source.rows||[]){const key=`${row.date}|${row.locationId}|${row.itemId}`;if(seen.has(key))continue;seen.add(key);if(isQuantity(row.baseQty))add(row,row.itemId,Number(row.baseQty));}
  return {...source,rows:[...result.values()],expansionWarnings:[...warnings]};
}
function covers(intervals,from,to){let cursor=from;for(const [a,b] of intervals.sort((a,b)=>a[0]-b[0])){if(a>cursor)return false;cursor=Math.max(cursor,b);if(cursor>=to)return true;}return false;}
export function measure(item,locations,window,source,batches){
  if(!source)return {qty:null,reason:"Sales usage calculation is unavailable.",partial:false};
  const unit=countUnit(item);if(!unit)return {qty:null,reason:"Count unit conversion needs review.",partial:false};
  let base=0,incompleteLines=0;
  for(const loc of locations){
    const intervals=batches.filter(b=>b.locationId===loc).map(b=>[Date.parse(b.periodStart),Date.parse(b.periodEnd)]);
    const evaluated=source.days.filter(d=>d.locationId===loc).map(d=>[parseLocalDateTime(d.date+'T00:00'),parseLocalDateTime(shiftDay(d.date,1)+'T00:00')]);
    if(!covers(intervals,window.from,window.to)||!covers(evaluated,window.from,window.to))return {qty:null,reason:"Calculated sales do not cover the full period.",partial:false};
    incompleteLines+=source.days.filter(d=>d.locationId===loc&&d.date>=window.start&&d.date<=window.end).reduce((s,d)=>s+Number(d.incompleteLines||0),0);
    base+=source.rows.filter(r=>r.locationId===loc&&r.itemId===item.id&&r.date>=window.start&&r.date<=window.end).reduce((s,r)=>s+Number(r.baseQty),0);
  }
  const partial=incompleteLines>0||source.expansionWarnings?.length>0;
  return {qty:base/Number(unit.factor),partial,incompleteLines,reason:null};
}
export function salesConsumptionRows(items,source,batches,{start,end,locationId='all',itemId='all'}){
  const window=periodWindow(start,end),previous=periodWindow(window.previousStart,window.previousEnd);
  const selected=items.filter(i=>i.type==='prepared'&&i.active!==false&&i.locationActive!==false&&(locationId==='all'||i.locationId===locationId)&&(itemId==='all'||(Array.isArray(itemId)?itemId.includes(i.id):i.id===itemId)));
  return [...new Map(selected.map(i=>[i.id,i])).values()].map(item=>{
    const locations=[...new Set(selected.filter(i=>i.id===item.id).map(i=>i.locationId))];
    const current=measure(item,locations,window,source,batches),prior=measure(item,locations,previous,source,batches);
    const variation=current.qty!=null&&prior.qty>0&&current.qty>=0?(current.qty-prior.qty)/prior.qty*100:null;
    return {itemId:item.id,name:item.internalName||item.name,uom:countUnit(item)?.name||item.stocktakeUom||'—',current:current.qty,previous:prior.qty,variation,safetyPercent:variation==null?null:Math.ceil(Math.abs(variation)-1e-9),reason:current.reason,previousReason:prior.reason,partial:current.partial||prior.partial,incompleteLines:current.incompleteLines||0,previousIncompleteLines:prior.incompleteLines||0,window};
  }).sort((a,b)=>a.name.localeCompare(b.name));
}
