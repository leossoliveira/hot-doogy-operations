import {mkdir,readFile,writeFile,rename,readdir,unlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {ApiError} from './auth.mjs';
const idPattern=/^[a-f0-9-]{36}$/;
export function createInvoiceAnalysisJobs({directory=path.join(process.env.HOT_DOOGY_SESSION_DIR||path.join(os.tmpdir(),'hot-doogy-local-sessions'),'invoice-analysis'),extract,config,now=Date.now,noun='invoice'}={}){
 const active=new Map();let starting;
 const file=(id,ext)=>path.join(directory,id+ext);
 async function write(job){const temp=file(job.id,'.'+randomUUID()+'.tmp');await writeFile(temp,JSON.stringify(job),{mode:0o600});await rename(temp,file(job.id,'.json'));}
 async function read(id){if(!idPattern.test(id))throw new ApiError(404,'Draft not found.');try{return JSON.parse(await readFile(file(id,'.json'),'utf8'));}catch{throw new ApiError(404,'Draft not found.');}}
 async function records(){await mkdir(directory,{recursive:true,mode:0o700});const jobs=[];for(const name of await readdir(directory)){if(!/^[a-f0-9-]{36}\.json$/.test(name))continue;try{const j=await read(name.slice(0,-5));jobs.push(j);}catch{}}return jobs;}
 async function run(job){try{const settings=await config();const bytes=await readFile(file(job.id,'.bin'));const result=await extract(bytes,job.mime,{config:settings});Object.assign(job,result,{status:'draft',error:null});}catch(error){job.status='failed';job.error=error.status?error.message:`Analysis could not finish. Please upload the ${noun} again.`;await unlink(file(job.id,'.bin')).catch(()=>{});}finally{try{await write(job);}finally{active.delete(job.id);}}}
 function launch(job){if(active.has(job.id))return;const task=run(job).catch(()=>{});active.set(job.id,task);}
 async function initialize(){starting??=(async()=>{for(const j of await records())if(j.status==='processing')launch(j);})();await starting;}
 const summary=j=>({id:j.id,fileName:j.fileName,status:j.status,error:j.error,createdAt:j.createdAt,number:j.fields?.number||j.extraction?.invoice_number,supplierName:j.extraction?.supplier_name,locationName:j.extraction?.location_name,supplierId:j.fields?.supplierId,locationId:j.fields?.locationId,date:j.fields?.date||j.extraction?.invoice_date,dueDate:j.fields?.dueDate||j.extraction?.due_date,total:j.fields?.total??j.extraction?.total});
 async function owned(id,user){await initialize();const j=await read(id);if(j.user!==user)throw new ApiError(404,'Draft not found.');return j;}
 return {
  async create({bytes,mime,fileName,user}){await initialize();if(active.size>=4)throw new ApiError(503,`${noun} analysis is busy. Try again shortly.`);const jobs=await records();if(jobs.length>=100)throw new ApiError(503,`${noun} analysis is busy.`);if(jobs.some(j=>j.user===user&&j.status==='processing'))throw new ApiError(429,`A ${noun} is already being analyzed.`);await config();const job={id:randomUUID(),user,mime,fileName:String(fileName||'Invoice').slice(0,250),sha256:createHash('sha256').update(bytes).digest('hex'),status:'processing',createdAt:now()};await writeFile(file(job.id,'.bin'),bytes,{mode:0o600});await write(job);launch(job);return summary(job);},
  async list(user){await initialize();return (await records()).filter(j=>j.user===user).sort((a,b)=>b.createdAt-a.createdAt).map(summary);},
  async get(id,user){const j=await owned(id,user);return {...summary(j),extraction:j.extraction,fields:j.fields,analysisToken:j.id,sha256:j.sha256};},
  async analysis(id,user){const j=await owned(id,user);if(j.status!=='draft')throw new ApiError(409,`The ${noun} is not ready for review.`);return j;},
  async update(id,user,fields){if(!fields||typeof fields!=='object'||!Array.isArray(fields.items)||fields.items.length>500)throw new ApiError(422,'Invalid draft fields.');const j=await owned(id,user);if(j.status!=='draft')throw new ApiError(409,`The ${noun} is not ready for review.`);j.fields=fields;await write(j);return summary(j);},
  async source(id,user){const j=await owned(id,user);if(j.status!=='draft')throw new ApiError(409,`The ${noun} is not ready for review.`);return {bytes:await readFile(file(id,'.bin')),mime:j.mime,fileName:j.fileName};},
  async remove(id,user){const j=await owned(id,user);if(j.status==='processing')throw new ApiError(409,'Wait for analysis to finish.');await unlink(file(id,'.bin')).catch(()=>{});await unlink(file(id,'.json'));},
  async idle(){await Promise.all([...active.values()]);}
 };
}
