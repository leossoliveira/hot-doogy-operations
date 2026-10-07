// Resolve applicability from explicit catalog links, never from sales history.
export function recipeLocations(recipe,tables){
 const ids=new Set();
 const add=id=>{if(id)ids.add(id);};
 const menuIds=new Set(tables.menu_items.filter(m=>m.active!==false&&m.recipeId===recipe.id).map(m=>m.id));
 const modifierIds=new Set(tables.modifiers.filter(m=>m.active!==false&&m.defaultRecipeId===recipe.id).map(m=>m.id));
 if(recipe.recipeType==='prep')add(recipe.productionLocationId);
 for(const rule of tables.menu_item_modifier_rules){if(rule.recipeId===recipe.id||modifierIds.has(rule.modifierId))menuIds.add(rule.menuItemId);}
 for(const link of tables.location_menu_items){if(link.active!==false&&menuIds.has(link.menuItemId))add(link.locationId);}
 for(const link of tables.pos_modifier_mappings){if(link.active!==false&&modifierIds.has(link.modifierId))add(link.locationId);}
 if(!ids.size)add(recipe.productionLocationId);
 return tables.locations.filter(l=>l.active!==false&&ids.has(l.id)).sort((a,b)=>a.name.localeCompare(b.name)).map(l=>({id:l.id,name:l.name}));
}
