import {openClawCall} from './doogy-chat.mjs';
import {bridgeRequest} from './doogy-bridge-client.mjs';
import {ApiError} from './auth.mjs';
const uuid=/^[a-f0-9-]{36}$/i;
const clean=(value,limit)=>String(value||'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,limit);
export function assignmentMessage(job){
 const firstName=clean(job.name,160).split(/\s+/)[0]||'Team member';
 const due=clean(job.due_date,10);
 const dueDate=/^\d{4}-\d{2}-\d{2}$/.test(due)?`${due.slice(5,7)}/${due.slice(8,10)}/${due.slice(0,4)}`:due;
 const end=clean(job.ends_at,32);
 const timeMatch=end.match(/T(\d{2}):(\d{2})/);
 const completionTime=timeMatch?`${String((Number(timeMatch[1])%12)||12).padStart(2,'0')}:${timeMatch[2]} ${Number(timeMatch[1])>=12?'PM':'AM'}`:'';
 return [`Olá, ${firstName}!`,'','Nova tarefa atribuída:','',clean(job.title,160),
 clean(job.scope,900)||'Consulte os detalhes da tarefa no Activity Board.','',
 `Local: ${clean(job.location,100)}`,'',`Prazo: ${dueDate}${completionTime?` · ${completionTime}`:''}`].join('\n');
}
export async function sendAssignment(input,call=openClawCall){
 if(!input||!uuid.test(input.id||'')||!/^\+[1-9]\d{6,14}$/.test(input.phone||'')||typeof input.message!=='string'||!input.message.trim()||input.message.length>2400)throw new ApiError(400,'Invalid task notification.');
 const result=await call('send',{agentId:'main',accountId:'default',channel:'whatsapp',to:input.phone,message:input.message,idempotencyKey:'my-day-assignment-'+input.id});
 if(result?.error||result?.ok===false||!result?.messageId)throw new ApiError(503,'WhatsApp delivery was not confirmed.');
 return {messageId:String(result.messageId)};
}
const active=new Map();
export function dispatchTaskNotifications(auth,session){
 if(!['owner','admin','manager','chef'].includes(session.member.role)||active.has(session.user.id))return active.get(session.user.id);
 const rpc=(name,body={})=>auth.request('/rest/v1/rpc/'+name,{token:session.token,method:'POST',body});
 const work=(async()=>{for(let count=0;count<400;count++){
  const job=await rpc('my_day_whatsapp_claim');if(!job)return;
  let messageId=null;
  try{const input={id:job.id,phone:job.phone,message:assignmentMessage(job)};const result=process.env.HOT_DOOGY_OPENCLAW_SOCKET?await bridgeRequest('task-assignment',{input}):await sendAssignment(input);messageId=result.messageId;}catch{/* An uncertain delivery is never automatically resent. */}
  await rpc('my_day_whatsapp_finish',{p_id:job.id,p_claim:job.claim_id,p_message_id:messageId});
 }} )().catch(()=>{/* Persistent pending jobs resume on the assigning manager's next My Day visit. */}).finally(()=>active.delete(session.user.id));
 active.set(session.user.id,work);return work;
}
