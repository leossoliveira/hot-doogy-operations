import {parseLocalDateTime,toLocalDateTime} from './period-model.js';
import {latestInventoryFor} from './inventory-model.js';
export const isQuantity=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x));
export const shiftDay=(value,days)=>{const d=new Date(`${value}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);};
export const countUnit=item=>{const selected=(item.units||[]).filter(u=>u.stocktake);return selected.length===1&&Number(selected[0].factor)>0?selected[0]:null;};
export const countKey=c=>`${c?.countSessionId||c?.countSessionIds?.join(',')||''}|${c?.effectiveAt||c?.countedAt||c?.date||''}`;
export function periodWindow(start,end){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start||'')||!/^\d{4}-\d{2}-\d{2}$/.test(end||''))throw Error("Enter the start and end of the period.");
  const from=parseLocalDateTime(start+'T00:00'),to=parseLocalDateTime(shiftDay(end,1)+'T00:00');
  if(!Number.isFinite(from)||!Number.isFinite(to)||end<start)throw Error("Enter a valid period with an end on or after the start.");
  const days=Math.round((Date.parse(end)-Date.parse(start))/86400000)+1;
  if(days>366)throw Error("Select no more than 366 days.");
  const shift=Math.ceil(days/7)*7;
  return {start,end,from,to,days,previousStart:shiftDay(start,-shift),previousEnd:shiftDay(end,-shift)};
}
export function suggestedProduction(consumed,margin){return isQuantity(consumed)&&consumed>=0&&isQuantity(margin)&&margin>=0?Math.round(Number(consumed)*(1+Number(margin)/100)*1e6)/1e6:null;}
export function partialProduction(demand,count){return isQuantity(demand)&&isQuantity(count)?Math.round((Number(demand)-Number(count))*1e6)/1e6:null;}
// Historical exports record the preparer's name explicitly in the batch notes.
export function batchPreparedBy(batch){
  if(batch.preparedTeamMemberName)return batch.preparedTeamMemberName;
  if(typeof batch.preparedBy==='string'&&batch.preparedBy.trim()&&!/^[a-f0-9-]{36}$/.test(batch.preparedBy))return batch.preparedBy.trim();
  return batch.notes?.match(/\bPrepared by\s+([^.;,\n]+?)(?=\s+(?:at|overriding)\b|[.;,\n]|$)/i)?.[1]?.trim()||null;
}
export function outputRecipe(itemId,recipes){const rows=recipes.map(r=>r.activeVersionId?{...r,versionId:r.activeVersionId,status:r.activeVersionStatus}:r).filter(r=>r.type==='prep'&&r.outputItemId===itemId&&['active','published'].includes(r.status)&&r.versionId);return rows.length===1?rows[0]:null;}
export function createPreparationPlan(local,{rows,fromLocationId,toLocationId,date,referencePeriod,notes=''},items,recipes,locations,id,now){
  if(!fromLocationId||!toLocationId||fromLocationId===toLocationId)throw Error("Choose different production and destination locations.");
  if(!locations.some(l=>l.id===fromLocationId)||!locations.some(l=>l.id===toLocationId))throw Error("Invalid location.");
  periodWindow(date,date);
  const selected=rows.filter(r=>isQuantity(r.qty)&&Number(r.qty)>0);
  if(!selected.length)throw Error("Enter at least one production quantity greater than zero.");
  if(rows.some(r=>r.qty!==''&&r.qty!=null&&(!isQuantity(r.qty)||Number(r.qty)<0)))throw Error("Quantities must be numbers greater than or equal to zero.");
  if(new Set(selected.map(r=>r.itemId)).size!==selected.length)throw Error("The plan contains duplicate prep items.");
  if(local.transfers.some(t=>t.planId===id))return local;
  const next=structuredClone(local),batches=[],lines=[];
  selected.forEach((row,index)=>{
    const origin=items.find(i=>i.id===row.itemId&&i.locationId===fromLocationId&&i.active!==false&&i.locationActive!==false),destination=items.find(i=>i.id===row.itemId&&i.locationId===toLocationId&&i.active!==false&&i.locationActive!==false);
    const unit=countUnit(origin||{}),recipe=outputRecipe(row.itemId,recipes);
    const destinationUnit=countUnit(destination||{});
    if(!origin||!destination||!unit||!destinationUnit||destinationUnit.itemUnitId!==unit.itemUnitId||!recipe)throw Error("A prep item is missing an assignment at both locations, a compatible unit, or a single active recipe.");
    const batch={id:globalThis.crypto.randomUUID(),planId:id,number:`PREP-${date.replaceAll('-','')}-${id.slice(0,5).toUpperCase()}-${index+1}`,itemId:row.itemId,name:row.name||origin.internalName||origin.name,qty:Number(row.qty),uom:unit.name,unitFactor:Number(unit.factor),itemUnitId:unit.itemUnitId,recipeVersionId:recipe.versionId,locationId:fromLocationId,locationName:locations.find(l=>l.id===fromLocationId).name,date,status:'draft',local:true,createdAt:now,referencePeriod,safetyPercent:isQuantity(row.margin)?Number(row.margin):null};
    batches.push(batch);lines.push({itemId:row.itemId,name:batch.name,qty:batch.qty,uom:batch.uom,batchId:batch.id,itemUnitId:unit.itemUnitId});
  });
  next.production.unshift(...batches);
  next.transfers.unshift({id,planId:id,number:`PREP-${date.replaceAll('-','')}-${id.slice(0,5).toUpperCase()}`,local:true,status:'draft',date,createdAt:now,fromLocationId,toLocationId,fromLocationName:locations.find(l=>l.id===fromLocationId).name,toLocationName:locations.find(l=>l.id===toLocationId).name,lines,lineCount:lines.length,referencePeriod,notes:String(notes).trim(),history:[{at:now,text:"Draft created from a prep plan"}]});
  return next;
}
export function completeProduction(local,batch,actualQty,completedAt,count,now){
  if(!isQuantity(actualQty)||Number(actualQty)<=0||!Number.isFinite(Number(batch.unitFactor))||Number(batch.unitFactor)<=0)throw Error("Enter a positive production quantity and a valid conversion.");
  if(!Number.isFinite(Date.parse(completedAt))||Date.parse(completedAt)>Date.parse(now))throw Error("Completion must have a valid date and time and cannot be in the future.");
  const next=structuredClone(local),existing=next.production.find(b=>b.id===batch.id);
  if(existing?.stockEntry)return next;
  if(existing?.status==='completed')throw Error("This batch is already complete and cannot be added again.");
  const result={...batch,plannedQty:batch.qty,qty:Number(actualQty),actualQty:Number(actualQty),status:'completed',completedAt,createdAt:batch.createdAt||now,local:true,stockEntry:{id:`prep-output:${batch.id}`,itemId:batch.itemId,locationId:batch.locationId,baseQty:Number(actualQty)*Number(batch.unitFactor),occurredAt:completedAt,recordedAt:now,countKey:countKey(count)}};
  if(existing)Object.assign(existing,result);else next.production.unshift(result);
  return next;
}
export function stockWithProduction(item,local,counts,movements=[]){
  const stock=latestInventoryFor(item,local,counts),unit=countUnit(item);
  if(!unit)return {...stock,addedProduction:0};
  const exactCutoff=Date.parse(stock.countedAt||stock.effectiveAt||'');
  const cutoff=Number.isFinite(exactCutoff)?exactCutoff:stock.date?parseLocalDateTime(shiftDay(stock.date,1)+'T00:00')-1:NaN;
  const recorded=movements.filter(m=>m.type==='prep_production'&&m.itemId===item.id&&m.locationId===item.locationId).map(m=>({id:'prep-output:'+m.sourceId,baseQty:m.baseQty,occurredAt:m.occurredAt}));
  const entries=local.production.filter(b=>b.status==='completed'&&b.stockEntry&&b.itemId===item.id&&b.locationId===item.locationId).map(b=>b.stockEntry).concat(recorded);
  const base=[...new Map(entries.map(e=>[e.id,e])).values()].filter(e=>{
    if(!Number.isFinite(cutoff))return false;
    // A new batch records which count it follows; older batches are absorbed by a later count.
    if(!Number.isFinite(exactCutoff)&&e.countKey===countKey(stock)&&toLocalDateTime(e.occurredAt).slice(0,10)>=stock.date)return true;
    return Date.parse(e.occurredAt)>cutoff;
  }).reduce((s,e)=>s+Number(e.baseQty),0);
  return {...stock,physicalQty:stock.qty,qty:stock.qty==null?null:stock.qty+base/Number(unit.factor),addedProduction:base/Number(unit.factor)};
}
