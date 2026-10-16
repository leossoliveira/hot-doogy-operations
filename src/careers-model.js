// Careers: labels and pure helpers shared by the UI and tests. Values mirror the
// check constraints in supabase/migrations/20261016132000_careers_applications.sql.
export const CAREERS_STATUSES=[['new','New','amber'],['reviewing','Reviewing',''],['interview','Interview',''],['offer','Offer','green'],['hired','Hired','green'],['rejected','Rejected','red'],['archived','Archived','']];
export const CAREERS_OPEN=new Set(['new','reviewing','interview','offer']);
export const CAREERS_POSITIONS={team_member:'Crew Member',manager:'Manager'};
export const CAREERS_HOURS={under_15:'Under 15 h/week','15_25':'15–25 h/week','25_35':'25–35 h/week',full_time:'Full-time (35+ h)',flexible:'Flexible hours'};
export const CAREERS_EXPERIENCE={first_job:'First job',under_1_year:'Less than 1 year','1_3_years':'1–3 years','3_plus_years':'3+ years'};
export const CAREERS_ENGLISH={basic:'Basic',conversational:'Conversational',fluent:'Fluent',native:'Native'};
export const CAREERS_DAYS=[['sun','Sun','Sunday'],['mon','Mon','Monday'],['tue','Tue','Tuesday'],['wed','Wed','Wednesday'],['thu','Thu','Thursday'],['fri','Fri','Friday'],['sat','Sat','Saturday']];
export const statusLabel=s=>CAREERS_STATUSES.find(x=>x[0]===s)?.[1]||s;
export const statusTone=s=>CAREERS_STATUSES.find(x=>x[0]===s)?.[2]||'';
export const fullName=a=>[a.first_name,a.last_name].filter(Boolean).join(' ');
export function availabilityDays(availability){const on=new Set((availability||[]).map(x=>x.day));return CAREERS_DAYS.filter(([id])=>on.has(id)).map(([,short])=>short);}
export function availabilityLines(availability){return CAREERS_DAYS.flatMap(([id,,long])=>(availability||[]).filter(x=>x.day===id).map(x=>`${long} ${x.from}–${x.to}`));}
export function filterApplications(rows,{query='',status='open',position='all',location='all'}={}){
 const q=query.trim().toLowerCase();
 return (rows||[]).filter(a=>(status==='all'||(status==='open'?CAREERS_OPEN.has(a.status):a.status===status))
  &&(position==='all'||a.position===position)
  &&(location==='all'||a.any_location||a.preferred_location_id===location)
  &&(!q||`${a.first_name} ${a.last_name} ${a.email} ${a.phone} ${a.city} ${a.reference}`.toLowerCase().includes(q)));
}
export function careersSummary(rows,now=new Date()){
 const weekAgo=new Date(now.getTime()-7*86400000).toISOString(),monthAgo=new Date(now.getTime()-30*86400000).toISOString();
 const list=rows||[];
 return {newCount:list.filter(a=>a.status==='new').length,inProgress:list.filter(a=>['reviewing','interview','offer'].includes(a.status)).length,
  hired30:list.filter(a=>a.status==='hired'&&(a.reviewed_at||a.updated_at)>=monthAgo).length,receivedWeek:list.filter(a=>a.created_at>=weekAgo).length,total:list.length};
}
export function reviewPayload({id,version,status,rating,clearRating=false,note=''},current){
 if(!/^[a-f0-9-]{36}$/.test(id||'')||!Number.isInteger(version)||version<1)throw Error('Invalid application.');
 const payload={id,version};
 if(status&&status!==current?.status){if(!CAREERS_STATUSES.some(x=>x[0]===status))throw Error('Invalid status.');payload.status=status;}
 if(clearRating)payload.clearRating=true;else if(rating!=null&&rating!==''){const n=Number(rating);if(!Number.isInteger(n)||n<1||n>5)throw Error('Rating must be between 1 and 5.');if(n!==current?.rating)payload.rating=n;}
 const text=String(note||'').trim();if(text.length>4000)throw Error('Notes are limited to 4000 characters.');if(text)payload.note=text;
 if(!payload.status&&!payload.rating&&!payload.clearRating&&!payload.note)throw Error('Nothing to save.');
 return payload;
}
