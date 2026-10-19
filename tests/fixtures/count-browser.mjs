import {projectData} from '../../server/live-data.mjs';
export function countBrowserData(){
const loc='22222222-2222-4222-8222-222222222222';
const raw={locations:[{id:loc,name:'Test location'}],units:[{id:'unit',name:'Each',code:'ea'}],inventory_items:[1,2,3].map(n=>({id:'item'+n,name:'Test item '+n,item_type:'purchased',active:true,base_unit_id:'unit'})),inventory_item_units:[1,2,3].map(n=>({id:'iu'+n,inventory_item_id:'item'+n,unit_id:'unit',is_count_unit:true,is_base_unit:true,quantity_in_base_unit:1})),location_inventory_items:[1,2,3].map(n=>({id:'row'+n,inventory_item_id:'item'+n,location_id:loc,active:true,default_storage_area_id:n<3?'freezer':'dry'})),storage_areas:[{id:'freezer',name:'Freezer',location_id:loc},{id:'dry',name:'Dry',location_id:loc}]};
return projectData(raw);
}
