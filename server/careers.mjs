import {ApiError,jsonBody,reply} from './auth.mjs';
import {SUPABASE_URL,SUPABASE_KEY,ORGANIZATION_ID} from './supabase-config.mjs';
import {readPages} from './paginated-read.mjs';
// Careers lives under /api/hr so the existing HR permission profile applies. Reads run
// as the signed-in user (owner/admin + MFA RLS); writes go through careers_review.
const UUID='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const COLUMNS='id,reference,status,locale,first_name,last_name,email,phone,city,state,preferred_location_id,any_location,position,at_least_16,work_authorized,earliest_start,hours_per_week,availability,work_experience,english_proficiency,other_languages,pitch,referral_source,consent_at,rating,reviewed_by,reviewed_at,version,created_at,updated_at';
const STATUSES=['new','reviewing','interview','offer','hired','rejected','archived'];
const SAFE_MIME=new Set(['application/pdf','image/jpeg','image/png']);
export async function careersAPI(req,res,url,auth,session,fetchFile=fetch){
 if(!['owner','admin'].includes(session.member.role))throw new ApiError(403,'Careers is available to administrators only.');
 const read=path=>auth.request(path,{token:session.token});
 const org=`organization_id=eq.${ORGANIZATION_ID}`;
 if(url.pathname==='/api/hr/careers'&&req.method==='GET'){
  const [applications,files,notes,events,accounts]=await Promise.all([
   readPages(read,`/rest/v1/careers_applications?select=${COLUMNS}&${org}&order=created_at.desc,id`),
   readPages(read,`/rest/v1/careers_application_files?select=id,application_id,kind,file_name,mime_type,size,created_at&${org}&order=created_at,id`),
   readPages(read,`/rest/v1/careers_application_notes?select=id,application_id,author_id,body,created_at&${org}&order=created_at.desc,id`),
   readPages(read,`/rest/v1/careers_application_events?select=id,application_id,actor_id,type,from_status,to_status,payload,created_at&${org}&order=created_at.desc,id`),
   auth.request('/rest/v1/rpc/hr_user_directory',{token:session.token,method:'POST',body:{}})]);
  const names=new Map((accounts||[]).map(a=>[a.user_id,a.name||a.email]));
  const who=id=>id?names.get(id)||'Team member':null;
  return reply(res,200,{applications,files,notes:notes.map(n=>({...n,author:who(n.author_id)})),events:events.map(x=>({...x,actor:who(x.actor_id)}))});
 }
 if(url.pathname==='/api/hr/careers/review'&&req.method==='POST'){
  const b=await jsonBody(req,16384);
  if(!new RegExp(`^${UUID}$`).test(b.id||'')||!Number.isInteger(b.version)||b.version<1)throw new ApiError(400,'Invalid application.');
  if(b.status!=null&&!STATUSES.includes(b.status))throw new ApiError(400,'Invalid status.');
  if(b.rating!=null&&!(Number.isInteger(b.rating)&&b.rating>=1&&b.rating<=5))throw new ApiError(400,'Rating must be between 1 and 5.');
  if(b.note!=null&&(typeof b.note!=='string'||b.note.length>4000))throw new ApiError(400,'Notes are limited to 4000 characters.');
  return reply(res,200,await auth.request('/rest/v1/rpc/careers_review',{token:session.token,method:'POST',body:{p_id:b.id,p_version:b.version,p_status:b.status??null,p_rating:b.rating??null,p_clear_rating:b.clearRating===true,p_note:b.note??null}}));
 }
 const match=url.pathname.match(new RegExp(`^/api/hr/careers/(${UUID})/files/(${UUID})$`));
 if(match&&req.method==='GET'){
  const [,applicationId,fileId]=match;
  const rows=await read(`/rest/v1/careers_application_files?id=eq.${fileId}&application_id=eq.${applicationId}&${org}&select=object_path,file_name,mime_type,size`);
  const file=rows?.[0],path=file?.object_path;
  if(typeof path!=='string'||!path.startsWith(`${ORGANIZATION_ID}/${applicationId}/`)||path.split('/').some(x=>!x||x==='.'||x==='..')||path.includes('\\')||!SAFE_MIME.has(file.mime_type))throw new ApiError(404,'File not found.');
  const response=await fetchFile(`${SUPABASE_URL}/storage/v1/object/authenticated/careers-uploads/${path.split('/').map(encodeURIComponent).join('/')}`,{headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${session.token}`},signal:AbortSignal.timeout(45000),redirect:'error'});
  if(!response.ok)throw new ApiError([400,403,404].includes(response.status)?404:502,'The file is unavailable.');
  const limit=5*1024*1024;let size=0;const chunks=[];
  for await(const chunk of response.body){size+=chunk.length;if(size>limit)throw new ApiError(413,'This file is too large.');chunks.push(chunk);}
  if(!size)throw new ApiError(404,'The file is empty.');
  const filename=String(file.file_name||'file').replace(/[\r\n\x00-\x1f\x7f/\\]/g,'_'),encodedName=encodeURIComponent(filename).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16));
  const inline=url.searchParams.get('inline')==='1';
  res.writeHead(200,{'Content-Type':inline?file.mime_type:'application/octet-stream','Content-Disposition':`${inline?'inline':'attachment'}; filename="file"; filename*=UTF-8''${encodedName}`,'Content-Length':size,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; sandbox"});
  return res.end(Buffer.concat(chunks));
 }
 throw new ApiError(404,'Careers page not found.');
}
