const validNumber=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));
const normalize=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
const timestamp=value=>Date.parse(String(value??'').replace(' ','T').replace(/([+-]\d{2})$/,'$1:00'));
const countDate=count=>count.date||count.countDate||(Number.isFinite(timestamp(count.createdAt))?new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'America/New_York'}).format(timestamp(count.createdAt)):null);
function momentRank(moment){
  const label=normalize(moment);
  if(['antes da abertura','before_opening','opening'].includes(label))return 0;
  if(['durante a operacao','during_operation','during'].includes(label))return 1;
  if(['apos o fechamento','after_closing','closing'].includes(label))return 2;
  return null;
}
const warningLabels={
  mixed_count_dates:'Contagens de datas diferentes.',
  areas_without_count:'Há áreas cadastradas sem contagem concluída.',
  no_completed_count:'Ainda não há inventário concluído para este item nesta loja.',
  area_not_in_current_assignment:'A área desta contagem histórica não tem vínculo atual com o item.',
  historical_base_differs_from_current_conversion:'A conversão foi corrigida após a contagem; a quantidade original foi preservada.',
  stocktake_unit_missing:'Unidade de contagem não cadastrada.',
  multiple_stocktake_units:'Mais de uma unidade de contagem cadastrada.',
};
const warningsFor=values=>[...new Set(values||[])].map(value=>warningLabels[value]||value);
function stocktakeUnit(item){
  const units=item.units||[],selected=units.filter(unit=>unit.stocktake);
  if(selected.length===1)return selected[0];
  if(selected.length>1)return null;
  if(!item.stocktakeUom)return null;
  return units.find(unit=>[unit.name,unit.abbreviation].some(name=>name&&normalize(name)===normalize(item.stocktakeUom)))||null;
}
function convertDatabase(row,item){
  const result=structuredClone(row),unit=stocktakeUnit(item),factor=Number(unit?.factor);
  const original=result.qty;
  if(unit&&Number.isFinite(factor)&&factor>0){
    result.uom=unit.name||unit.abbreviation;
    result.qty=validNumber(result.baseQty)?Number(result.baseQty)/factor:original;
    if(validNumber(result.knownSubtotalBaseQty))result.knownSubtotal=Number(result.knownSubtotalBaseQty)/factor;
    result.areas=(result.areas||[]).map(area=>({...area,qty:validNumber(area.baseQty)?Number(area.baseQty)/factor:area.qty,uom:result.uom}));
    result.itemUnitId=unit.itemUnitId||unit.id;
    result.unitId=unit.unitId||result.unitId;
    result.unitFactor=factor;
  }
  result.date=result.date||result.countDate||null;
  result.countDate=result.date;
  result.precision=result.precision||result.countedAtPrecision||null;
  result.warnings=warningsFor(result.exceptions||result.warnings);
  result.local=false;
  return result;
}
function latestLocal(item,local){
  const rows=[];
  for(const count of local?.counts||[]){
    if(count.locationId!==item.locationId||!Array.isArray(count.lines))continue;
    for(const line of count.lines){
      if(!line||!(line.rowId?line.rowId===item.rowId:line.itemId===item.id)||!validNumber(line.qty)||Number(line.qty)<0)continue;
      const date=countDate(count);
      if(!date)continue;
      rows.push({count,line,date,rank:momentRank(count.moment)??1,createdAt:timestamp(count.createdAt)||0});
    }
  }
  rows.sort((a,b)=>b.date.localeCompare(a.date)||b.rank-a.rank||b.createdAt-a.createdAt);
  return rows[0]||null;
}
function localIsLater(candidate,database){
  if(!database?.date)return true;
  if(candidate.date!==database.date)return candidate.date>database.date;
  // An unspecified physical time cannot establish an ordering within the same day.
  if(database.precision==='date'||database.precision==='session')return false;
  const databaseRank=momentRank(database.moment)??(database.precision==='reported_time'?1:null);
  const localRank=momentRank(candidate.count.moment);
  return databaseRank!==null&&localRank!==null&&localRank>databaseRank;
}
function localResult(candidate,item){
  const {count,line,date}=candidate,unit=stocktakeUnit(item),sourceUnit=(item.units||[]).find(u=>
    (line.itemUnitId&&[u.id,u.itemUnitId].includes(line.itemUnitId))||
    (line.unitId&&[u.id,u.unitId].includes(line.unitId))||
    [u.name,u.abbreviation].some(name=>name&&normalize(name)===normalize(line.uom)));
  const capturedFactor=validNumber(line.unitFactor)?Number(line.unitFactor):Number(sourceUnit?.factor);
  const baseQty=validNumber(line.baseQty)?Number(line.baseQty):Number.isFinite(capturedFactor)&&capturedFactor>0?Number(line.qty)*capturedFactor:null;
  const targetFactor=Number(unit?.factor),canConvert=baseQty!==null&&Number.isFinite(targetFactor)&&targetFactor>0;
  return {qty:canConvert?baseQty/targetFactor:Number(line.qty),uom:canConvert?(unit.name||unit.abbreviation):line.uom||null,
    itemId:item.id,locationId:item.locationId,rowId:item.rowId,local:true,baseQty,
    baseUom:item.baseUnitName||null,countedAt:null,date,countDate:date,moment:count.moment||null,
    precision:count.moment?'moment':count.date?'date':'recorded_date',countedAtPrecision:count.moment?'moment':count.date?'date':'recorded_date',
    createdAt:count.createdAt||null,countSessionId:count.id||null,scope:'item_store_total',source:'local_stock_count',areas:[],partial:false,mixedDates:false,warnings:[],exceptions:[],
    originalQty:Number(line.qty),originalUom:line.uom||null};
}

/** Latest physical inventory, including explicit local total-item/store counts; never a movement-derived balance. */
export function latestInventoryFor(item,local={},inventoryCounts=null){
  const rows=Array.isArray(inventoryCounts)?inventoryCounts:inventoryCounts?.rows||[];
  const record=rows.find(row=>row.itemId===item.id&&row.locationId===item.locationId);
  const database=record?convertDatabase(record,item):null;
  const candidate=latestLocal(item,local);
  if(candidate&&localIsLater(candidate,database))return localResult(candidate,item);
  if(database)return database;
  return {qty:null,uom:item.stocktakeUom||null,local:false,baseQty:null,countedAt:null,date:null,countDate:null,moment:null,precision:null,scope:'no_count',areas:[],partial:false,warnings:[],exceptions:[],source:'no_completed_count'};
}
