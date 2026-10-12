import {api} from './cloud.js';
import {escape as e} from './model.js';
export function createDoogyAgent(ctx){
 let current=null,draft='',pending=null,messages=[],sending=false;
 const suggestions=[['Sales trends','How did net sales and items sold change over the last 7 available days compared with the previous period?'],['Menu margins','Which menu items exceed our 25% food-cost target, and what should we review first?'],['Stock priorities','Which ingredients need attention based on the latest counts and recent usage?'],['Waste opportunities','Which items and reasons account for the highest recorded waste cost this month?']];
 const $=s=>document.querySelector(s);
 const active=c=>current===c&&!!$('#doogy-agent-chat');
 function paint(c){
  if(!active(c))return;
  const list=$('#doogy-agent-messages'),nearBottom=list.scrollHeight-list.scrollTop-list.clientHeight<80;
  list.innerHTML=messages.length?messages.map(m=>`<article class="doogy-message ${m.role==='user'?'outgoing':'incoming'}"><header><strong>${m.role==='user'?'You':'Doogy AI'}</strong></header><div>${e(m.text)}</div></article>`).join(''):'<div class="doogy-agent-welcome"><h3>How can I help?</h3><p>Ask Doogy AI a question about your operation.</p><div class="doogy-suggestions">'+suggestions.map(([label,text],i)=>`<button type="button" data-doogy-suggestion="${i}"><strong>${e(label)}</strong><span>${e(text)}</span></button>`).join('')+'</div></div>';
  if(messages.length&&(nearBottom||c.first))list.scrollTop=list.scrollHeight;c.first=false;
 }
 async function refresh(c){
  if(!active(c)||c.loading)return;c.loading=true;
  try{const result=await api('/api/doogy-ai/agent/history');if(!active(c))return;if(JSON.stringify(messages)!==JSON.stringify(result.messages)){messages=result.messages;paint(c);}$('#doogy-agent-error').textContent='';}
  catch(error){c.blocked=[401,403].includes(error.status);if(active(c))$('#doogy-agent-error').textContent=error.message;}
  finally{c.loading=false;if(active(c)&&!c.blocked)c.timer=setTimeout(()=>refresh(c),5000);}
 }
 function open(){
  if(current?.timer)clearTimeout(current.timer);
  const c=current={first:true};
  ctx.openModal(`<span class="doogy-agent-title">${ctx.icon('bot')} Doogy AI</span>`,`<div id="doogy-agent-chat"><div id="doogy-agent-messages" class="doogy-messages" role="log" aria-live="polite" aria-label="Conversation with Doogy AI"></div><p id="doogy-agent-error" class="error-text" role="alert"></p></div>`,`<div class="doogy-compose"><label class="sr-only" for="doogy-agent-message">Message to Doogy AI</label><textarea id="doogy-agent-message" rows="2" maxlength="4000" placeholder="Ask Doogy AI…" ${pending||sending?'readonly':''}>${e(pending?.text??draft)}</textarea><div><span id="doogy-agent-status" role="status"></span>${ctx.btn(pending?'Retry message':'Send','doogy-agent-send','send','primary',sending?'disabled':'')}</div></div>`,{className:'doogy-agent-modal'});
  if(!active(c))return;
  $('#doogy-agent-message').addEventListener('input',event=>{draft=event.target.value;});
  $('#doogy-agent-message').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();send();}});
  $('#doogy-agent-messages').addEventListener('click',event=>{const button=event.target.closest('[data-doogy-suggestion]');if(!button||pending||sending)return;draft=suggestions[Number(button.dataset.doogySuggestion)][1];$('#doogy-agent-message').value=draft;$('#doogy-agent-message').focus();});
  paint(c);refresh(c);
 }
 async function send(){
  const c=current;if(!active(c)||sending)return;
  const text=pending?.text??$('#doogy-agent-message').value;if(!text.trim())return;
  pending??={text,requestId:crypto.randomUUID()};sending=true;
  const button=$('[data-action="doogy-agent-send"]');button.disabled=true;$('#doogy-agent-message').readOnly=true;$('#doogy-agent-status').textContent='Sending…';
  try{await api('/api/doogy-ai/agent/send',pending);pending=null;draft='';if(active(current)){$('#doogy-agent-message').value='';$('#doogy-agent-message').readOnly=false;$('#doogy-agent-status').textContent='Message sent. The agent’s reply will appear here.';$('[data-action="doogy-agent-send"]').innerHTML='Send';clearTimeout(current.timer);await refresh(current);}}
  catch(error){if(active(current)){$('#doogy-agent-status').textContent=error.message;$('[data-action="doogy-agent-send"]').textContent='Retry message';}}
  finally{sending=false;if(active(current))$('[data-action="doogy-agent-send"]').disabled=false;}
 }
 return {open,send};
}
