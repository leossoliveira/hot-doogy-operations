// Calendar arithmetic uses date-only UTC values; today follows the stores' zone.
export const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export const PRESETS=[['today','Today'],['yesterday','Yesterday'],['this-week','This week'],['last-week','Last week'],['this-month','This month'],['last-month','Last month'],['this-year','This year'],['last-year','Last year']];
export function calendarDate(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return null;const d=new Date(`${value}T12:00:00Z`);return Number.isFinite(+d)&&d.toISOString().slice(0,10)===value?d:null;}
export const dateKey=d=>d.toISOString().slice(0,10);
export const addDays=(value,days)=>{const d=calendarDate(value);d.setUTCDate(d.getUTCDate()+days);return dateKey(d);};
export const storeToday=(now=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
export const displayDate=value=>calendarDate(value)?`${value.slice(5,7)}/${value.slice(8,10)}/${value.slice(0,4)}`:'mm/dd/yyyy';
export function monthDate(year,month,day=1){const d=new Date(0);d.setUTCFullYear(year,month,day);d.setUTCHours(12,0,0,0);return dateKey(d);}
export function calendarDays(year,month){const first=monthDate(year,month),start=addDays(first,-calendarDate(first).getUTCDay());return Array.from({length:42},(_,i)=>addDays(start,i));}
export function presetRange(preset,today=storeToday()){
 const d=calendarDate(today),y=d.getUTCFullYear(),m=d.getUTCMonth(),sunday=addDays(today,-d.getUTCDay());
 switch(preset){
 case 'today':return {start:today,end:today};
 case 'yesterday':return {start:addDays(today,-1),end:addDays(today,-1)};
 case 'this-week':return {start:sunday,end:today};
 case 'last-week':return {start:addDays(sunday,-7),end:addDays(sunday,-1)};
 case 'this-month':return {start:monthDate(y,m),end:today};
 case 'last-month':return {start:monthDate(y,m-1),end:addDays(monthDate(y,m),-1)};
 case 'this-year':return {start:monthDate(y,0),end:today};
 case 'last-year':return {start:monthDate(y-1,0),end:monthDate(y-1,11,31)};
 default:return null;
 }
}
export function selectCalendarDate(selection,value){
 if(selection.mode==='single')return {...selection,start:value,end:value,edge:'start'};
 if(selection.edge==='start')return {...selection,start:value,end:'',edge:'end'};
 const first=selection.start||value;return {...selection,start:first<value?first:value,end:first<value?value:first,edge:'start'};
}

export function compactDateLabel(start,end=start,today=storeToday()){
 const format=displayDate;
 if(!start&&!end)return 'mm/dd/yyyy';
 if(start===end||!end)return end===start?format(start):`${format(start)} – …`;
 if(!start)return `… – ${format(end)}`;
 return `${format(start)} – ${format(end)}`;
}
