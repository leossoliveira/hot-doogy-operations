export const MY_DAY_ROUTES=[['my-day','Activity Board','layout-dashboard'],['my-day-tasks','Tasks','list-checks'],['my-day-procedures','Procedures','book-open']];
export const TASK_STATUSES=[['todo','To-do'],['doing','Doing'],['done','Done']];
export const TASK_PRIORITIES=[['urgent','Urgent'],['high','High'],['normal','Normal'],['low','Low']];
export const teamName=x=>[x?.first_name,x?.last_name].filter(Boolean).join(' ')||'Name not set';
export function filterTasks(tasks,{location='all',query='',status='all',priority='all',assignees='all',from='',to=''}={}){
 return tasks.filter(t=>(location==='all'||t.location_id===location)&&t.title.toLowerCase().includes(query.toLowerCase())&&(status==='all'||t.status===status)&&(priority==='all'||t.priority===priority)&&(assignees==='all'||assignees.includes(t.assignee_id))&&(!from||t.due_date>=from)&&(!to||t.due_date<=to)).sort((a,b)=>a.due_date.localeCompare(b.due_date)||TASK_PRIORITIES.findIndex(x=>x[0]===a.priority)-TASK_PRIORITIES.findIndex(x=>x[0]===b.priority)||a.title.localeCompare(b.title));
}
export const RECURRENCE_OPTIONS=[['none','Does not repeat'],['daily','Daily'],['weekdays','Every weekday (Mon–Fri)'],['weekly','Weekly'],['monthly','Monthly']];
const isoDate=date=>date.toISOString().slice(0,10);
export function shiftMonth(month,offset){const [year,m]=month.split('-').map(Number);return isoDate(new Date(Date.UTC(year,m-1+offset,1))).slice(0,7);}
export function monthCells(month){const [year,m]=month.split('-').map(Number);const first=new Date(Date.UTC(year,m-1,1)),last=new Date(Date.UTC(year,m,0));const count=Math.ceil((first.getUTCDay()+last.getUTCDate())/7)*7;return Array.from({length:count},(_,i)=>isoDate(new Date(Date.UTC(year,m-1,1-first.getUTCDay()+i))));}
export function recurringDates(start,until,rule){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(until)||!RECURRENCE_OPTIONS.some(([r])=>r===rule&&r!=='none'))return [];
 const first=new Date(start+'T00:00:00Z'),end=new Date(until+'T00:00:00Z');if(!Number.isFinite(+first)||!Number.isFinite(+end)||end<=first||end-first>365*86400000)return [];
 const result=[];for(let n=0;n<=366;n++){let next;if(rule==='monthly'){const base=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+n,1)),lastDay=new Date(Date.UTC(base.getUTCFullYear(),base.getUTCMonth()+1,0)).getUTCDate();next=new Date(Date.UTC(base.getUTCFullYear(),base.getUTCMonth(),Math.min(first.getUTCDate(),lastDay)));}else next=new Date(+first+n*(rule==='weekly'?7:1)*86400000);if(next>end)break;if(rule!=='weekdays'||(next.getUTCDay()>0&&next.getUTCDay()<6))result.push(isoDate(next));}return result;
}
