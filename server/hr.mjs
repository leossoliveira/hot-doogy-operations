import {ApiError,jsonBody,reply} from './auth.mjs';
import {ORGANIZATION_ID} from './supabase-config.mjs';
import {readPages} from './paginated-read.mjs';
export async function hrAPI(req,res,url,auth,session){
 if(!['owner','admin'].includes(session.member.role))throw new ApiError(403,'HR is available to administrators only.');
 const read=path=>auth.request(path,{token:session.token});
 if(url.pathname==='/api/hr'&&req.method==='GET'){
  const org=`organization_id=eq.${ORGANIZATION_ID}`;
  const [team,workdays,accounts,profiles]=await Promise.all([
   readPages(read,`/rest/v1/hr_team_members?select=*&${org}&order=last_name,id`),
   readPages(read,`/rest/v1/hr_workdays?select=*&${org}&order=work_date.desc,id`),
   readPages(read,`/rest/v1/organization_members?select=id,user_id,role,status&${org}&order=id`),
   readPages(read,'/rest/v1/profiles?select=id,full_name&order=id')]);
  return reply(res,200,{team,workdays,accounts:accounts.map(a=>({...a,name:profiles.find(p=>p.id===a.user_id)?.full_name||`Account ${a.id.slice(0,8)}`}))});
 }
 if(url.pathname==='/api/hr/save'&&req.method==='POST'){
  const b=await jsonBody(req,16384);
  if(!['team','workday','access'].includes(b.kind)||!/^[a-f0-9-]{36}$/.test(b.id||'')||!Number.isInteger(b.version)||b.version<0||!b.payload||Array.isArray(b.payload))throw new ApiError(400,'Invalid HR record.');
  return reply(res,200,await auth.request('/rest/v1/rpc/hr_save',{token:session.token,method:'POST',body:{p_kind:b.kind,p_id:b.id,p_version:b.version,p:b.payload}}));
 }
 throw new ApiError(404,'HR page not found.');
}
