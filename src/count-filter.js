import {norm} from './model.js';
import {alphabetical} from './purchasing-model.js';

// Prepared inventory is produced internally, so supplier filters apply only to purchased items.
export function countItems(items,{locationId,areas='all',suppliers='all',includePrep=false,specific=null,query=''}={}){
 return items.filter(item=>item.active&&item.locationActive&&item.locationId===locationId
  &&(areas==='all'||areas.includes(item.areaName))
  &&(item.type==='prepared'?includePrep:(suppliers==='all'||suppliers.includes(item.supplierId)))
  &&(!specific||item.rowId===specific))
  .map(item=>item.type==='prepared'?{...item,name:item.internalName||item.name}:item)
  .filter(item=>norm(item.name+' '+(item.sku||'')).includes(norm(query)))
  .sort(alphabetical);
}
