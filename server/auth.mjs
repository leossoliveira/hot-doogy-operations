import {databaseErrorMessage} from './database-errors.mjs';
import {randomBytes} from 'node:crypto';
import {clientAddress,createLoginLimits} from './login-limits.mjs';
import {SUPABASE_URL,SUPABASE_KEY,ORGANIZATION_ID} from './supabase-config.mjs';
export class ApiError extends Error {constructor(status,message){super(message);this.status=status;}}
export async function jsonBody(req,max=1024*1024){let n=0,chunks=[];for await(const c of req){n+=c.length;if(n>max)throw new ApiError(413,"File is too large.");chunks.push(c);}try{return JSON.parse(Buffer.concat(chunks).toString());}catch{throw new ApiError(400,"Invalid data.");}}
export function reply(res,status,value){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}
export function createAuth({fetcher=fetch,now=Date.now,trustProxy=process.env.HOT_DOOGY_TRUST_PROXY==='loopback'}={}){
 const sessions=new Map(),limits=createLoginLimits({now});
 async function request(route,{token,method='GET',body}={}){
  const r=await fetcher(SUPABASE_URL+route,{method,headers:{apikey:SUPABASE_KEY,...(token?{Authorization:`Bearer ${token}`} : {}),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
  const data=await r.json().catch(()=>null);if(!r.ok)throw new ApiError(r.status===401||r.status===403?r.status:502,route.startsWith('/auth/')?"Invalid email or password, or your session has expired.":databaseErrorMessage(data));return data;
 }
 const sid=req=>(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('hd_session='))?.slice(11);
 const cookie=(req,res,id,age)=>res.setHeader('Set-Cookie',`hd_session=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${req.socket.encrypted?'; Secure':''}`);
 async function membership(token,userId){const rows=await request(`/rest/v1/organization_members?select=id,role,status&organization_id=eq.${ORGANIZATION_ID}&user_id=eq.${userId}&status=eq.active`,{token});if(rows.length!==1)throw new ApiError(403,"Your account does not have active access to this workspace.");return rows[0];}
 async function requireSession(req){const id=sid(req),s=sessions.get(id);if(s&&now()-s.createdAt>28800000){sessions.delete(id);throw new ApiError(401,"Your session has expired. Sign in again.");}if(!s)throw new ApiError(401,"Sign in to access your workspace.");
  if(s.expiresAt<=now()+60000){if(!s.refreshing)s.refreshing=request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:s.refresh}}).then(t=>{s.token=t.access_token;s.refresh=t.refresh_token;s.expiresAt=now()+t.expires_in*1000;}).finally(()=>s.refreshing=null);try{await s.refreshing;}catch(e){sessions.delete(id);throw e;}}
  try{const [user,member]=await Promise.all([request('/auth/v1/user',{token:s.token}),membership(s.token,s.user.id)]);if(user.id!==s.user.id||user.is_anonymous)throw new ApiError(403,"Unauthorized access.");s.member=member;return s;}catch(e){if([401,403].includes(e.status))sessions.delete(id);throw e;}
 }
 async function handle(req,res,url){if(!url.pathname.startsWith('/api/auth/'))return false;
  if(url.pathname==='/api/auth/login'&&req.method==='POST'){
   const ip=clientAddress(req,trustProxy);if(!limits.allowAddress(ip))throw new ApiError(429,"Wait a few minutes before trying again.");
   const {email,password}=await jsonBody(req,8192);if(typeof email!=='string'||typeof password!=='string')throw new ApiError(400,"Enter your email and password.");
   if(!limits.allowAccount(ip,email))throw new ApiError(429,"Wait a few minutes before trying again.");
   const t=await request('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password}});const member=await membership(t.access_token,t.user.id);if(t.user.is_anonymous)throw new ApiError(403,"Unauthorized access.");const id=randomBytes(32).toString('hex');sessions.delete(sid(req));sessions.set(id,{createdAt:now(),token:t.access_token,refresh:t.refresh_token,expiresAt:now()+t.expires_in*1000,user:{id:t.user.id,email:t.user.email},member});limits.clearAccount(ip,email);cookie(req,res,id,28800);reply(res,200,{user:{email:t.user.email},role:member.role});return true;
  }
  if(url.pathname==='/api/auth/session'&&req.method==='GET'){const s=await requireSession(req);reply(res,200,{user:s.user,role:s.member.role});return true;}
  if(url.pathname==='/api/auth/logout'&&req.method==='POST'){const id=sid(req),s=sessions.get(id);sessions.delete(id);cookie(req,res,'',0);if(s)await request('/auth/v1/logout',{token:s.token,method:'POST'}).catch(()=>{});reply(res,200,{ok:true});return true;}
  throw new ApiError(404,"Resource not found.");
 }
 return {handle,requireSession,request};
}
