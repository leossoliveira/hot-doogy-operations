import {createHash} from 'node:crypto';
import {ApiError} from './auth.mjs';
import {openClawCall,sanitizeHistory} from './doogy-chat.mjs';
import {bridgeRequest} from './doogy-bridge-client.mjs';
export function createAgentService(call=openClawCall){
 const authorize=(role,actor)=>{
  if(!['owner','admin'].includes(role))throw new ApiError(403,'Doogy AI is available to administrators only.');
  if(typeof actor!=='string'||!actor)throw new ApiError(400,'Invalid user.');
  return 'agent:main:hot-doogy:'+createHash('sha256').update(actor).digest('hex');
 };
 return {
  async history(role,actor){const sessionKey=authorize(role,actor);return sanitizeHistory(await call('chat.history',{sessionKey,limit:100}));},
  async send(role,actor,input){
   const sessionKey=authorize(role,actor);
   if(typeof input?.text!=='string'||!input.text.trim()||input.text.length>4000||! /^[0-9a-f-]{36}$/i.test(input.requestId||''))throw new ApiError(400,'Enter a message of up to 4,000 characters.');
   const idempotencyKey='doogy-agent-'+createHash('sha256').update(actor+':'+input.requestId).digest('hex');
   const result=await call('chat.send',{sessionKey,message:input.text,idempotencyKey,deliver:false});
   if(result?.error||result?.ok===false||!result?.runId)throw new ApiError(503,'Message acceptance could not be confirmed. Retry the same message.');
   return {accepted:true,runId:result.runId};
  }
 };
}
const service=createAgentService();
export const agentService=Object.fromEntries(['history','send'].map(action=>[action,async(role,actor,input)=>{
 if(!['owner','admin'].includes(role))throw new ApiError(403,'Doogy AI is available to administrators only.');
 return process.env.HOT_DOOGY_OPENCLAW_SOCKET?bridgeRequest('agent-'+action,{actor,input}):service[action](role,actor,input);
}]));
