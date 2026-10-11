import {createHash} from 'node:crypto';
import {loadS3Config,signedUrl} from './photo-storage.mjs';
import {reply,ApiError} from './auth.mjs';
export async function invoiceUpload(req,res,url,auth,session){
 const m=url.pathname.match(/^\/api\/invoices\/([a-f0-9-]{36})\/document$/);if(!m||req.method!=='PUT')throw new ApiError(404,"Document not found.");
 if(req.headers['x-document-kind']!=='invoice'||req.headers['x-document-reviewed']!=='true')throw new ApiError(422,'Only reviewed supplier invoices can be uploaded. Receiving proofs are not accepted.');
 const types={'application/pdf':'pdf','image/png':'png','image/jpeg':'jpg','image/webp':'webp'},type=req.headers['content-type'],extension=types[type];if(!extension)throw new ApiError(415,"Invalid format.");
 const id=m[1];await auth.request('/rest/v1/rpc/invoice_document_upload_path',{token:session.token,method:'POST',body:{target_invoice_id:id,file_extension:extension}});
 let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>20*1024*1024)throw new ApiError(413,"File exceeds 20 MB.");chunks.push(c);}if(!size)throw new ApiError(400,"File is empty.");const body=Buffer.concat(chunks),sha256=createHash('sha256').update(body).digest('hex');
 const path=await auth.request('/rest/v1/rpc/review_invoice_document',{token:session.token,method:'POST',body:{p_invoice:id,p_extension:extension,p_sha256:sha256,p_size:size,p_kind:'invoice',p_reviewed:true}});
 const env=await loadS3Config();
 const put=await fetch(signedUrl(env,'PUT',path,{},new Date(),'invoice-documents'),{method:'PUT',headers:{'Content-Type':type},body,signal:AbortSignal.timeout(30000)});if(!put.ok)throw new ApiError(502,"Document upload failed.");
 const result=await auth.request('/functions/v1/invoice-s3-confirm',{token:session.token,method:'POST',body:{invoice_id:id,extension,size,sha256,file_name:decodeURIComponent(req.headers['x-file-name']||'invoice.'+extension),s3_get_url:signedUrl(env,'GET',path,{},new Date(),'invoice-documents')}});
 reply(res,200,result);
}
