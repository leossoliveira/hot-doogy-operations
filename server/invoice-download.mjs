import {ApiError} from './auth.mjs';
import {SUPABASE_URL,SUPABASE_KEY,ORGANIZATION_ID} from './supabase-config.mjs';

export async function invoiceDownload(req,res,url,auth,session,fetchFile=fetch){
 const uuid='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
 const match=url.pathname.match(new RegExp(`^/api/invoices/(${uuid})/documents/(${uuid})/download$`));
 if(req.method!=='GET'||!match)throw new ApiError(404,'Document not found.');
 const [,invoiceId,documentId]=match;
 // Both metadata reads run as the signed-in user, retaining organization/location and MFA RLS.
 const invoices=await auth.request(`/rest/v1/invoices?id=eq.${invoiceId}&organization_id=eq.${ORGANIZATION_ID}&select=id`,{token:session.token});
 if(!invoices?.length)throw new ApiError(404,'Document not found.');
 const documents=await auth.request(`/rest/v1/invoice_documents?id=eq.${documentId}&invoice_id=eq.${invoiceId}&select=storage_path,file_name,mime_type`,{token:session.token});
 const document=documents?.[0],path=document?.storage_path;
 if(typeof path!=='string'||!path.startsWith(`${ORGANIZATION_ID}/${invoiceId}/`)||path.split('/').some(x=>!x||x==='.'||x==='..')||path.includes('\\'))throw new ApiError(404,'Document not found.');
 const response=await fetchFile(`${SUPABASE_URL}/storage/v1/object/authenticated/invoice-documents/${path.split('/').map(encodeURIComponent).join('/')}`,{
  headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${session.token}`},signal:AbortSignal.timeout(45000),redirect:'error',
 });
 if(!response.ok)throw new ApiError([400,403,404].includes(response.status)?404:502,'The original invoice file is unavailable.');
 const limit=50*1024*1024;
 if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel();throw new ApiError(413,'This document is too large to download.');}
 let size=0;const chunks=[];
 for await(const chunk of response.body){size+=chunk.length;if(size>limit)throw new ApiError(413,'This document is too large to download.');chunks.push(chunk);}
 if(!size)throw new ApiError(404,'The original invoice file is empty.');
 const filename=String(document.file_name||'invoice').replace(/[\r\n\x00-\x1f\x7f/\\]/g,'_');
 const encodedName=encodeURIComponent(filename).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16));
 res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="invoice"; filename*=UTF-8''${encodedName}`,'Content-Length':size,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
 res.end(Buffer.concat(chunks));
}
