import {readCalculationPage} from './read-budget.mjs';
import {ApiError,reply} from './auth.mjs';
import {periodWindow} from '../src/preparation-model.js';
export async function calculatePreparationUsage(auth,session,{start,end,location}){
 const rows=new Map(),days=new Map();
 for(let offset=0,pageSize=25;;){
  const {value:part,limit}=await readCalculationPage(size=>auth.request('/rest/v1/rpc/preparation_usage_period',{token:session.token,method:'POST',body:{p_start:start,p_end:end,p_location:location==='all'?null:location,p_offset:offset,p_limit:size}}),pageSize);
  if(!Number.isInteger(part.meta?.processed)||part.meta.processed<0||part.meta.processed>limit)throw Error('Incomplete sales response.');
  for(const r of part.rows){const key=[r.date,r.locationId,r.itemId].join('|'),old=rows.get(key);if(old)old.baseQty+=Number(r.baseQty);else rows.set(key,{...r,baseQty:Number(r.baseQty)});}
  for(const d of part.days){const key=[d.date,d.locationId].join('|'),old=days.get(key);if(old){old.totalLines+=d.totalLines;old.incompleteLines+=d.incompleteLines;}else days.set(key,{...d});}
  if(part.meta.processed<limit)break;offset+=limit;pageSize=limit;
 }
 return {meta:{source:'Sales and registered recipes',extractedAt:new Date().toISOString()},rows:[...rows.values()],days:[...days.values()]};
}
export function queuePreparationUsage(auth,session,range,{calculate=calculatePreparationUsage,now=Date.now}={}){
 const key=JSON.stringify(range);session.prepUsageJobs??=new Map();
 let job=session.prepUsageJobs.get(key);
 if(job&&(job.status==='loading'||now()-job.at<300000))return {status:job.status,result:job.result};
 for(const [k,v] of session.prepUsageJobs)if(v.status!=='loading')session.prepUsageJobs.delete(k);
 if(session.prepUsageJobs.size>=3)throw new ApiError(429,'A usage calculation is still running. Try again shortly.');
 job={status:'loading',at:now()};session.prepUsageJobs.set(key,job);
 job.promise=Promise.resolve().then(()=>calculate(auth,session,range)).then(result=>{job.result=result;job.status='ready';}).catch(error=>{job.status='error';job.at=now()-(error.databaseCode==='57014'?0:285000);});
 return {status:'loading'};
}
export function preparationUsage(req,res,url,auth,session){
 if(req.method!=='GET')throw new ApiError(405,'Method not allowed.');
 if(!['owner','admin','manager','chef','staff'].includes(session.member?.role))throw new ApiError(403,'Prep access denied.');
 const start=url.searchParams.get('start'),end=url.searchParams.get('end'),location=url.searchParams.get('location')||'all';
 try{periodWindow(start,start);periodWindow(end,end);const days=(Date.parse(end)-Date.parse(start))/86400000;if(days<0||days>737)throw Error();}catch{throw new ApiError(400,'Choose a valid date range of up to two years.');}
 if(location!=='all'&&!/^[a-f0-9-]{36}$/.test(location))throw new ApiError(400,'Choose a valid location.');
 reply(res,200,queuePreparationUsage(auth,session,{start,end,location}));
}
