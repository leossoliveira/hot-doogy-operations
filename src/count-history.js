// One row per completed count, never one row per counted item.
export function countSessions(observations=[],sessions=[]){
 const rows=new Map();
 for(const s of sessions.filter(s=>s.status==='completed'))rows.set(`${s.locationId}|${s.id}`,{id:s.id,locationId:s.locationId,employeeName:s.employeeName||'',countedAt:s.completedAt||null,date:s.countedOn||null});
 for(const o of observations){
  const id=o.sessionId||o.id,key=`${o.locationId}|${id}`;
  if(!rows.has(key))rows.set(key,{id,locationId:o.locationId,employeeName:o.employeeName||'',date:o.countedOn,countedAt:o.countedAt||null,countOffsetMinutes:o.deviceUtcOffsetMinutes});
 }
 return [...rows.values()];
}
export function historyRows(saved=[],local=[],locationId='all'){
 const rows=new Map();
 for(const s of [...saved,...local]){const key=`${s.locationId}|${s.id}`;if(!rows.has(key))rows.set(key,s);}
 return [...rows.values()].filter(s=>locationId==='all'||s.locationId===locationId).sort((a,b)=>String(b.countedAt||b.date||'').localeCompare(String(a.countedAt||a.date||''))||String(a.id).localeCompare(String(b.id)));
}
export function historyDateTime(s){
 const instant=s.countedAt?new Date(s.countedAt):null;
 if(!instant||!Number.isFinite(instant.getTime()))return {date:s.date?`${s.date.slice(5,7)}/${s.date.slice(8,10)}/${s.date.slice(0,4)}`:'Not recorded',time:'Not recorded'};
 const device=Number.isInteger(s.countOffsetMinutes),value=new Date(instant.getTime()-(device?s.countOffsetMinutes*60000:0)),timeZone=device?'UTC':'America/New_York';
 return {date:new Intl.DateTimeFormat('en-US',{timeZone,month:'2-digit',day:'2-digit',year:'numeric'}).format(value),time:new Intl.DateTimeFormat('en-US',{timeZone,hour:'2-digit',minute:'2-digit'}).format(value)};
}
