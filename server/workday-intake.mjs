import path from 'node:path';
import os from 'node:os';
import {ApiError,jsonBody,reply} from './auth.mjs';
import {createInvoiceAnalysisJobs} from './invoice-analysis-jobs.mjs';
import {extractOpenClawWorkday} from './openclaw-workday.mjs';
import {openClawInvoiceConfig} from './openclaw-invoice.mjs';
export function createWorkdayIntake({extract=extractOpenClawWorkday,config=openClawInvoiceConfig,directory=path.join(process.env.HOT_DOOGY_SESSION_DIR||path.join(os.tmpdir(),'hot-doogy-local-sessions'),'workday-analysis')}={}){
 const jobs=createInvoiceAnalysisJobs({extract,config,directory,noun:'hours report'});
 return async(req,res,url,auth,session)=>{
  if(!['owner','admin'].includes(session.member.role))throw new ApiError(403,'Administrator access required.');
  const user=session.user.id;
  if(url.pathname==='/api/hr/imports'&&req.method==='GET')return reply(res,200,await jobs.list(user));
  if(url.pathname==='/api/hr/imports'&&req.method==='POST'){
   const mime=req.headers['content-type'];if(!['application/pdf','image/png','image/jpeg','image/webp','text/csv'].includes(mime))throw new ApiError(415,'Choose a PDF, image or CSV.');
   let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>5242880)throw new ApiError(413,'File exceeds 5 MB.');chunks.push(c);}if(!size)throw new ApiError(400,'Empty report.');
   return reply(res,202,await jobs.create({bytes:Buffer.concat(chunks),mime,fileName:decodeURIComponent(req.headers['x-file-name']||'Hours report'),user}));
  }
  const match=url.pathname.match(/^\/api\/hr\/imports\/([a-f0-9-]{36})(\/source|\/confirm)?$/);if(!match)throw new ApiError(404,'Import not found.');const id=match[1];
  if(match[2]==='/source'&&req.method==='GET'){const source=await jobs.source(id,user);res.writeHead(200,{'Content-Type':source.mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(source.bytes);}
  if(match[2]==='/confirm'&&req.method==='POST'){
   const body=await jsonBody(req,512*1024),job=await jobs.analysis(id,user);
   if(body.confirmed!==true||!Array.isArray(body.rows)||!body.rows.length||body.rows.length>500)throw new ApiError(422,'Review the report before importing.');
   const result=await auth.request('/rest/v1/rpc/hr_import_workdays',{token:session.token,method:'POST',body:{p_source:job.sha256,p_rows:body.rows}});
   await jobs.remove(id,user);return reply(res,200,result);
  }
  if(!match[2]&&req.method==='GET')return reply(res,200,await jobs.get(id,user));
  if(!match[2]&&req.method==='DELETE'){await jobs.remove(id,user);return reply(res,200,{ok:true});}
  throw new ApiError(404,'Import not found.');
 };
}
export const workdayIntake=createWorkdayIntake();
