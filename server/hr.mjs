import {ApiError,jsonBody,reply} from './auth.mjs';
import {ORGANIZATION_ID} from './supabase-config.mjs';
import {readPages} from './paginated-read.mjs';
export async function hrAPI(req,res,url,auth,session){
 if(!['owner','admin'].includes(session.member.role))throw new ApiError(403,'HR is available to administrators only.');
 const read=path=>auth.request(path,{token:session.token});
 if(url.pathname==='/api/hr'&&req.method==='GET'){
  const org=`organization_id=eq.${ORGANIZATION_ID}`;
  const [team,workdays,accounts]=await Promise.all([
   readPages(read,`/rest/v1/hr_team_members?select=*&${org}&order=last_name,id`),
   readPages(read,`/rest/v1/hr_workdays?select=*&${org}&order=work_date.desc,id`),
   auth.request('/rest/v1/rpc/hr_user_directory',{token:session.token,method:'POST',body:{}})]);
  return reply(res,200,{team,workdays,accounts});
 }
 if(url.pathname==='/api/hr/import-users'&&req.method==='POST')return reply(res,200,await auth.request('/rest/v1/rpc/hr_import_users',{token:session.token,method:'POST',body:{}}));
 if(url.pathname==='/api/hr/save'&&req.method==='POST'){
  const b=await jsonBody(req,16384);
  if(!['team','workday','access'].includes(b.kind)||!/^[a-f0-9-]{36}$/.test(b.id||'')||!Number.isInteger(b.version)||b.version<0||!b.payload||Array.isArray(b.payload))throw new ApiError(400,'Invalid HR record.');
  return reply(res,200,await auth.request('/rest/v1/rpc/hr_save',{token:session.token,method:'POST',body:{p_kind:b.kind,p_id:b.id,p_version:b.version,p:b.payload}}));
 }
 throw new ApiError(404,'HR page not found.');
}
