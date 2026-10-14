import {ApiError} from './auth.mjs';
import {isStaff} from '../src/access.js';
// Supporting catalog rows serve Inventory and Recipes; purchasing documents and
// sales facts must never be loaded into a Staff response.
export const staffTables=new Set(['locations','suppliers','supplier_categories','inventory_categories','inventory_items','inventory_item_units','units','location_inventory_items','inventory_item_storage_areas','storage_areas','supplier_items','supplier_item_price_history','recipes','recipe_versions','recipe_components','recipe_steps','modifiers','menu_item_modifier_rules','internal_requests','internal_request_lines','internal_request_line_issues','interstore_transfers','interstore_transfer_lines','interstore_receipts','interstore_receipt_lines','store_count_observations','stock_counts','stock_count_lines','stock_count_line_entries','inventory_transactions','prep_batches','prep_batch_components','location_settings','menu_items','location_menu_items','pos_modifier_mappings','menu_item_prices','menu_categories']);
export function requireStaffRequest(role,method,pathname){
 if(!isStaff(role))return;
 const allowed=method==='GET'&&(pathname.startsWith('/api/my-day/calendar')||pathname==='/api/my-day'||pathname==='/api/data'||pathname==='/api/inventory/count-notes'||pathname==='/api/preparation/usage'||pathname==='/api/preparation/team-members'||pathname==='/api/photos'||/^\/api\/photos\/(items|recipes)\/[a-f0-9-]{36}$/.test(pathname));
 if(!(allowed||(method==='POST'&&['/api/command','/api/my-day/status','/api/my-day/calendar'].includes(pathname))))throw new ApiError(403,'Staff access is limited to Overview, Operations and Recipes; only inventory counts can be saved.');
}

export function requireStaffCommand(role,body){
 if(!isStaff(role))return;
 if(body?.action!=='batch'||!Array.isArray(body.payload?.changes)||body.payload.changes.length<1||body.payload.changes.length>100||body.payload.changes.some(change=>change?.action!=='counts'))throw new ApiError(403,'Staff can save inventory counts only.');
}
