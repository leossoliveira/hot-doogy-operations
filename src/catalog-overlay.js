import { supplierItemWithEdits } from './supplier-model.js';

const commonFields=['internalName','description','categoryId','categoryName','active','trackInventory','baseUnitId','baseUnitName','stocktakeUnitId','stocktakeUnitIds','yieldPercent'];
const own=(object,key)=>Object.prototype.hasOwnProperty.call(object||{},key);
const commonPatch=shared=>Object.fromEntries(commonFields.filter(key=>own(shared,key)).map(key=>[key,structuredClone(shared[key])]));
const roleLabel=(units,role)=>units.filter(unit=>unit[role]).map(unit=>unit.name).join(' / ')||null;
const inventoryUnits=units=>units.map(unit=>({...structuredClone(unit),id:unit.itemUnitId??unit.id,unitId:unit.id}));
function sharedUnits(units,shared){
  const stocktakeIds=own(shared,'stocktakeUnitIds')?shared.stocktakeUnitIds:own(shared,'stocktakeUnitId')?(shared.stocktakeUnitId?[shared.stocktakeUnitId]:[]):null;
  return units.map(unit=>({...structuredClone(unit),...(stocktakeIds?{stocktake:stocktakeIds.includes(unit.id)}:{})}));
}

// Inventory uses item-unit association IDs, while supplier and recipe catalogs use global unit IDs.
export function inventoryWithEdits(rows,catalog,local={}){
  return rows.map(row=>{
    const shared=local.itemEdits?.[row.id],vendor=local.supplierItemEdits?.[row.supplierItemId];
    if(!shared&&!vendor)return row;
    const association=catalog?.items?.find(item=>item.supplierItemId===row.supplierItemId)
      ??catalog?.items?.find(item=>item.itemId===row.id&&item.supplierId===row.supplierId);
    const edited=association?supplierItemWithEdits(association,local):null;
    let units=edited?.units;
    if(!units&&shared?.units)units=sharedUnits(shared.units,shared);
    const result={...row,...commonPatch(shared),editedLocally:true};
    if(own(shared,'internalName'))result.name=shared.internalName??row.name;
    if(own(shared,'categoryName')&&own(row,'category'))result.category=shared.categoryName;
    if(units){
      result.units=inventoryUnits(units);
      result.orderingUom=roleLabel(units,'ordering');
      result.receivingUom=roleLabel(units,'receiving');
      result.stocktakeUom=roleLabel(units,'stocktake');
    }
    for(const field of ['sku','brand','supplierActive'])if(own(vendor,field))result[field]=vendor[field];
    if(edited){
      for(const field of ['orderingUnitId','orderingItemUnitId','receivingUnitId','receivingItemUnitId','supplierActive','supplierBusinessActive'])if(own(edited,field))result[field]=edited[field];
    }
    return result;
  });
}

export function ingredientItemsWithEdits(rows,local={}){
  return rows.map(row=>{
    const shared=local.itemEdits?.[row.id];
    if(!shared)return row;
    const result={...row,...commonPatch(shared),editedLocally:true};
    if(own(shared,'internalName'))result.name=shared.internalName??row.name;
    const originalUnits=row.units||[];
    result.units=sharedUnits(shared.units??originalUnits,shared).map(unit=>{
      const original=originalUnits.find(existing=>existing.id===unit.id);
      return {...unit,ordering:original?.ordering??false,receiving:original?.receiving??false};
    });
    result.stocktakeUom=roleLabel(result.units,'stocktake');
    if(own(shared,'baseUnitId'))result.baseUomId=shared.baseUnitId;
    return result;
  });
}

export function supplierOrderItems(catalog,inventoryRows,local={}, {locationId,supplierId}={}){
  if(!catalog?.items||!locationId||!supplierId)return [];
  const inventory=inventoryWithEdits(inventoryRows,catalog,local);
  return catalog.items.filter(item=>item.supplierId===supplierId).map(item=>supplierItemWithEdits(item,local)).flatMap(item=>{
    if(item.active===false||item.supplierActive===false||item.supplierBusinessActive===false)return [];
    if(!item.stores?.some(store=>store.id===locationId&&store.active!==false&&store.locationActive!==false))return [];
    const row=inventory.find(candidate=>candidate.id===item.itemId&&candidate.locationId===locationId&&candidate.active!==false&&candidate.locationActive!==false);
    if(!row)return [];
    const units=inventoryUnits(item.units||[]);
    return [{...row,id:item.itemId,name:item.name||item.internalName||row.name,supplierItemId:item.supplierItemId,
      supplierId:item.supplierId,supplierName:item.supplierName,sku:item.sku,brand:item.brand,
      supplierActive:item.supplierActive,supplierBusinessActive:item.supplierBusinessActive,
      orderingUnitId:item.orderingUnitId,orderingItemUnitId:item.orderingItemUnitId,
      orderingUom:roleLabel(units,'ordering'),receivingUom:roleLabel(units,'receiving'),stocktakeUom:roleLabel(units,'stocktake'),units,
      editedLocally:row.editedLocally||item.editedLocally}];
  });
}
