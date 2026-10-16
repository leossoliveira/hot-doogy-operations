import {api} from './cloud.js';
import {escape as e} from './model.js';
import {hrDate} from './hr-model.js';
import {CAREERS_STATUSES,CAREERS_POSITIONS,CAREERS_HOURS,CAREERS_EXPERIENCE,CAREERS_ENGLISH,statusLabel,statusTone,fullName,availabilityDays,availabilityLines,filterApplications,careersSummary,reviewPayload} from './careers-model.js';
const when=iso=>iso?new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',month:'short',day:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(iso)):'—';
const day=iso=>iso?new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',month:'short',day:'2-digit'}).format(new Date(iso)):'—';
const kb=n=>n>=1048576?`${(n/1048576).toFixed(1)} MB`:`${Math.max(1,Math.round(n/1024))} KB`;
export function createCareers(ctx){
 let cache=null,loading=false,error='',loaded=false,query='',status='open',position='all',detail=null,saving=false,pendingRating;
 const visible=()=>ctx.state().route==='hr-careers';
 const location=id=>ctx.data()?.locations?.find(x=>x.id===id)?.name||'—';
 const where=a=>a.any_location?'Either location':location(a.preferred_location_id);
 const badge=s=>`<span class="status ${statusTone(s)}">${e(statusLabel(s))}</span>`;
 const stars=n=>`<span class="careers-stars" aria-label="${n?`Rated ${n} of 5`:'Not rated'}">${[1,2,3,4,5].map(i=>`<i class="${n>=i?'on':''}">★</i>`).join('')}</span>`;
 async function load(){if(loading)return;loading=true;error='';if(visible())ctx.render();try{cache=await api('/api/hr/careers');}catch(err){error=err.message;}finally{loading=false;loaded=true;if(visible())ctx.render();}}
 const filtered=()=>filterApplications(cache?.applications,{query,status,position,location:ctx.state().store});
 const stat=(label,value,sub)=>`<article class="stat-card"><div class="stat-top">${label}</div><div class="stat-value mono">${value}</div><div class="stat-bottom">${sub}</div></article>`;
 function toolbar(){return `<div class="toolbar hr-toolbar"><div class="input-wrap">${ctx.icon('search')}<input aria-label="Search candidates" data-careers-filter="query" placeholder="Search name, email, phone or reference" value="${e(query)}"></div><select aria-label="Status" data-careers-filter="status"><option value="open" ${status==='open'?'selected':''}>Open pipeline</option><option value="all" ${status==='all'?'selected':''}>All statuses</option>${CAREERS_STATUSES.map(([id,label])=>`<option value="${id}" ${status===id?'selected':''}>${label}</option>`).join('')}</select><select aria-label="Position" data-careers-filter="position"><option value="all">All positions</option>${Object.entries(CAREERS_POSITIONS).map(([id,label])=>`<option value="${id}" ${position===id?'selected':''}>${label}</option>`).join('')}</select><span class="spacer"></span><span class="muted" style="font-size:12px">${filtered().length} of ${cache.applications.length}</span></div>`;}
 function table(){const rows=filtered();return `<div class="table-wrap hr-table"><table><thead><tr>${['Candidate','Position','Location','Availability','Submitted','Status','Rating',''].map(x=>`<th>${x.toUpperCase()}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(a=>`<tr><td class="careers-candidate"><strong>${e(fullName(a))}</strong><small>${e(a.reference)} · ${e(a.city)}, ${e(a.state)}</small></td><td>${e(CAREERS_POSITIONS[a.position]||a.position)}</td><td>${e(where(a))}</td><td>${e(CAREERS_HOURS[a.hours_per_week]||'—')}<div class="careers-days">${availabilityDays(a.availability).map(d=>`<span>${d}</span>`).join('')}</div></td><td>${hrDate(a.created_at?.slice(0,10))}</td><td>${badge(a.status)}</td><td>${stars(a.rating)}</td><td>${ctx.btn('View','careers-view','',' ',`data-id="${a.id}" aria-label="View ${e(fullName(a))}"`)}</td></tr>`).join(''):`<tr><td colspan="8"><div class="empty"><h3>No applications match</h3><p>Adjust the filters, or share the careers site to receive applications.</p></div></td></tr>`}</tbody></table></div>`;}
 function page(){
  if(!loaded&&!loading)queueMicrotask(load);
  let html=ctx.heading('Human resources','Careers','Applications received from the careers site. Review, rate and move candidates forward.',ctx.btn('Refresh','careers-refresh','refresh-cw'));
  if(error)html+=ctx.notice(`Applications could not be loaded. ${error}`);
  if(!cache)return html+ctx.empty(loading?'Loading applications…':'Careers is ready',loading?'Retrieving candidates from the careers site.':'Applications will appear here once candidates apply.');
  const s=careersSummary(cache.applications);
  html+=`<div class="careers-stats">${stat('New',s.newCount,'Awaiting first review')}${stat('In progress',s.inProgress,'Reviewing, interview or offer')}${stat('Hired · 30 days',s.hired30,'Marked hired recently')}${stat('Received · 7 days',s.receivedWeek,`${s.total} total`)}</div>`;
  return html+`<section class="panel">${toolbar()}${table()}</section>`;
 }
 function pair(label,value){return `<div class="detail-pair"><small>${label}</small><strong>${value}</strong></div>`;}
 function fileCard(a,kind){const f=(cache.files||[]).find(x=>x.application_id===a.id&&x.kind===kind);if(!f)return `<div class="careers-file empty-file">${kind==='selfie'?'No selfie attached':'No resume attached'}</div>`;const href=`/api/hr/careers/${a.id}/files/${f.id}`;const preview=f.mime_type.startsWith('image/')?`<img src="${href}?inline=1" alt="${kind==='selfie'?'Selfie':'Attachment preview'}" loading="lazy">`:`<span class="careers-file-icon">${ctx.icon('file-text')}</span>`;return `<div class="careers-file">${preview}<div><strong>${e(f.file_name)}</strong><small>${kind==='selfie'?'Selfie':'Resume / supporting file'} · ${kb(f.size)}</small></div><a class="btn" href="${href}" download="${e(f.file_name)}">${ctx.icon('download')}Download</a></div>`;}
 function openDetail(id){
  const a=cache?.applications.find(x=>x.id===id);if(!a)return;detail={id,version:a.version};pendingRating=a.rating??null;
  const notes=(cache.notes||[]).filter(n=>n.application_id===id),events=(cache.events||[]).filter(x=>x.application_id===id);
  const eventText=x=>x.type==='submitted'?'Application submitted':x.type==='file_attached'?`${x.payload?.kind==='selfie'?'Selfie':'Resume'} attached`:x.type==='status_changed'?`${x.actor||'Team member'} moved to ${statusLabel(x.to_status)}`:x.type==='rated'?`${x.actor||'Team member'} rated ${x.payload?.to??'—'}/5`:x.type==='note_added'?`${x.actor||'Team member'} added a note`:x.type;
  const body=`<div class="careers-detail">
   <div class="careers-head">${badge(a.status)}<span>${e(a.reference)}</span><span>·</span><span>Submitted ${when(a.created_at)}</span>${a.reviewed_at?`<span>·</span><span>Last reviewed ${when(a.reviewed_at)}</span>`:''}<span class="spacer"></span>${stars(a.rating)}</div>
   <div class="careers-contact"><a href="mailto:${e(a.email)}">${ctx.icon('mail')}${e(a.email)}</a><a href="tel:${e(a.phone.replace(/[^\d+]/g,''))}">${ctx.icon('phone')}${e(a.phone)}</a><span class="status">${ctx.icon('map-pin')}${e(a.city)}, ${e(a.state)}</span>${a.locale==='pt'?'<span class="status">Applied in Portuguese</span>':''}</div>
   <section class="careers-section"><h3>Position</h3><div class="detail-grid">${pair('Position',e(CAREERS_POSITIONS[a.position]||a.position))}${pair('Preferred location',e(where(a)))}${pair('Eligibility',`${a.at_least_16?'16+':'Under 16'} · ${a.work_authorized?'Work authorized':'Not work authorized'}`)}</div></section>
   <section class="careers-section"><h3>Availability</h3><div class="detail-grid">${pair('Earliest start',hrDate(a.earliest_start))}${pair('Hours per week',e(CAREERS_HOURS[a.hours_per_week]||'—'))}${pair('Days',availabilityLines(a.availability).map(e).join('<br>')||'—')}</div></section>
   <section class="careers-section"><h3>Experience</h3><div class="detail-grid">${pair('Work experience',e(CAREERS_EXPERIENCE[a.work_experience]||'—'))}${pair('English',e(CAREERS_ENGLISH[a.english_proficiency]||'—'))}${pair('Other languages',e(a.other_languages||'—'))}</div>${a.pitch?`<blockquote class="careers-pitch">“${e(a.pitch)}”</blockquote>`:''}${a.referral_source?`<p class="muted" style="font-size:12px;margin:10px 0 0">Heard about us: ${e(a.referral_source)}</p>`:''}</section>
   <section class="careers-section"><h3>Files</h3><div class="careers-files">${fileCard(a,'resume')}${fileCard(a,'selfie')}</div></section>
   <section class="careers-section"><h3>Review</h3><form id="careers-review" class="careers-review"><div class="form-grid"><label>Status<select name="status">${CAREERS_STATUSES.map(([id,label])=>`<option value="${id}" ${a.status===id?'selected':''}>${label}</option>`).join('')}</select></label><label>Rating<span class="careers-rating" role="group" aria-label="Rating">${[1,2,3,4,5].map(i=>`<button type="button" data-action="careers-rate" data-rating="${i}" aria-pressed="${(a.rating||0)>=i}" aria-label="${i} star${i>1?'s':''}">★</button>`).join('')}<button type="button" class="careers-rating-clear" data-action="careers-rate" data-rating="">Clear</button></span></label></div><label>Add a note<textarea name="note" maxlength="4000" placeholder="Interview impressions, follow-ups, scheduling…"></textarea></label><div class="careers-review-foot"><p class="careers-error" id="careers-error" role="alert"></p>${ctx.btn('Save review','careers-save','check','primary')}</div></form></section>
   ${notes.length?`<section class="careers-section"><h3>Notes</h3><div class="careers-notes">${notes.map(n=>`<div class="careers-note">${e(n.body)}<small>${e(n.author||'Team member')} · ${when(n.created_at)}</small></div>`).join('')}</div></section>`:''}
   <section class="careers-section"><h3>Timeline</h3><ul class="careers-timeline">${events.map(x=>`<li><small>${when(x.created_at)}</small><span>${e(eventText(x))}</span></li>`).join('')||'<li>No activity yet.</li>'}</ul></section>
  </div>`;
  ctx.openModal(fullName(a),body,'',{kind:'careers',wide:true,subtitle:`${CAREERS_POSITIONS[a.position]||a.position} · ${where(a)}`});
 }
 function rate(el){const value=el.dataset.rating===''?null:Number(el.dataset.rating);pendingRating=value;document.querySelectorAll('#careers-review [data-rating]').forEach(b=>{if(b.dataset.rating!=='')b.setAttribute('aria-pressed',String(value!=null&&Number(b.dataset.rating)<=value));});}
 async function save(){
  if(saving||!detail)return;const form=document.querySelector('#careers-review'),errorEl=document.querySelector('#careers-error');if(!form)return;
  const current=cache.applications.find(x=>x.id===detail.id);
  let payload;try{payload=reviewPayload({id:detail.id,version:detail.version,status:form.elements.status.value,rating:pendingRating,clearRating:pendingRating==null&&current?.rating!=null,note:form.elements.note.value},current);}catch(err){errorEl.textContent=err.message;return;}
  saving=true;errorEl.textContent='';const button=form.querySelector('[data-action="careers-save"]');if(button)button.disabled=true;
  try{await api('/api/hr/careers/review',payload);ctx.close(true);await load();ctx.toast('Review saved.','check');}
  catch(err){errorEl.textContent=err.status===409?'This application changed. Close and reopen it to see the latest version.':err.message;}
  finally{saving=false;if(button)button.disabled=false;}
 }
 function changed(el){const key=el.dataset.careersFilter;if(!key)return false;if(key==='query')query=el.value;if(key==='status')status=el.value;if(key==='position')position=el.value;ctx.render();return true;}
 return {reset(){cache=null;loaded=false;error='';status='open';position='all';query='';detail=null;},page,changed,actions:{'careers-refresh':load,'careers-view':el=>openDetail(el.dataset.id),'careers-rate':rate,'careers-save':save}};
}
