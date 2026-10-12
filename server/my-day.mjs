import {dispatchTaskNotifications} from './my-day-whatsapp.mjs';
import {calendarAPI} from './my-day-calendar.mjs';
import {ApiError,jsonBody,reply} from './auth.mjs';
import {ORGANIZATION_ID} from './supabase-config.mjs';
import {readPages} from './paginated-read.mjs';
export async function myDayAPI(req,res,url,auth,session){
 if(url.pathname.startsWith('/api/my-day/calendar'))return calendarAPI(req,res,url,auth,session);
 const read=path=>auth.request(path,{token:session.token});
 if(url.pathname==='/api/my-day'&&req.method==='GET'){
  const org=`organization_id=eq.${ORGANIZATION_ID}`;
  const [tasks,procedures,team]=await Promise.all([
   readPages(read,`/rest/v1/my_day_tasks?select=*&${org}&order=due_date,id`),
   readPages(read,`/rest/v1/my_day_procedures?select=*&${org}&order=title,id`),
   auth.request('/rest/v1/rpc/my_day_team',{token:session.token,method:'POST',body:{}})]);
  let notifications=[];if(['owner','admin','manager','chef'].includes(session.member.role)){notifications=await auth.request('/rest/v1/rpc/my_day_whatsapp_status',{token:session.token,method:'POST',body:{}});dispatchTaskNotifications(auth,session);}return reply(res,200,{tasks,procedures,team,notifications});
 }
 if(url.pathname==='/api/my-day/series'&&req.method==='POST'){
  const b=await jsonBody(req,48000);
  if(!/^[a-f0-9-]{36}$/.test(b.id||'')||!b.payload||Array.isArray(b.payload))throw new ApiError(400,'Invalid recurring task.');
  const result=await auth.request('/rest/v1/rpc/my_day_create_series',{token:session.token,method:'POST',body:{p_id:b.id,p:b.payload}});dispatchTaskNotifications(auth,session);return reply(res,200,result);
 }
 if(['/api/my-day/save','/api/my-day/status'].includes(url.pathname)&&req.method==='POST'){
  const b=await jsonBody(req,48000),kind=url.pathname.endsWith('/status')?'status':b.kind;
  if(!['task','procedure','status'].includes(kind)||!/^[a-f0-9-]{36}$/.test(b.id||'')||!Number.isInteger(b.version)||b.version<0||!b.payload||Array.isArray(b.payload))throw new ApiError(400,'Invalid My Day record.');
  const result=await auth.request('/rest/v1/rpc/my_day_save',{token:session.token,method:'POST',body:{p_kind:kind,p_id:b.id,p_version:b.version,p:b.payload}});if(kind==='task')dispatchTaskNotifications(auth,session);return reply(res,200,result);
 }
 throw new ApiError(404,'My Day page not found.');
}
