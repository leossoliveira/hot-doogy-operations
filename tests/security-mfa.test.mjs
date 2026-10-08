import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {mkdtempSync,rmSync,readFileSync,statSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAuth} from '../server/auth.mjs';
function fixture({role='admin',factors=[],verified=false,sessionDirectory}={}){
 const state={role,factors,verified,active:true,time:0,calls:[],code:'123456',verifiedAt:null};
 const user=()=>({id:'user-1',email:'test@example.invalid',factors:state.factors});
 const tokens=()=>({user:user(),access_token:state.verified?'trusted-aal2':'trusted-aal1',refresh_token:'server-only-refresh',expires_in:3600});
 const fetcher=async(url,options)=>{
  const route=new URL(url).pathname,body=options.body?JSON.parse(options.body):{};state.calls.push({route,method:options.method,body});
  let value,status=200;
  if(route.endsWith('/token')){if(new URL(url).searchParams.get('grant_type')==='password')state.verified=false;value=tokens();}
  else if(route.endsWith('/user'))value=user();
  else if(route.endsWith('/organization_members'))value=[{id:'member',role:state.role,status:'active'}];
  else if(route.endsWith('/operations_auth_status'))value={active:state.active,mfa_verified:state.verified,allowed:state.active&&(state.verified||(!['owner','admin'].includes(state.role)&&!state.factors.some(f=>f.status==='verified')))};
  else if(route==='/auth/v1/factors'){
   state.factors.push({id:'new-factor',factor_type:'totp',status:'unverified',friendly_name:body.friendly_name});
   value={id:'new-factor',totp:{qr_code:'<svg xmlns="http://www.w3.org/2000/svg"></svg>',secret:'TESTKEYONLY'}};
  }else if(options.method==='DELETE'){state.factors=state.factors.filter(f=>!route.endsWith('/'+f.id));value={};}
  else if(route.endsWith('/challenge'))value={id:'challenge-1'};
  else if(route.endsWith('/verify')){
   if(body.code!==state.code){status=422;value={error_code:'mfa_verification_failed'};}
   else{state.verified=true;state.factors.find(f=>route.includes('/'+f.id+'/')).status='verified';value=tokens();}
  }else if(route.endsWith('/logout')){state.active=false;value={};}
  else throw Error('Unexpected provider call: '+route);
  return {ok:status===200,status,json:async()=>value};
 };
 let auth=createAuth({fetcher,now:()=>state.time,sessionDirectory});
 let cookie='';
 function request(body={},customCookie=cookie){const req=Readable.from([Buffer.from(JSON.stringify(body))]);req.socket={remoteAddress:'127.0.0.1',encrypted:true};req.headers={cookie:customCookie};req.method='POST';return req;}
 async function call(path,body={},options={}){
  const req=request(body,options.cookie??cookie);req.method=options.method||'POST';let data,headers={};
  await auth.handle(req,{setHeader(k,v){headers[k]=v;},writeHead(status,h){headers={...headers,...h};},end(v){data=JSON.parse(v);}},new URL('https://test.invalid/api/auth/'+path));
  if(headers['Set-Cookie'])cookie=headers['Set-Cookie'].split(';')[0];return {data,headers};
 }
 return {state,get auth(){return auth;},restart(){auth=createAuth({fetcher,now:()=>state.time,sessionDirectory});},call,request,get cookie(){return cookie;},login:()=>call('login',{email:'test@example.invalid',password:'test-only'})};
}
const enrolled=()=>[{id:'verified-factor',factor_type:'totp',status:'verified',friendly_name:'Phone'}];
test('owner/admin sessions require enrollment; pending sessions cannot access the workspace',async()=>{
 for(const role of ['owner','admin']){const f=fixture({role});const {data,headers}=await f.login();assert.equal(data.mfa.step,'enroll');assert.equal(data.mfa.required,true);assert.match(headers['Set-Cookie'],/HttpOnly.*SameSite=Strict.*Secure/);assert.equal(headers['Cache-Control'],'no-store');assert.doesNotMatch(JSON.stringify(data),/access_token|refresh_token|trusted-aal/);await assert.rejects(f.auth.requireSession(f.request()),{status:403});assert.equal((await f.call('session',{}, {method:'GET'})).data.mfa.step,'enroll');}
});
test('enrollment is reused after reload; verification rotates the cookie and unlocks access',async()=>{
 const f=fixture();await f.login();const original=f.cookie;
 const first=await f.call('mfa/enroll'),second=await f.call('mfa/enroll');assert.deepEqual(first.data,second.data);assert.equal(f.state.calls.filter(x=>x.route==='/auth/v1/factors').length,1);
 assert.match(first.data.qrCode,/^data:image\/svg\+xml;base64,/);assert.doesNotMatch(JSON.stringify((await f.call('session',{}, {method:'GET'})).data),/TESTKEYONLY|qrCode/);
 const {data}=await f.call('mfa/verify',{factorId:'new-factor',code:'123456'});assert.equal(data.mfa.required,false);assert.equal(data.mfa.verified,true);assert.notEqual(f.cookie,original);
 await assert.rejects(f.auth.requireSession(f.request({},original)),{status:401});assert.equal((await f.auth.requireSession(f.request())).token,'trusted-aal2');
});
test('existing TOTP is challenged; cannot replace it with a new factor at AAL1',async()=>{
 const f=fixture({factors:enrolled()});assert.equal((await f.login()).data.mfa.step,'verify');await assert.rejects(f.call('mfa/enroll'),{status:403});
 await assert.rejects(f.call('mfa/verify',{factorId:'another-users-factor',code:'123456'}),{status:400});assert.equal(f.state.calls.some(x=>x.route.endsWith('/challenge')),false);
 await f.call('mfa/verify',{factorId:'verified-factor',code:'123456'});assert.equal((await f.auth.requireSession(f.request())).member.role,'admin');
});
test('invalid codes never authorize a session and have a useful error',async()=>{
 const f=fixture({factors:enrolled()});await f.login();await assert.rejects(f.call('mfa/verify',{factorId:'verified-factor',code:'111111'}),{status:400,message:'That code is invalid or expired. Enter a new code from your authenticator app.'});await assert.rejects(f.auth.requireSession(f.request()),{status:403});
});
test('MFA attempts are limited across password logins and cookies',async()=>{
 const f=fixture({factors:enrolled()});await f.login();
 for(let i=0;i<20;i++)await assert.rejects(f.call('mfa/verify',{factorId:'verified-factor',code:'111111'}),{status:400});
 await f.login();await assert.rejects(f.call('mfa/verify',{factorId:'verified-factor',code:'123456'}),{status:429});f.state.time=900001;await f.login();await f.call('mfa/verify',{factorId:'verified-factor',code:'123456'});
});
test('pending sessions expire after ten minutes, including with periodic refreshes',async()=>{
 const f=fixture();await f.login();f.state.time=500000;await f.call('session',{}, {method:'GET'});f.state.time=600000;await assert.rejects(f.call('mfa/enroll'),{status:401});
});
test('non-admin users without factors keep password login; enrolled users still require MFA',async()=>{
 const f=fixture({role:'manager'});assert.equal((await f.login()).data.mfa.required,false);await f.auth.requireSession(f.request());
 f.state.role='admin';await assert.rejects(f.auth.requireSession(f.request()),{status:403});
 const g=fixture({role:'manager',factors:enrolled()});assert.equal((await g.login()).data.mfa.required,true);await assert.rejects(g.auth.requireSession(g.request()),{status:403});
});
test('provider revocation, assurance downgrade, and membership changes take effect on every request',async()=>{
 const f=fixture({factors:enrolled()});await f.login();await f.call('mfa/verify',{factorId:'verified-factor',code:'123456'});
 f.state.time=3550000;await f.auth.requireSession(f.request());assert.ok(f.state.calls.filter(x=>x.route.endsWith('/token')).length>=2);
 f.state.verified=false;await assert.rejects(f.auth.requireSession(f.request()),{status:403});f.state.active=false;await assert.rejects(f.auth.requireSession(f.request()),{status:401});
});
test('logout invalidates pending cookies and revokes the provider session',async()=>{
 const f=fixture();await f.login();const cookie=f.cookie;await f.call('logout');await assert.rejects(f.auth.requireSession(f.request({},cookie)),{status:401});assert.equal(f.state.active,false);
});
test('verified factors are never cleaned up; stale unverified app factors can be retried',async()=>{
 const f=fixture({factors:[{id:'abandoned',status:'unverified',factor_type:'totp',friendly_name:'HOT DOOGY · old',created_at:new Date(-700000).toISOString()},{id:'other-app',status:'unverified',factor_type:'totp',friendly_name:'Other'}]});await f.login();await f.call('mfa/enroll');assert.deepEqual(f.state.factors.map(x=>x.id),['other-app','new-factor']);
});

test('verified session survives restart encrypted, expires at 30 days without sliding',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'hd-auth-'));
 try{
  const f=fixture({factors:enrolled(),sessionDirectory:directory});await f.login();
  await f.call('mfa/verify',{factorId:'verified-factor',code:'123456'});
  const disk=readFileSync(join(directory,'sessions.enc'));assert.equal(disk.includes(Buffer.from('server-only-refresh')),false);assert.equal(disk.includes(Buffer.from('trusted-aal2')),false);assert.equal(statSync(join(directory,'sessions.enc')).mode&0o777,0o600);
  f.restart();assert.equal((await f.auth.requireSession(f.request())).user.id,'user-1');
  f.state.time=29*86400000;await f.auth.requireSession(f.request());f.restart();await f.auth.requireSession(f.request());
  f.state.time=30*86400000;await assert.rejects(f.auth.requireSession(f.request()),{status:401});
  f.restart();await assert.rejects(f.auth.requireSession(f.request()),{status:401});
 }finally{rmSync(directory,{recursive:true,force:true});}
});
test('persistent logout removes session; unknown browser and pending sessions are not trusted',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'hd-auth-'));
 try{
  const f=fixture({factors:enrolled(),sessionDirectory:directory});await f.login();f.restart();await assert.rejects(f.auth.requireSession(f.request()),{status:401});
  await f.login();const result=await f.call('mfa/verify',{factorId:'verified-factor',code:'123456'});assert.match(result.headers['Set-Cookie'],/Max-Age=2592000/);
  await assert.rejects(f.auth.requireSession(f.request({},'hd_session='+'0'.repeat(64))),{status:401});
  const saved=f.cookie;await f.call('logout');f.restart();await assert.rejects(f.auth.requireSession(f.request({},saved)),{status:401});
 }finally{rmSync(directory,{recursive:true,force:true});}
});
test('encrypted session tampering fails closed',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'hd-auth-'));
 try{
  const f=fixture({factors:enrolled(),sessionDirectory:directory});await f.login();await f.call('mfa/verify',{factorId:'verified-factor',code:'123456'});
  const file=join(directory,'sessions.enc'),bytes=readFileSync(file);bytes[30]^=1;writeFileSync(file,bytes);assert.throws(()=>f.restart(),/Unable to read encrypted session store/);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
