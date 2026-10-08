// One row per completed count, never one row per counted item.
export function countSessions(observations=[],sessions=[],legacyLines=[]){
 const rows=new Map();
 for(const s of sessions.filter(s=>s.status==='completed'))rows.set(`${s.locationId}|${s.id}`,{id:s.id,locationId:s.locationId,status:s.status,employeeName:s.employeeName||'',countedAt:s.completedAt||null,date:s.countedOn||null,notes:s.notes||'',lines:legacyLines.filter(l=>l.sessionId===s.id),source:'legacy'});
 for(const o of observations){
  const id=o.sessionId||o.id,key=`${o.locationId}|${id}`;
  if(!rows.has(key))rows.set(key,{id,locationId:o.locationId,status:'completed',employeeName:o.employeeName||'',date:o.countedOn,countedAt:o.countedAt||null,countOffsetMinutes:o.deviceUtcOffsetMinutes,lines:[],source:'observations'});
  rows.get(key).lines.push({...o,itemId:o.inventoryItemId,qty:o.quantity});
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

export function groupCountLines(lines,items,locationId,query=''){
 const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const groups=new Map(),search=normalize(query);
 for(const line of lines){
  const item=items.find(x=>x.id===line.itemId&&x.locationId===locationId);
  const name=line.name||item?.name||line.itemId,sku=item?.sku||'';
  if(!normalize(name+' '+sku).includes(search))continue;
  const area=line.areaName||item?.areaName||'No storage area';
  if(!groups.has(area))groups.set(area,[]);
  groups.get(area).push({...line,displayName:name,sku});
 }
 return [...groups].sort(([a],[b])=>a.localeCompare(b)).map(([area,rows])=>({area,rows:rows.sort((a,b)=>a.displayName.localeCompare(b.displayName))}));
}
