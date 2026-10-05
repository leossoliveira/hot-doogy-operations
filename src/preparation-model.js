import {parseLocalDateTime,toLocalDateTime} from './period-model.js';
import {latestInventoryFor} from './inventory-model.js';
export const isQuantity=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x));
export const shiftDay=(value,days)=>{const d=new Date(`${value}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);};
export const countUnit=item=>{const selected=(item.units||[]).filter(u=>u.stocktake);return selected.length===1&&Number(selected[0].factor)>0?selected[0]:null;};
export const countKey=c=>`${c?.countSessionId||c?.countSessionIds?.join(',')||''}|${c?.effectiveAt||c?.countedAt||c?.date||''}`;
export function periodWindow(start,end){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start||'')||!/^\d{4}-\d{2}-\d{2}$/.test(end||''))throw Error('Informe o início e o fim do período.');
  const from=parseLocalDateTime(start+'T00:00'),to=parseLocalDateTime(shiftDay(end,1)+'T00:00');
  if(!Number.isFinite(from)||!Number.isFinite(to)||end<start)throw Error('Informe um período válido, com fim igual ou posterior ao início.');
  const days=Math.round((Date.parse(end)-Date.parse(start))/86400000)+1;
  if(days>366)throw Error('Selecione no máximo 366 dias.');
  const shift=Math.ceil(days/7)*7;
  return {start,end,from,to,days,previousStart:shiftDay(start,-shift),previousEnd:shiftDay(end,-shift)};
}
export function suggestedProduction(consumed,margin){return isQuantity(consumed)&&consumed>=0&&isQuantity(margin)&&margin>=0?Math.round(Number(consumed)*(1+Number(margin)/100)*1e6)/1e6:null;}
export function partialProduction(demand,count){return isQuantity(demand)&&isQuantity(count)?Math.round((Number(demand)-Number(count))*1e6)/1e6:null;}
// Historical exports record the preparer's name explicitly in the batch notes.
export function batchPreparedBy(batch){
  if(typeof batch.preparedBy==='string'&&batch.preparedBy.trim())return batch.preparedBy.trim();
  return batch.notes?.match(/\bPrepared by\s+([^.;,\n]+?)(?=\s+(?:at|overriding)\b|[.;,\n]|$)/i)?.[1]?.trim()||null;
}
export function outputRecipe(itemId,recipes){const rows=recipes.map(r=>r.activeVersionId?{...r,versionId:r.activeVersionId,status:r.activeVersionStatus}:r).filter(r=>r.type==='prep'&&r.outputItemId===itemId&&['active','published'].includes(r.status)&&r.versionId);return rows.length===1?rows[0]:null;}
export function createPreparationPlan(local,{rows,fromLocationId,toLocationId,date,referencePeriod},items,recipes,locations,id,now){
  if(!fromLocationId||!toLocationId||fromLocationId===toLocationId)throw Error('Escolha lojas diferentes para produção e destino.');
  if(!locations.some(l=>l.id===fromLocationId)||!locations.some(l=>l.id===toLocationId))throw Error('Loja inválida.');
  periodWindow(date,date);
  const selected=rows.filter(r=>isQuantity(r.qty)&&Number(r.qty)>0);
  if(!selected.length)throw Error('Informe ao menos uma quantidade a produzir maior que zero.');
  if(rows.some(r=>r.qty!==''&&r.qty!=null&&(!isQuantity(r.qty)||Number(r.qty)<0)))throw Error('As quantidades devem ser números iguais ou maiores que zero.');
  if(new Set(selected.map(r=>r.itemId)).size!==selected.length)throw Error('Há preparações duplicadas no planejamento.');
  if(local.transfers.some(t=>t.planId===id))return local;
  const next=structuredClone(local),batches=[],lines=[];
  selected.forEach((row,index)=>{
    const origin=items.find(i=>i.id===row.itemId&&i.locationId===fromLocationId&&i.active!==false&&i.locationActive!==false),destination=items.find(i=>i.id===row.itemId&&i.locationId===toLocationId&&i.active!==false&&i.locationActive!==false);
    const unit=countUnit(origin||{}),recipe=outputRecipe(row.itemId,recipes);
    const destinationUnit=countUnit(destination||{});
    if(!origin||!destination||!unit||!destinationUnit||destinationUnit.itemUnitId!==unit.itemUnitId||!recipe)throw Error('Uma preparação não possui vínculo nas duas lojas, unidade compatível ou receita ativa única.');
    const batch={id:globalThis.crypto.randomUUID(),planId:id,number:`PREP-${date.replaceAll('-','')}-${id.slice(0,5).toUpperCase()}-${index+1}`,itemId:row.itemId,name:row.name||origin.internalName||origin.name,qty:Number(row.qty),uom:unit.name,unitFactor:Number(unit.factor),itemUnitId:unit.itemUnitId,recipeVersionId:recipe.versionId,locationId:fromLocationId,locationName:locations.find(l=>l.id===fromLocationId).name,date,status:'draft',local:true,createdAt:now,referencePeriod,safetyPercent:isQuantity(row.margin)?Number(row.margin):null};
    batches.push(batch);lines.push({itemId:row.itemId,name:batch.name,qty:batch.qty,uom:batch.uom,batchId:batch.id,itemUnitId:unit.itemUnitId});
  });
  next.production.unshift(...batches);
  next.transfers.unshift({id,planId:id,number:`PREP-${date.replaceAll('-','')}-${id.slice(0,5).toUpperCase()}`,local:true,status:'draft',date,createdAt:now,fromLocationId,toLocationId,fromLocationName:locations.find(l=>l.id===fromLocationId).name,toLocationName:locations.find(l=>l.id===toLocationId).name,lines,lineCount:lines.length,referencePeriod,notes:'Transferência gerada pelo planejamento de preparação. Quantidades definidas manualmente; aguardando produção e aprovação.',history:[{at:now,text:'Rascunho criado pelo planejamento de preparação'}]});
  return next;
}
export function completeProduction(local,batch,actualQty,completedAt,count,now){
  if(!isQuantity(actualQty)||Number(actualQty)<=0||!Number.isFinite(Number(batch.unitFactor))||Number(batch.unitFactor)<=0)throw Error('Informe quantidade produzida positiva e conversão válida.');
  if(!Number.isFinite(Date.parse(completedAt))||Date.parse(completedAt)>Date.parse(now))throw Error('A conclusão deve ter data e hora válidas, sem estar no futuro.');
  const next=structuredClone(local),existing=next.production.find(b=>b.id===batch.id);
  if(existing?.stockEntry)return next;
  if(existing?.status==='completed')throw Error('Lote já concluído. Não é possível adicionar novamente.');
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
