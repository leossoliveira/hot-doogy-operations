import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import {ApiError} from './auth.mjs';
export function sanitizeWhatsappDirectory(value){
 if(!Array.isArray(value?.sessions)||value.hasMore)throw Error('Incomplete session directory');
 const rows=new Map();
 for(const s of value.sessions){
  if(s.channel!=='whatsapp')continue;
  const target=s.origin?.to||s.key,account=s.origin?.accountId||'default',id=account+':'+target;
  const entry={id,name:String(s.displayName||s.label||target),kind:s.kind==='group'?'group':'direct',account,updatedAt:Number(s.updatedAt)||null};
  if(!rows.has(id)||(rows.get(id).updatedAt||0)<(entry.updatedAt||0))rows.set(id,entry);
 }
 return {syncedAt:new Date().toISOString(),scope:'openclaw-sessions',rows:[...rows.values()].sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0))};
}
let cached=null,pending=null;
export async function readWhatsappDirectory(role,path=process.env.HOT_DOOGY_WHATSAPP_DIRECTORY||'/var/lib/hot-doogy/whatsapp-directory.json'){
 if(!['owner','admin'].includes(role))throw new ApiError(403,'Doogy AI is available to administrators only.');
 if(process.env.HOT_DOOGY_OPENCLAW_SSH_HOST){
  if(cached&&Date.now()-Date.parse(cached.syncedAt)<30000)return {...cached,stale:false};
  if(!pending)pending=(async()=>{
   const host=process.env.HOT_DOOGY_OPENCLAW_SSH_HOST;if(!/^[a-zA-Z0-9_.@-]+$/.test(host)||host.startsWith('-'))throw new ApiError(503,'Invalid OpenClaw connection.');
   try{const {stdout}=await promisify(execFile)('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=10',host,`openclaw gateway call sessions.list --json --params '{"limit":10000}'`],{timeout:35000,maxBuffer:10*1024*1024});cached=sanitizeWhatsappDirectory(JSON.parse(stdout));return {...cached,stale:false};}
   catch{if(cached)return {...cached,stale:true};throw new ApiError(503,'OpenClaw connection unavailable. Refresh to try again.');}
  })().finally(()=>{pending=null;});
  return pending;
 }
 let value;try{value=JSON.parse(await readFile(path,'utf8'));}catch{throw new ApiError(503,'WhatsApp directory is unavailable. Check the OpenClaw connection and try again.');}
 if(!Array.isArray(value.rows)||!Number.isFinite(Date.parse(value.syncedAt)))throw new ApiError(503,'WhatsApp directory is unavailable.');
 return {...value,stale:Date.now()-Date.parse(value.syncedAt)>180000};
}
