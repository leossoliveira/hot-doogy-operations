import {databaseErrorMessage} from './database-errors.mjs';
import {randomBytes} from 'node:crypto';
import {clientAddress,createLoginLimits} from './login-limits.mjs';
import {SUPABASE_URL,SUPABASE_KEY,ORGANIZATION_ID} from './supabase-config.mjs';
export class ApiError extends Error {constructor(status,message){super(message);this.status=status;}}
export async function jsonBody(req,max=1024*1024){let n=0,chunks=[];for await(const c of req){n+=c.length;if(n>max)throw new ApiError(413,"File is too large.");chunks.push(c);}try{return JSON.parse(Buffer.concat(chunks).toString());}catch{throw new ApiError(400,"Invalid data.");}}
export function reply(res,status,value){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}
const SESSION_MS=28800000,PENDING_MS=600000;
export function createAuth({fetcher=fetch,now=Date.now,trustProxy=process.env.HOT_DOOGY_TRUST_PROXY==='loopback'}={}){
 const sessions=new Map(),limits=createLoginLimits({now}),mfaLimits=createLoginLimits({now});
 async function request(route,{token,method='GET',body}={}){
  const r=await fetcher(SUPABASE_URL+route,{method,headers:{apikey:SUPABASE_KEY,...(token?{Authorization:`Bearer ${token}`} : {}),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
  const data=await r.json().catch(()=>null);
  if(!r.ok){
   if(route.startsWith('/auth/v1/factors')){
    if(r.status===429)throw new ApiError(429,"Too many attempts. Wait a few minutes before trying again.");
    if(['mfa_verification_failed','mfa_challenge_expired','mfa_verification_rejected'].includes(data?.error_code))throw new ApiError(400,"That code is invalid or expired. Enter a new code from your authenticator app.");
    if(r.status===401)throw new ApiError(401,"Your session has expired. Sign in again.");
    throw new ApiError(r.status>=500?502:400,"Unable to verify your authenticator. Try again, or contact your administrator.");
   }
   throw new ApiError([401,403,429].includes(r.status)?r.status:502,route.startsWith('/auth/')?"Invalid email or password, or your session has expired.":databaseErrorMessage(data));
  }
  return data;
 }
 const sid=req=>(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('hd_session='))?.slice(11);
 const cookie=(req,res,id,age)=>res.setHeader('Set-Cookie',`hd_session=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${req.socket.encrypted?'; Secure':''}`);
 function setTokens(s,t){if(!t.access_token||!t.refresh_token||!(t.expires_in>0))throw new ApiError(502,"Unable to establish a secure session.");s.token=t.access_token;s.refresh=t.refresh_token;s.expiresAt=now()+t.expires_in*1000;}
 async function membership(token,userId){const rows=await request(`/rest/v1/organization_members?select=id,role,status&organization_id=eq.${ORGANIZATION_ID}&user_id=eq.${encodeURIComponent(userId)}&status=eq.active`,{token});if(rows.length!==1)throw new ApiError(403,"Your account does not have active access to this workspace.");return rows[0];}
 async function validate(s){
  const [user,member,assurance]=await Promise.all([request('/auth/v1/user',{token:s.token}),membership(s.token,s.user.id),request('/rest/v1/rpc/operations_auth_status',{token:s.token,method:'POST',body:{}})]);
  if(user.id!==s.user.id||user.is_anonymous||!assurance?.active)throw new ApiError(401,"Your session has expired. Sign in again.");
  s.member=member;s.factors=user.factors||[];
  const verified=s.factors.filter(f=>f.status==='verified');
  s.mfaRequired=['owner','admin'].includes(member.role)||verified.length>0;
  s.pending=s.mfaRequired&&!assurance.mfa_verified;s.allowed=assurance.allowed===true;
  if(s.pending&&s.pendingAt==null)s.pendingAt=now();
  if(!s.pending){delete s.pendingAt;delete s.enrollment;}
  return s;
 }
 function expired(s){return now()-s.createdAt>=SESSION_MS||(s.pendingAt!=null&&now()-s.pendingAt>=PENDING_MS);}
 function remember(req,res,s){
  for(const [id,old] of sessions)if(expired(old))sessions.delete(id);
  sessions.delete(sid(req));if(sessions.size>=10000)throw new ApiError(503,"Sign-in is temporarily unavailable. Try again shortly.");
  const id=randomBytes(32).toString('hex');sessions.set(id,s);cookie(req,res,id,Math.max(1,Math.floor((SESSION_MS-(now()-s.createdAt))/1000)));
 }
 async function getSession(req){
  const id=sid(req),s=sessions.get(id);
  if(!s||expired(s)){sessions.delete(id);throw new ApiError(401,"Your session has expired. Sign in again.");}
  if(s.expiresAt<=now()+60000){
   if(!s.refreshing)s.refreshing=request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:s.refresh}}).then(t=>setTokens(s,t)).finally(()=>s.refreshing=null);
   try{await s.refreshing;}catch(e){sessions.delete(id);throw e;}
  }
  try{await validate(s);if(expired(s))throw new ApiError(401,"Your session has expired. Sign in again.");return s;}catch(e){if([401,403].includes(e.status))sessions.delete(id);throw e;}
 }
 async function requireSession(req){const s=await getSession(req);if(s.pending||!s.allowed)throw new ApiError(403,"Complete two-step verification before accessing your workspace.");return s;}
 function publicSession(s){return {user:s.user,role:s.member.role,mfa:s.pending?{required:true,step:s.factors.some(f=>f.status==='verified')?'verify':'enroll',factors:s.factors.filter(f=>f.status==='verified'&&f.factor_type==='totp').map(f=>({id:f.id,name:f.friendly_name||'Authenticator app'}))}:{required:false,verified:s.mfaRequired}};}
 async function handle(req,res,url){
  if(!url.pathname.startsWith('/api/auth/'))return false;
  if(url.pathname==='/api/auth/login'&&req.method==='POST'){
   const ip=clientAddress(req,trustProxy);if(!limits.allowAddress(ip))throw new ApiError(429,"Wait a few minutes before trying again.");
   const {email,password}=await jsonBody(req,8192);if(typeof email!=='string'||typeof password!=='string')throw new ApiError(400,"Enter your email and password.");
   if(!limits.allowAccount(ip,email))throw new ApiError(429,"Wait a few minutes before trying again.");
   const t=await request('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password}});
   const s={createdAt:now(),user:{id:t.user.id,email:t.user.email}};setTokens(s,t);await validate(s);
   remember(req,res,s);limits.clearAccount(ip,email);reply(res,200,publicSession(s));return true;
  }
  if(url.pathname==='/api/auth/session'&&req.method==='GET'){reply(res,200,publicSession(await getSession(req)));return true;}
  if(url.pathname==='/api/auth/logout'&&req.method==='POST'){
   const id=sid(req),s=sessions.get(id);sessions.delete(id);cookie(req,res,'',0);
   if(s)await request('/auth/v1/logout?scope=local',{token:s.token,method:'POST'}).catch(()=>{});
   reply(res,200,{ok:true});return true;
  }
  if(['/api/auth/mfa/enroll','/api/auth/mfa/verify'].includes(url.pathname)&&req.method==='POST'){
   const s=await getSession(req);
   if(!s.pending)throw new ApiError(409,"Two-step verification is already complete.");
   if(s.mfaBusy)throw new ApiError(409,"Verification is in progress. Please wait.");
   s.mfaBusy=true;const pendingDeadline=s.pendingAt+PENDING_MS;
   try{
    const body=await jsonBody(req,2048);
    if(url.pathname.endsWith('/enroll')){
     if(s.factors.some(f=>f.status==='verified'))throw new ApiError(403,"Use your existing authenticator to verify this sign-in.");
     if(!s.enrollment){
      if(!mfaLimits.allowAccount('enrollment',s.user.id))throw new ApiError(429,"Too many setup attempts. Wait a few minutes before trying again.");
      // Clean up only abandoned enrollments created by this app, never a verified factor.
      for(const f of s.factors.filter(f=>f.status==='unverified'&&f.factor_type==='totp'&&f.friendly_name?.startsWith('HOT DOOGY · ')&&Date.parse(f.created_at)<now()-PENDING_MS))await request(`/auth/v1/factors/${encodeURIComponent(f.id)}`,{token:s.token,method:'DELETE'});
      const f=await request('/auth/v1/factors',{token:s.token,method:'POST',body:{factor_type:'totp',issuer:'HOT DOOGY',friendly_name:'HOT DOOGY · '+randomBytes(4).toString('hex')}});
      if(!f.id||!f.totp?.qr_code||!f.totp.secret)throw new ApiError(502,"Unable to set up your authenticator. Try again.");
      s.enrollment={id:f.id,qrCode:'data:image/svg+xml;base64,'+Buffer.from(f.totp.qr_code).toString('base64'),secret:f.totp.secret};
     }
     if(sessions.get(sid(req))!==s)throw new ApiError(401,"Sign in again.");
     reply(res,200,s.enrollment);return true;
    }
    // The user-wide budget survives new cookies, password logins and changes of IP.
    if(!mfaLimits.allowAccount('verification',s.user.id))throw new ApiError(429,"Too many verification attempts. Wait 15 minutes before trying again.");
    if(typeof body.code!=='string'||!/^\d{6}$/.test(body.code))throw new ApiError(400,"Enter the six-digit code from your authenticator app.");
    const verified=s.factors.filter(f=>f.status==='verified');
    const factor=verified.length?verified.find(f=>f.factor_type==='totp'&&f.id===body.factorId):s.factors.find(f=>f.id===s.enrollment?.id&&f.status==='unverified'&&f.factor_type==='totp');
    if(!factor)throw new ApiError(400,"Choose your authenticator or restart setup.");
    const route=`/auth/v1/factors/${encodeURIComponent(factor.id)}`;
    const challenge=await request(route+'/challenge',{token:s.token,method:'POST',body:{}});
    const t=await request(route+'/verify',{token:s.token,method:'POST',body:{challenge_id:challenge.id,code:body.code}});
    if(now()>=pendingDeadline)throw new ApiError(401,"Your session has expired. Sign in again.");
    setTokens(s,t);await validate(s);
    if(s.pending||!s.allowed)throw new ApiError(403,"Two-step verification could not be confirmed. Sign in again.");
    if(sessions.get(sid(req))!==s||now()-s.createdAt>=SESSION_MS)throw new ApiError(401,"Sign in again.");
    // Invalidate the pending cookie; provider tokens never leave the server.
    remember(req,res,s);reply(res,200,publicSession(s));return true;
   }finally{s.mfaBusy=false;}
  }
  throw new ApiError(404,"Resource not found.");
 }
 return {handle,requireSession,request};
}
