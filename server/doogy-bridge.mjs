import {sendAssignment} from './my-day-whatsapp.mjs';
import {createAgentService} from './doogy-agent.mjs';
// Private Unix socket bridge. The web service receives no OpenClaw credentials or shell access.
import http from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {chmod,unlink} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {ApiError} from './auth.mjs';
import {createConversationService} from './doogy-chat.mjs';
import {sanitizeWhatsappDirectory} from './doogy-ai.mjs';
const allowedMethods=new Set(['sessions.list','chat.history','chat.send','config.get','config.patch','send']);
async function localCall(method,params){
 if(!allowedMethods.has(method))throw new ApiError(400,'Unsupported conversation action.');
 try{const {stdout}=await promisify(execFile)('/usr/bin/openclaw',['gateway','call',method,'--json','--timeout','20000','--params',JSON.stringify(params)],{timeout:28000,maxBuffer:10*1024*1024});return JSON.parse(stdout);}
 catch(error){if(method==='config.patch'&&/baseHash|config changed|configuration changed/i.test(error.stderr||''))throw new ApiError(409,'Settings changed. Reopen settings before saving.');throw new ApiError(503,method==='send'?'Delivery could not be confirmed. Retry the same message.':'OpenClaw is unavailable. Try again.');}
}
export function createBridgeDispatch(call=localCall){
 const service=createConversationService(call),agent=createAgentService(call);let cache=null,pending=null;
 return async body=>{
  if(!body||typeof body!=='object')throw new ApiError(400,'Invalid request.');
  switch(body.action){
   case 'task-assignment':return sendAssignment(body.input,call);
   case 'directory':
    if(cache&&Date.now()-Date.parse(cache.syncedAt)<30000)return {...cache,stale:false};
    if(!pending)pending=call('sessions.list',{limit:10000}).then(v=>{cache=sanitizeWhatsappDirectory(v);return {...cache,stale:false};}).catch(e=>{if(cache)return {...cache,stale:true};throw e;}).finally(()=>{pending=null;});return pending;
   case 'agent-history':return agent.history('owner',body.actor);
   case 'agent-send':return agent.send('owner',body.actor,body.input);
   case 'history':return service.history('owner',body.id,body.offset??0);
   case 'settings':return service.settings('owner',body.id);
   case 'saveSettings':return service.saveSettings('owner',body.id,body.input);
   case 'send':if(typeof body.actor!=='string'||!body.actor)throw new ApiError(400,'Invalid sender.');return service.send('owner',body.actor,body.id,body.input);
   default:throw new ApiError(400,'Unsupported conversation action.');
  }
 };
}
export async function startBridge(socketPath='/run/hot-doogy-openclaw/bridge.sock'){
 const dispatch=createBridgeDispatch();
 const server=http.createServer(async(req,res)=>{
  const reply=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  try{
   if(req.method!=='POST'||req.url!=='/')throw new ApiError(404,'Not found.');
   let size=0,raw='';for await(const chunk of req){size+=chunk.length;if(size>100000)throw new ApiError(413,'Request too large.');raw+=chunk;}
   let body;try{body=JSON.parse(raw);}catch{throw new ApiError(400,'Invalid request.');}
   reply(200,await dispatch(body));
  }catch(error){reply(error.status||500,{error:error.status?error.message:'OpenClaw request failed.'});}
 });
 server.requestTimeout=45000;server.headersTimeout=10000;
 await unlink(socketPath).catch(e=>{if(e.code!=='ENOENT')throw e;});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve);});await chmod(socketPath,0o660);return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await startBridge();
