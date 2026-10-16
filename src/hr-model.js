export const HR_ROUTES=[['hr-team','Team members','users-round'],['hr-permissions','Permissions','shield-check'],['hr-workday','Workday','clock-3'],['hr-payroll','Payroll','wallet'],['hr-careers','Careers','briefcase']];
export const PERMISSION_SETS=[['admin','Administrator','Workspace administration, HR and all locations. MFA required.'],['manager','Manager','Operational management within assigned locations; no HR access.'],['chef','Chef','Kitchen and operational tools within assigned locations; no HR access.'],['staff','Staff','Overview, preparation, inventory, transfers and recipes. Inventory counts can be saved.']];
export function laborCost(row){return Math.round(Number(row.regular_hours)*Number(row.hourly_rate)*100)+Math.round(Number(row.overtime_hours)*Number(row.overtime_rate)*100);}
export function payrollSummary(rows){const result=new Map();for(const r of rows){if(r.status!=='approved')continue;const key=r.team_member_id;const x=result.get(key)||{id:key,regularHours:0,overtimeHours:0,wagesCents:0,days:new Set()};x.regularHours+=Number(r.regular_hours);x.overtimeHours+=Number(r.overtime_hours);x.wagesCents+=laborCost(r);x.days.add(r.work_date);result.set(key,x);}return [...result.values()];}
export function hrDate(value){return /^\d{4}-\d{2}-\d{2}$/.test(value||'')?`${value.slice(5,7)}/${value.slice(8,10)}/${value.slice(0,4)}`:'—';}
export function hrToday(){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
// Dates are the imported New York business dates, inclusive at both ends.
export function laborCostPercent(wagesCents,facts,{start='',end='',location='all'}={}){
 const rows=(facts||[]).filter(r=>(location==='all'||r.locationId===location)&&(!start||(r.date||r.factDate)>=start)&&(!end||(r.date||r.factDate)<=end));
 if(!rows.length||rows.some(r=>r.netSales==null||!Number.isFinite(Number(r.netSales))))return null;
 const net=rows.reduce((total,r)=>total+Number(r.netSales),0);
 return net>0?wagesCents/net:null;
}
