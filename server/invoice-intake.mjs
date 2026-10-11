import {createInvoiceAnalysisJobs} from './invoice-analysis-jobs.mjs';
import {ApiError,jsonBody,reply} from './auth.mjs';
import {extractOpenClawInvoice,openClawInvoiceConfig} from './openclaw-invoice.mjs';
export function createInvoiceIntake({extract=extractOpenClawInvoice,config=openClawInvoiceConfig,now=Date.now,jobsDirectory}={}){
 const jobs=createInvoiceAnalysisJobs({extract,config,now,directory:jobsDirectory});
 const busy=new Set(),last=new Map();
 return async(req,res,url,auth,session)=>{
  if(!['owner','admin','manager'].includes(session.member?.role))throw new ApiError(403,'You do not have permission to manage invoices.');
  const user=session.user.id;
  if(url.pathname==='/api/invoices/analysis-jobs'&&req.method==='GET')return reply(res,200,await jobs.list(user));
  const jobMatch=url.pathname.match(/^\/api\/invoices\/analysis-jobs\/([a-f0-9-]{36})(\/source)?$/);
  if(jobMatch){const id=jobMatch[1];
   if(jobMatch[2]&&req.method==='GET'){const source=await jobs.source(id,user);res.writeHead(200,{'Content-Type':source.mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(source.bytes);}
   if(req.method==='GET')return reply(res,200,await jobs.get(id,user));
   if(req.method==='POST'){const body=await jsonBody(req,512*1024);return reply(res,200,await jobs.update(id,user,body.fields));}
   if(req.method==='DELETE'){await jobs.remove(id,user);return reply(res,200,{ok:true});}
  }
  if(url.pathname==='/api/invoices/analyze'&&req.method==='POST'){
   if(busy.has(user)||(last.get(user)||0)>now()-5000)throw new ApiError(429,'Wait for the current analysis before uploading another invoice.');
   if(busy.size>=4)throw new ApiError(503,'Invoice analysis is busy. Try again shortly.');
   const mime=req.headers['content-type'];if(!['application/pdf','image/png','image/jpeg','image/webp'].includes(mime))throw new ApiError(415,'Choose a PDF, PNG, JPEG or WebP file.');
   busy.add(user);last.set(user,now());
   try{
    const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>5242880)throw new ApiError(413,'File exceeds 5 MB.');chunks.push(c);}if(!size)throw new ApiError(400,'File is empty.');
    const job=await jobs.create({bytes:Buffer.concat(chunks),mime,fileName:decodeURIComponent(req.headers['x-file-name']||'Invoice'),user});
    return reply(res,202,job);
   }finally{busy.delete(user);}
  }
  if(url.pathname==='/api/invoices/draft'&&req.method==='POST'){
   const body=await jsonBody(req,512*1024),analysis=await jobs.analysis(body.analysisToken,user);
   if(!analysis||analysis.user!==user)throw new ApiError(409,'Analysis expired. Analyze the original file again.');
   if(body.documentReviewed!==true)throw new ApiError(422,'Confirm this is a supplier invoice before saving.');
   const result=await auth.request('/rest/v1/rpc/save_llm_invoice_draft',{token:session.token,method:'POST',body:{p_id:body.id,p_payload:{...body.fields,documentReviewed:true,documentKind:'invoice',sourceSha256:analysis.sha256,extraction:{...analysis.extraction,payment_terms:body.fields?.paymentTerms??analysis.extraction.payment_terms,ship_to_address:body.fields?.shipToAddress??analysis.extraction.ship_to_address},model:analysis.model}}});
   return reply(res,200,result);
  }
  const edit=url.pathname.match(/^\/api\/invoices\/([a-f0-9-]{36})\/edit-draft$/);
  if(edit&&req.method==='POST'){
   const body=await jsonBody(req,512*1024);
   return reply(res,200,await auth.request('/rest/v1/rpc/edit_llm_invoice_draft',{token:session.token,method:'POST',body:{p_id:edit[1],p_expected_updated_at:body.expectedUpdatedAt,p_payload:body.fields}}));
  }
  const match=url.pathname.match(/^\/api\/invoices\/([a-f0-9-]{36})\/approve-draft$/);
  if(match&&req.method==='POST'){
   const body=await jsonBody(req,4096);if(body.confirmed!==true||!['unpaid','paid'].includes(body.paymentStatus))throw new ApiError(422,'Confirm approval and choose Unpaid or Paid.');
   const result=await auth.request('/rest/v1/rpc/approve_invoice_draft_payment',{token:session.token,method:'POST',body:{p_invoice:match[1],p_expected_updated_at:body.expectedUpdatedAt,p_payment_status:body.paymentStatus,p_payment_date:body.paymentDate||null,p_payment_method:body.paymentMethod||null}});return reply(res,200,result);
  }
  throw new ApiError(404,'Resource not found.');
 };
}
export const invoiceIntake=createInvoiceIntake();
