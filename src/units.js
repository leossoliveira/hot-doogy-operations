// Unit order is a display preference. Stored units and item-specific factors stay authoritative.
const normalize=value=>String(value??'').trim().toLowerCase();
const us=new Set(['oz','ounce','lb','pound','floz','fl oz','fluid ounce','cup','pt','pint','qt','quart','gal','gallon','tbsp','tablespoon','tsp','teaspoon']);
const metric=new Set(['g','gram','kg','kilogram','ml','milliliter','l','liter']);
export function measurementSystem(unit){
  if(['package','count'].includes(unit?.kind))return 'other';
  const names=[unit?.code,unit?.abbreviation,unit?.name].map(normalize);
  // A packaged cup and diluted beverage ounce are distinct catalog units.
  if(names.some(x=>x==='cup_package'||x==='floz_diluted'||x.includes('diluted')))return 'other';
  if(names.some(x=>us.has(x)))return 'us';
  if(names.some(x=>metric.has(x)))return 'metric';
  return 'other';
}
export function prioritizeUnits(units=[]){
  const rank={us:0,other:1,metric:2};
  return [...units].sort((a,b)=>rank[measurementSystem(a)]-rank[measurementSystem(b)]);
}
export const validUnit=unit=>Number.isFinite(Number(unit?.factor))&&Number(unit.factor)>0;
export function preferredUnit(units=[],current){
  const valid=units.filter(validUnit),fallback=(validUnit(current)?current:null)||valid.find(u=>u.base)||valid[0];
  if(!fallback||measurementSystem(fallback)!=='metric')return fallback;
  return valid.find(u=>measurementSystem(u)==='us'&&(!fallback.kind||!u.kind||u.kind===fallback.kind))||fallback;
}
export function convertQuantity(quantity,from,to){
  if(!['number','string'].includes(typeof quantity)||String(quantity).trim()===''||!Number.isFinite(Number(quantity))||!validUnit(from)||!validUnit(to))return null;
  const converted=Number(quantity)*Number(from.factor)/Number(to.factor);
  return Number.isFinite(converted)?converted:null;
}
export function countEntry(item,quantity,unitId){
  const source=(item.units||[]).find(u=>(u.itemUnitId||u.id)===unitId);
  // The database accepts only registered count units. Convert the entered unit to that unit.
  const target=(item.units||[]).find(u=>u.stocktake&&validUnit(u));
  const qty=convertQuantity(quantity,source,target);
  if(qty===null||qty<0)throw Error('Enter a valid count using a saved unit with a conversion.');
  return {rowId:item.rowId,itemId:item.id,name:item.name,locationId:item.locationId,
    qty,uom:target.name||target.abbreviation,itemUnitId:target.itemUnitId||target.id,
    unitId:target.unitId||target.id,unitFactor:Number(target.factor),baseQty:qty*Number(target.factor)};
}
