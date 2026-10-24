import {withSalesComparison} from './report-analytics.js';
import {reportChart} from './report-charts.js';
import {createMultiSelect} from './multi-select.js';
import {openDatePicker,closeDatePicker,dateTriggerContent} from './date-picker.js';
import {REPORTS,REPORT_CATALOG,reportRoute,defaultReportFilters,buildReport,reportCsv,reportDay} from './reports-model.js';
import {escape as e} from './model.js';
import {usDate} from './locale.js';
const groups=['Sales','Costs','Purchasing','Operations'];
const icons={Sales:'chart-column',Costs:'chart-pie',Purchasing:'shopping-bag',Operations:'boxes'};
const labels={supplier:'Supplier',category:'Category',item:'Item',area:'Storage area',status:'Status',destination:'Destination',reason:'Waste reason',method:'Payment method',weekday:'Weekday',hour:'Hour',dateBasis:'Date basis'};
export function reportValue(value,type){
 if(value==null||value==='')return '—';
 if(type==='date')return usDate(reportDay(value)||String(value).slice(0,10));
 if(type==='money')return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value);
 if(type==='percent')return `${new Intl.NumberFormat('en-US',{maximumFractionDigits:1}).format(value)}%`;
 if(type==='number'||type==='decimal')return new Intl.NumberFormat('en-US',{maximumFractionDigits:type==='decimal'?6:3}).format(value);
 return String(value).replaceAll('_',' ');
}
export function createReportsUI({data,local,state,render,heading,btn,icon,download}){
 const saved=new Map();
 const currentId=()=>state().route.replace(/^report-/,'');
 const filters=()=>{const id=currentId();if(!saved.has(id))saved.set(id,defaultReportFilters());return saved.get(id);};
 const pickers=Object.fromEntries(['item','category'].map(key=>[key,createMultiSelect({action:`report-${key}-select`,label:labels[key],allSummary:'All',rows:()=>optionsFor(key,REPORTS.find(r=>r.id===currentId())).slice().sort((a,b)=>a.name.localeCompare(b.name)),current:()=>{const value=filters()[key];return value==='all'?value:Array.isArray(value)?value:[value];},onChange:value=>{filters()[key]=value;filters().page=1;render();},beforeOpen:()=>{closeDatePicker(false);Object.entries(pickers).forEach(([other,picker])=>{if(other!==key)picker.close(false);});}})]));
 function catalog(){
  return heading('Business intelligence','Reports','HOT DOOGY store operations: menu performance, food cost, vendor spending and inventory control.')+`<div class="reports-catalog">${groups.map(group=>`<section class="report-group"><div class="section-title">${icon(icons[group])} ${e(group)}</div><div class="report-cards">${REPORT_CATALOG.filter(r=>r.group===group&&!['tickets','pnl','cogs'].includes(r.id)).map(r=>`<a class="report-card" href="#${reportRoute(r.id)}" data-route="${reportRoute(r.id)}"><div class="report-card-title"><h2>${e(r.title)}</h2>${icon('arrow-up-right')}</div><p>${e(r.description)}</p><span class="report-tag">${['tickets','pnl','cogs'].includes(r.id)?'Data readiness':r.dateLabel?'Date filters':'Current catalog'}</span></a>`).join('')}</div></section>`).join('')}</div>`;
 }
 function optionsFor(key,spec){
  const d=data();
  if(key==='supplier')return d.suppliers||[];
  if(key==='destination')return d.locations||[];
  if(key==='area')return (d.supplierCatalog?.storageAreas||[]).filter(a=>state().store==='all'||a.locationId===state().store);
  if(key==='category')return ['sales','mix','hours','food-cost'].includes(spec.id)?d.costInputs?.categories||[]:d.supplierCatalog?.categories||[];
  if(key==='item')return spec.id==='food-cost'?(d.recipes||[]).filter(r=>r.type==='menu'):['sales','mix','hours'].includes(spec.id)?d.costInputs?.menus||[]:d.ingredientItems||[];
  const list=values=>values.map(id=>({id,name:id.replaceAll('_',' ')}));
  if(key==='status')return list(spec.id==='food-cost'?['above','within','incomplete']:spec.id==='prices'?['approved','pending','rejected']:['purchases','payables'].includes(spec.id)?['unpaid','overdue','paid','credit','draft','cancelled']:spec.id==='production'?['planned','in_progress','completed','cancelled']:spec.id==='transfers'?['draft','submitted','approved','partially_dispatched','dispatched','partially_received','completed','rejected','cancelled']:['draft','ordered','partially_received','received','completed','cancelled']);
  if(key==='weekday')return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((name,i)=>({id:String(i),name}));
  if(key==='hour')return Array.from({length:24},(_,i)=>({id:String(i).padStart(2,'0'),name:`${String(i).padStart(2,'0')}:00–${String(i).padStart(2,'0')}:59`}));
  if(key==='dateBasis')return [{id:'invoice',name:'Invoice date'},{id:'due',name:'Due date'}];
  if(key==='reason')return list([...new Set((d.waste||[]).map(w=>w.reason).filter(Boolean))]);
  if(key==='method')return list([...new Set((d.invoices||[]).map(i=>i.paymentMethod||'Not recorded'))]);
  return [];
 }
 function controls(spec,f){
  const select=(key,rows)=>`<select data-report-filter="${key}" aria-label="${e(labels[key])}">${key==='dateBasis'?'':`<option value="all">${e(labels[key])}: All</option>`}${rows.slice().sort((a,b)=>key==='weekday'||key==='hour'?0:a.name.localeCompare(b.name)).map(r=>`<option value="${e(r.id)}" ${f[key]===r.id?'selected':''}>${e(labels[key])}: ${e(r.name)}</option>`).join('')}</select>`;
  const ordered=[...spec.filters];
  if(ordered.includes('item')&&ordered.includes('category')){ordered.splice(ordered.indexOf('item'),1);ordered.splice(ordered.indexOf('category'),0,'item');}
  return `<section class="panel report-filter-panel" aria-label="Report filters"><div class="report-filters">${spec.dateLabel?`<button class="hd-date-trigger" data-action="report-calendar" aria-label="Date: select a single date or date range" aria-haspopup="dialog" aria-expanded="false">${dateTriggerContent(f.start,f.end)}</button>`:''}${ordered.map(key=>pickers[key]?pickers[key].trigger():select(key,optionsFor(key,spec))).join('')}<div class="report-filter-buttons">${btn('Apply filters','report-apply','filter','primary')}${btn('Clear Filters','report-reset','rotate-ccw')}</div></div></section>`;
 }

 function page(){
  const id=currentId(),spec=REPORTS.find(r=>r.id===id);if(!spec)return catalog();
  const f=filters();let result,error;
  try{result=withSalesComparison(buildReport(id,data(),f,state().store,local()),data(),local());}catch(err){error=err.message;}
  const total=result?.rows.length||0,size=f.pageSize==='all'?Math.max(total,1):Number(f.pageSize),pages=Math.max(1,Math.ceil(total/size));f.page=Math.min(f.page,pages);
  const from=(f.page-1)*size,visible=result?.rows.slice(from,from+size)||[];
  return heading(`Reports / ${spec.group}`,spec.title,spec.description,`<a class="btn" href="#reports" data-route="reports">${icon('arrow-left')} All reports</a>`+btn('Export CSV','report-export','download','',total?'':'disabled')+btn('Print all rows','report-print','printer'))+controls(spec,f)+(error?`<div class="notice" role="alert">${e(error)}</div>`:`<div class="report-summary">${result.metrics.map(m=>`<div class="stat-card"><div class="stat-top">${e(m.label)}</div><div class="stat-value">${e(reportValue(m.value,m.type))}</div></div>`).join('')}</div>${reportChart(result)}<section class="panel report-results"><div class="panel-head"><div><h2>Report results</h2><p>Unknown values appear as —. Export includes all matching rows.</p></div><label>Items per page <select data-report-size>${[25,50,100,'all'].map(n=>`<option value="${n}" ${String(f.pageSize)===String(n)?'selected':''}>${n==='all'?'All':n}</option>`).join('')}</select></label></div><div class="table-wrap" tabindex="0" role="region" aria-label="Scrollable report results"><table data-table-layout="rows"><thead><tr>${result.columns.map(c=>`<th aria-sort="${f.sort===c.key?(f.direction==='desc'?'descending':'ascending'):'none'}"><button class="report-sort" data-action="report-sort" data-key="${c.key}">${e(c.label)} ${f.sort===c.key?(f.direction==='asc'?'↑':'↓'):'↕'}</button></th>`).join('')}</tr></thead><tbody>${visible.length?visible.map(row=>`<tr>${result.columns.map(c=>`<td class="${['money','number','decimal','percent'].includes(c.type)?'report-numeric':''}">${e(reportValue(row[c.key],c.type))}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${result.columns.length}"><div class="empty"><h3>No results available</h3><p>Try another date range or selection. Missing records are not treated as zero.</p></div></td></tr>`}</tbody></table></div><div class="pagination"><span>${total?from+1:0}–${Math.min(from+size,total)} of ${total} rows</span><div class="pages">${btn('Previous','report-prev','','',f.page<=1?'disabled':'')}<span>${f.page} / ${pages}</span>${btn('Next','report-next','','',f.page>=pages?'disabled':'')}</div></div></section>`);
 }
 function apply(){
  const f=filters();for(const el of document.querySelectorAll('[data-report-filter]'))f[el.dataset.reportFilter]=el.value;
  f.page=1;render();
 }
 return {catalog,page,get filterOpen(){return Object.values(pickers).some(p=>p.isOpen);},closeFilters:()=>Object.values(pickers).forEach(p=>p.close(false)),actions:{
  'report-item-select':()=>pickers.item.open(),
  'report-category-select':()=>pickers.category.open(),
  'report-apply':apply,
  'report-metric':el=>{filters().metric=el.dataset.metric;filters().sort='';filters().page=1;render();},
  'report-calendar':anchor=>{const f=filters();openDatePicker({anchor,range:true,start:f.start,end:f.end,onApply:({start,end})=>{f.start=start;f.end=end;f.page=1;render();},onClear:()=>{f.start='';f.end='';f.page=1;render();}});},
  'report-print':()=>{const f=filters(),size=f.pageSize,page=f.page;f.pageSize='all';f.page=1;render();try{window.print();}finally{f.pageSize=size;f.page=page;render();}},
  'report-reset':()=>{Object.values(pickers).forEach(p=>p.close(false));saved.set(currentId(),defaultReportFilters());render();},
  'report-sort':el=>{const f=filters();f.direction=f.sort===el.dataset.key&&f.direction==='asc'?'desc':'asc';f.sort=el.dataset.key;render();},
  'report-prev':()=>{filters().page=Math.max(1,filters().page-1);render();},
  'report-next':()=>{filters().page++;render();},
  'report-export':()=>{const result=buildReport(currentId(),data(),filters(),state().store,local());download(`hot-doogy-${currentId()}.csv`,reportCsv(result),'text/csv;charset=utf-8');},
 },changed:el=>{if(el.matches('[data-report-chart]')){filters()[el.dataset.reportChart]=el.value;render();return true;}if(el.matches('[data-report-filter]')){apply();return true;}if(el.matches('[data-report-size]')){filters().pageSize=el.value;filters().page=1;render();return true;}return false;}};
}
