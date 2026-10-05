// Expand prepared outputs using the active database version, never a newer draft.
// Sales locations remain the demand location; production location selects ingredients.
export function purchasingSales(source,raw){
 if(!source?.itemRows)return null;
 const items=new Map((raw.inventory_items||[]).map(i=>[i.id,i]));
 const units=new Map((raw.inventory_item_units||[]).map(u=>[u.id,u]));
 const outputs=new Map();
 for(const r of raw.recipes||[]){if(!r.active||!r.output_inventory_item_id)continue;const list=outputs.get(r.output_inventory_item_id)||[];list.push(r);outputs.set(r.output_inventory_item_id,list);}
 const rows=new Map(),warnings=new Set();
 const warn=()=>warnings.add('Some recipe ingredients could not be calculated. Review active recipes, yields, and conversions.');
 function add(row,id,qty,path=[]){
  const item=items.get(id);if(!item){warn();return;}
  if(item.item_type!=='prepared'){
   const key=[row.date,row.locationId,id].join('|'),target=rows.get(key)||{date:row.date,locationId:row.locationId,itemId:id,baseQty:0};
   target.baseQty+=qty;rows.set(key,target);return;
  }
  if(path.includes(id)||path.length>=20){warn();return;}
  const recipes=outputs.get(id)||[];if(recipes.length!==1){warn();return;}
  const recipe=recipes[0],versions=(raw.recipe_versions||[]).filter(v=>v.recipe_id===recipe.id&&v.status==='active');
  if(versions.length!==1){warn();return;}
  const version=versions[0],output=units.get(version.yield_item_unit_id),yieldBase=Number(version.yield_quantity)*Number(output?.quantity_in_base_unit);
  if(!(yieldBase>0)||!Number.isFinite(yieldBase)||output?.inventory_item_id!==id){warn();return;}
  const scope=recipe.production_location_id||row.locationId;
  const components=(raw.recipe_components||[]).filter(c=>c.recipe_version_id===version.id&&(!c.location_id||c.location_id===scope));
  if(!components.length)warn();
  for(const c of components){const unit=units.get(c.component_item_unit_id),factor=Number(unit?.quantity_in_base_unit),waste=Number(c.waste_percent??0),quantity=Number(c.quantity);
   if(unit?.inventory_item_id!==c.component_inventory_item_id||!(factor>0)||!Number.isFinite(factor)||c.quantity==null||!Number.isFinite(quantity)||quantity<0||!(waste>=0&&waste<1)){warn();continue;}
   add(row,c.component_inventory_item_id,qty/yieldBase*quantity*factor/(1-waste),[...path,id]);
  }
 }
 for(const row of source.itemRows){if(row.baseQty==null||!Number.isFinite(Number(row.baseQty))){warn();continue;}add(row,row.itemId,Number(row.baseQty));}
 return {meta:source.meta,days:source.days,rows:[...rows.values()],expansionWarnings:[...warnings],issues:source.issues};
}
