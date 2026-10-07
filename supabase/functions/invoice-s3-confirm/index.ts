import { createClient } from "npm:@supabase/supabase-js@2.57.4";

export async function handler(req: Request): Promise<Response> {
 const reply = (status: number, body: unknown) => Response.json(body, {status});
 if (req.method !== "POST") return reply(405, {error:"POST required"});
 try {
  const url = Deno.env.get("SUPABASE_URL")!;
  const authorization = req.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return reply(401,{error:"Authentication required"});
  const client = createClient(url,Deno.env.get("SUPABASE_ANON_KEY")!,{global:{headers:{Authorization:authorization}}});
  const {data:user,error:authError}=await client.auth.getUser(authorization.slice(7));
  if(authError || !user.user) return reply(401,{error:"Invalid session"});
  const body=await req.json();
  if(!/^[0-9a-f]{64}$/.test(body.sha256)||!Number.isSafeInteger(body.size)||body.size<=0||body.size>25*1024*1024)
   return reply(400,{error:"Invalid file size or SHA-256"});
  const {data:path,error:pathError}=await client.rpc("invoice_document_upload_path",{
   target_invoice_id:body.invoice_id,file_extension:body.extension});
  if(pathError || !path) return reply(403,{error:"Invoice access denied or invalid extension"});
  const signed=new URL(body.s3_get_url);
  const host=new URL(url).hostname;
  if(signed.protocol!=="https:" || signed.port || signed.username || signed.password ||
    ![host,host.replace(".supabase.co",".storage.supabase.co")].includes(signed.hostname) ||
    decodeURIComponent(signed.pathname)!=="/storage/v1/s3/invoice-documents/"+path ||
    signed.searchParams.get("X-Amz-Algorithm")!=="AWS4-HMAC-SHA256" ||
    !signed.searchParams.has("X-Amz-Signature"))
   return reply(400,{error:"Expected signed S3 URL for this invoice"});
  const response=await fetch(signed,{redirect:"error",signal:AbortSignal.timeout(30000)});
  if(!response.ok || Number(response.headers.get("content-length"))!==body.size)
   return reply(409,{error:"S3 file unavailable or size mismatch"});
  const reader=response.body!.getReader(); const chunks:Uint8Array[]=[];let length=0;
  while(true){const {done,value}=await reader.read();if(done)break;
   length+=value.length;if(length>body.size){await reader.cancel();return reply(409,{error:"File too large"});}chunks.push(value);}
  const bytes=new Uint8Array(length);let pos=0;for(const chunk of chunks){bytes.set(chunk,pos);pos+=chunk.length;}
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))).map(x=>x.toString(16).padStart(2,"0")).join("");
  if(length!==body.size || hash!==body.sha256) return reply(409,{error:"Original file integrity mismatch"});
  const etag=response.headers.get("etag");if(!etag)return reply(409,{error:"Missing S3 ETag"});
  const admin=createClient(url,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const {data:document,error}=await admin.rpc("confirm_invoice_s3_document",{
   p_invoice:body.invoice_id,p_path:path,p_file_name:String(body.file_name||path.split("/").pop()),
   p_mime_type:response.headers.get("content-type")||"application/octet-stream",
   p_size:length,p_etag:etag,p_sha256:hash});
  if(error)return reply(409,{error:"Storage confirmation rejected",detail:error.message});
  return reply(200,{invoice_id:body.invoice_id,document_id:document,storage_verified:true,sha256:hash});
 } catch { return reply(400,{error:"Unable to verify S3 document"}); }
}
Deno.serve(handler);

