import {ApiError} from './auth.mjs';
import {ORGANIZATION_ID} from './supabase-config.mjs';
import {effectiveProfile,profileAllows,commandModules} from '../src/permission-profiles.js';
export async function loadProfile(auth,session){
 if(session.member.role==='owner')return effectiveProfile('owner');
 const rows=await auth.request(`/rest/v1/hr_permission_profiles?organization_id=eq.${ORGANIZATION_ID}&role=eq.${session.member.role}&select=permissions`,{token:session.token});
 return effectiveProfile(session.member.role,rows[0]?.permissions);
}
export function requireProfile(profile,module,write=false){if(!profileAllows(profile,module,write?'write':'view'))throw new ApiError(403,'Your permission profile does not allow this action.');}
export function requireProfileRequest(profile,method,path){
 const module=path.startsWith('/api/my-day')?'my-day':path.startsWith('/api/photos/recipes')?'recipes':path.startsWith('/api/photos/items')?'inventory':path.startsWith('/api/hr')?'hr':(path.startsWith('/api/invoices')||path.startsWith('/api/orders'))?'purchasing':path.startsWith('/api/transfers')?'transfers':path.startsWith('/api/doogy-ai')?'doogy-ai':path.startsWith('/api/inventory')||path.startsWith('/api/catalog')?'inventory':path.startsWith('/api/preparation')?'preparation':path==='/api/waste'||path.startsWith('/api/waste/')?'waste':null;
 if(module)requireProfile(profile,module,method!=='GET'&&path!=='/api/my-day/calendar');
}
export function requireProfileCommand(profile,body){if(body?.action!=='batch'||!Array.isArray(body?.payload?.changes))throw new ApiError(400,'Invalid command.');for(const change of body.payload.changes){const module=commandModules[change.action];if(!module)throw new ApiError(403,'Unknown profile action.');requireProfile(profile,module,true);}}
