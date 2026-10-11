import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {ApiError} from './auth.mjs';

const quote=value=>"'"+String(value).replaceAll("'","'\\''")+"'";
const methods=new Set(['sessions.list','chat.history','send','config.get','config.patch']);
export async function openClawCall(method,params){
 if(!methods.has(method))throw new ApiError(400,'Unsupported conversation action.');
 const host=process.env.HOT_DOOGY_OPENCLAW_SSH_HOST;
 if(!host||!/^[a-zA-Z0-9_.@-]+$/.test(host)||host.startsWith('-'))throw new ApiError(503,'The interactive OpenClaw connection is unavailable.');
 try{
  const command=`openclaw gateway call ${quote(method)} --json --timeout 20000 --params ${quote(JSON.stringify(params))}`;
  const {stdout}=await promisify(execFile)('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=8',host,command],{timeout:28000,maxBuffer:10*1024*1024});
  return JSON.parse(stdout);
 }catch(error){
  if(method==='config.patch'&&/baseHash|config changed|configuration changed/i.test(error.stderr||''))throw new ApiError(409,'Conversation settings changed. Reopen settings before saving.');
  throw new ApiError(503,method==='send'?'Delivery could not be confirmed. Retry the same message to check it without sending a duplicate.':'OpenClaw is unavailable. Try again.');
 }
}
export function sanitizeHistory(value){
 const messages=[];
 for(const [index,m] of (value.messages||[]).entries()){
  if(!['user','assistant'].includes(m.role))continue;
  const content=typeof m.content==='string'?m.content:(Array.isArray(m.content)?m.content.filter(x=>x.type==='text').map(x=>x.text||'').join('\n'):'');
  if(!content.trim()||['NO_REPLY','HEARTBEAT_OK'].includes(content.trim()))continue;
  messages.push({id:String(m.__openclaw?.id||m.id||`${m.timestamp}-${index}`),role:m.role,text:content,timestamp:m.timestamp||null});
 }
 return {messages,hasMore:!!value.hasMore,nextOffset:Number.isInteger(value.nextOffset)?value.nextOffset:null};
}
const chatId=s=>`${s.origin?.accountId||'default'}:${s.origin?.to||s.key}`;
export function conversationSettings(config,s){
 const wa=config.config?.channels?.whatsapp||{},account=s.origin?.accountId||'default',accountConfig=wa.accounts?.[account];
 const section=s.kind==='group'?'groups':'direct',target=s.origin?.to;
 const map=accountConfig?.[section]??wa[section]??{},specific=map[target]||{},defaults=map['*']||{};
 return {version:config.hash,prompt:specific.systemPrompt??'',inheritedPrompt:defaults.systemPrompt||'',requireMention:specific.requireMention??defaults.requireMention??true,activationOverride:s.groupActivation||null,kind:s.kind==='group'?'group':'direct',account,model:s.model||'',path:accountConfig?.[section]?['channels','whatsapp','accounts',account,section,target]:['channels','whatsapp',section,target]};
}
export function buildSettingsPatch(settings,input){
 if(typeof input.prompt!=='string'||input.prompt.length>20000||typeof input.version!=='string'||input.version!==settings.version)throw new ApiError(409,'Conversation settings changed or are invalid. Reopen settings before saving.');
 if(settings.kind==='group'&&typeof input.requireMention!=='boolean')throw new ApiError(400,'Choose when the assistant should reply.');
 // Only this conversation's prompt/mention setting may change, never account access or tool permissions.
 const value={systemPrompt:input.prompt,...settings.kind==='group'&&!settings.activationOverride?{requireMention:input.requireMention}:{}};
 let patch=value;for(const part of [...settings.path].reverse()){if(!part||['__proto__','constructor','prototype'].includes(part))throw new ApiError(400,'Invalid conversation.');patch={[part]:patch};}
 return {raw:JSON.stringify(patch),baseHash:input.version,note:'Conversation instructions updated from Doogy AI'};
}
export function createConversationService(call=openClawCall){
 const attempts=new Map();
 async function resolve(role,id){
  if(!['owner','admin'].includes(role))throw new ApiError(403,'Doogy AI is available to administrators only.');
  if(typeof id!=='string'||id.length>512)throw new ApiError(400,'Invalid conversation.');
  const v=await call('sessions.list',{limit:10000});
  if(!Array.isArray(v.sessions)||v.hasMore)throw new ApiError(503,'Conversation directory is incomplete.');
  const s=v.sessions.filter(s=>s.channel==='whatsapp'&&chatId(s)===id).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0))[0];
  if(!s?.origin?.to||!s.key)throw new ApiError(404,'Conversation not found.');return s;
 }
 return {
  async history(role,id,offset=0){
   if(!Number.isInteger(offset)||offset<0||offset>1000000)throw new ApiError(400,'Invalid history page.');
   const s=await resolve(role,id);return sanitizeHistory(await call('chat.history',{sessionKey:s.key,offset,limit:100,maxBytes:500000,maxChars:100000}));
  },
  async settings(role,id){const s=await resolve(role,id);const {path,...safe}=conversationSettings(await call('config.get',{}),s);return safe;},
  async saveSettings(role,id,input){const s=await resolve(role,id);const config=await call('config.get',{});await call('config.patch',buildSettingsPatch(conversationSettings(config,s),input));return {saved:true};},
  async send(role,actor,id,input){
   if(!['owner','admin'].includes(role))throw new ApiError(403,'Doogy AI is available to administrators only.');
   if(typeof input.text!=='string'||!input.text.trim()||input.text.length>4000||! /^[0-9a-f-]{36}$/i.test(input.requestId||''))throw new ApiError(400,'Enter a message of up to 4,000 characters.');
   const key=createHash('sha256').update(JSON.stringify([actor,id,input.requestId])).digest('hex');
   for(const [k,a] of attempts)if(!a.pending&&Date.now()-a.createdAt>86400000)attempts.delete(k);
   const textHash=createHash('sha256').update(input.text).digest('hex');
   const prior=attempts.get(key);if(prior){if(prior.textHash!==textHash)throw new ApiError(409,'Retry the original message before changing it.');if(prior.result)return prior.result;if(prior.pending)return prior.pending;}
   if(!prior&&attempts.size>=5000)throw new ApiError(429,'Too many send requests. Try again later.');
   const attempt=prior||{textHash,createdAt:Date.now()};attempts.set(key,attempt);
   // Gateway idempotency also protects retries after this process restarts.
   attempt.pending=(async()=>{const s=await resolve(role,id);const result=await call('send',{channel:'whatsapp',accountId:s.origin.accountId||'default',to:s.origin.to,sessionKey:s.key,message:input.text,idempotencyKey:'doogy-'+key});
    if(result?.error||result?.ok===false||!result?.messageId)throw new ApiError(503,'Delivery could not be confirmed. Retry the same message.');
    attempt.result={sent:true,messageId:result?.messageId||null};return attempt.result;
   })().finally(()=>{attempt.pending=null;});return attempt.pending;
  }
 };
}
export const conversationService=createConversationService();
