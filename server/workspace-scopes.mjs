// Scope selects work, never permissions. readTables still intersects Staff/RLS.
export const BOOTSTRAP_TABLES=['locations'];
export const CATALOG_TABLES=['locations','suppliers','supplier_categories','inventory_categories','inventory_items','inventory_item_units','units','location_inventory_items','inventory_item_storage_areas','storage_areas','supplier_items','supplier_item_price_history','recipes','recipe_versions','recipe_components','recipe_steps','modifiers','menu_item_modifier_rules','invoices','invoice_lines'];
export function tablesForScope(scope,all){
 if(scope==='bootstrap')return BOOTSTRAP_TABLES;
 if(scope==='catalog')return CATALOG_TABLES;
 if(scope==='operations')return all.filter(table=>table!=='sales_item_facts');
 if(scope==='full')return all;
 throw Object.assign(Error('Invalid workspace scope.'),{status:400});
}
