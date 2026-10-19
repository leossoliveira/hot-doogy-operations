// Synthetic operational history; no production records or credentials.
export function operationsFixture(size=10){
 const raw={};const add=(table,value)=>(raw[table]??=[]).push(value);
 add('locations',{id:'location',name:'Store',active:true});
 add('storage_areas',{id:'area',location_id:'location',name:'Shelf'});
 add('units',{id:'unit',name:'Each',code:'each'});
 add('suppliers',{id:'supplier',name:'Supplier'});
 add('inventory_categories',{id:'category',name:'Food'});
 for(let i=0;i<size;i++){
  const item='item-'+i,vendor='vendor-'+i,association='iu-'+i,recipe='recipe-'+i;
  add('inventory_items',{id:item,name:'Item '+i,internal_name:'Item '+i,base_unit_id:'unit',category_id:'category',item_type:'ingredient'});
  add('inventory_item_units',{id:association,inventory_item_id:item,unit_id:'unit',quantity_in_base_unit:1,is_count_unit:true,is_base_unit:true});
  add('location_inventory_items',{id:'location-item-'+i,inventory_item_id:item,location_id:'location',default_storage_area_id:'area'});
  add('inventory_item_storage_areas',{id:'item-area-'+i,inventory_item_id:item,storage_area_id:'area'});
  add('supplier_items',{id:vendor,inventory_item_id:item,supplier_id:'supplier',supplier_product_name:'Vendor '+i,purchase_item_unit_id:association,receive_item_unit_id:association,updated_at:'2026-10-01T00:00:00Z'});
  add('recipes',{id:recipe,name:'Recipe '+i,output_inventory_item_id:item,recipe_type:'prep',production_location_id:'location'});
  for(let v=1;v<=3;v++){
   add('recipe_versions',{id:recipe+'-v'+v,recipe_id:recipe,version_number:v,status:v===2?'active':'draft',yield_item_unit_id:association,yield_quantity:1});
   add('recipe_components',{id:recipe+'-c'+v,recipe_version_id:recipe+'-v'+v,component_inventory_item_id:item,component_item_unit_id:association,quantity:1});
   add('recipe_steps',{id:recipe+'-s'+v,recipe_version_id:recipe+'-v'+v,instruction:'Step '+v});
  }
  for(let h=1;h<=10;h++){
   const day=String(h).padStart(2,'0'),at='2026-09-'+day+'T12:00:00Z',count='count-'+i+'-'+h,line=count+'-line';
   add('supplier_item_price_history',{id:vendor+'-p'+h,supplier_item_id:vendor,location_id:null,price_per_purchase_unit:h,status:'approved',effective_at:at});
   add('stock_counts',{id:count,location_id:'location',status:'completed',started_at:at,completed_at:at,created_at:at});
   add('stock_count_lines',{id:line,stock_count_id:count,inventory_item_id:item,storage_area_id:'area',counted_base_quantity:h});
   add('stock_count_line_entries',{id:line+'-entry',stock_count_line_id:line,inventory_item_unit_id:association,quantity:h});
  }
 }
 return raw;
}
