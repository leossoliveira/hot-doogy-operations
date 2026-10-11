import {usDate,usDateText} from './locale.js';
import {reportAnalytics,temporalPoints,chartNumber,referenceChart} from './report-analytics.js';
import {escape as e} from './model.js';

const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
const colors=['#356b50','#d49a19','#527aa4','#a56681','#7765a0'];
const pretty=s=>String(s||'Not recorded').replaceAll('_',' ');
const label=r=>[r.name].filter(Boolean).join(' · ');
const format=(v,unit)=>!finite(v)?'Unknown':new Intl.NumberFormat('en-US',{maximumFractionDigits:unit==='%'?1:2,...(unit==='USD'?{style:'currency',currency:'USD'}:{})}).format(v)+(unit==='%'?'%':unit&&unit!=='USD'?` ${unit}`:'');
function sumGroups(rows,key,value){
 const groups=new Map();
 for(const r of rows){const k=key(r);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r);}
 return [...groups].map(([name,group])=>({label:name,value:group.every(r=>finite(r[value]))?group.reduce((n,r)=>n+Number(r[value]),0):null}));
}
function top(points,absolute=false,limit=10){return points.filter(p=>finite(p.value)).sort((a,b)=>(absolute?Math.abs(b.value):b.value)-(absolute?Math.abs(a.value):a.value)||a.label.localeCompare(b.label)).slice(0,limit);}
// Charts consume the complete filtered result, never the current table page.
export function reportChartModel(report){
 const {id}=report.spec,rows=report.rows;
 const chart={kind:'bars',title:'Report overview',subtitle:'All matching rows · hover or focus a mark for details',unit:'',points:[],notes:[],total:rows.length};
 const bars=(title,points,unit='',target=null)=>Object.assign(chart,{title,points,unit,target});
 if(id==='sales'||id==='cash'){
  chart.kind='line';chart.unit='USD';chart.title=id==='sales'?'Daily net sales':'Recorded supplier payments over time';
  chart.points=temporalPoints(report);chart.interval=report.filters?.chartInterval==='week'?7:1;chart.view=report.filters?.chartView||'line';
  chart.unit=id==='sales'&&report.filters?.metric==='quantity'?'items':'USD';
  const metric=chart.unit==='items'?'items sold':report.filters?.metric==='grossSales'?'gross sales':'net sales';
  if(id==='sales')chart.title=`${chart.interval===7?'Weekly':'Daily'} ${metric}${report.comparison?' · period comparison':''}`;
  if(chart.interval===7)chart.notes.push('Weeks start Monday. Edge weeks may be partial; only recorded days contribute.');
  if(report.comparison){const c=report.comparison;chart.notes.push(`Selected: ${c.start} to ${c.end} · Previous: ${c.previousStart} to ${c.previousEnd}. Prior dates are aligned by day offset.`);chart.notes.push(c.change==null?'Percent change unavailable: every date and store needs a known amount in both periods, with a positive prior total.':`${chartNumber(c.change,'%')} versus the prior period. These are imported item sales, not settled payment totals.`);}
  chart.notes.push('Missing dates are gaps, not zero. Dates use New York time.');
  if(id==='cash')chart.notes.push('USD dated paid invoices only; not a complete bank cash-flow statement.');
 }else if(id==='mix'){
  const quantity=report.filters?.metric==='quantity';
  bars(quantity?'Top menu items by items sold':'Top menu items by net sales',top(sumGroups(rows,r=>r.name||'Unmapped product',quantity?'quantity':'netSales'),false,Number(report.filters?.chartLimit)||10),quantity?'items':'USD');chart.notes.push('Ranked menu items across selected stores. ABC remains based on net sales; signed adjustments are preserved.');
 }else if(id==='hours'){
  chart.kind='heatmap';chart.title='When sales happen';chart.unit='USD';
  const grouped=new Map();for(const r of rows){const key=`${r.weekday}|${r.hour}`,a=grouped.get(key)||[];a.push(r);grouped.set(key,a);}
  chart.points=[...grouped.values()].map(a=>({weekday:Number(a[0].weekday),hour:Number(a[0].hour),label:`${a[0].dayName} ${a[0].hourLabel}`,value:a.every(r=>finite(r.netSales))?a.reduce((s,r)=>s+Number(r.netSales),0):null}));
  chart.notes.push('Net sales across selected locations. Blank cells mean no available record.');
 }else if(id==='food-cost'){
  const byItem=new Map();for(const r of rows){const key=r.itemId||r.name;if(finite(r.foodCost)&&(!byItem.has(key)||r.foodCost>byItem.get(key).foodCost))byItem.set(key,r);}
  bars('Recipe food cost vs. 25% house target',top([...byItem.values()].map(r=>({label:r.name,value:r.foodCost}))),'%',25);
  chart.notes.push('Top 10 items by highest food cost percentage across selected stores. 25% is the HOT DOOGY planning target, not an industry benchmark. Current recipes; missing costs excluded.');
 }else if(id==='usage'){
  const unique=[...new Map(rows.map(r=>[JSON.stringify([r.itemId,r.locationId]),r])).values()];
  bars('Ingredient demand change',top(unique.map(r=>({label:label(r),value:r.variation})),true),'%');
  chart.notes.push('Top 10 absolute changes versus the prior comparable period. Shared supplier demand is counted once per item/location.');
 }else if(id==='purchases'){
  bars('Purchasing by supplier',top(sumGroups(rows.filter(r=>r.currency==='USD'),r=>r.supplier||'Unknown supplier','lineTotal')),'USD');
  chart.notes.push('Top 10 suppliers · USD invoice lines, excluding header taxes and fees. Credits remain negative.');
 }else if(id==='prices'){
  bars('Largest purchase price changes',top(rows.map(r=>({label:[label(r),r.supplier,r.date].filter(Boolean).join(' · '),value:r.change})),true),'%');
  chart.notes.push('Top 10 absolute changes versus the preceding approved price. Compare normalized base-unit costs.');
 }else if(id==='payables'){
  bars('Invoice amounts by financial status',sumGroups(rows.filter(r=>r.currency==='USD'),r=>pretty(r.status),'total'),'USD');
  chart.notes.push('USD invoice totals by current status; drafts and credits are shown separately, not added to unpaid balances.');
 }else if(id==='inventory'){
  bars('Largest physical count variances',top(rows.map(r=>({label:[label(r),r.area,r.date].filter(Boolean).join(' · '),value:finite(r.count)&&r.expected>0?(r.count-r.expected)/r.expected*100:null})),true),'%');
  chart.notes.push('Top 10 count observations: (counted − expected) ÷ expected. Missing or nonpositive expected counts are excluded.');
 }else if(id==='receiving'){
  bars('Order receipt completion',top(rows.map(r=>({label:[r.number,label(r)].filter(Boolean).join(' · '),value:finite(r.received)&&r.ordered>0?r.received/r.ordered*100:null})),false),'%',100);
  // Prioritize the least-complete comparable lines, without treating missing receipts as zero.
  chart.points=rows.filter(r=>finite(r.received)&&r.ordered>0).map(r=>({label:[r.number,label(r)].filter(Boolean).join(' · '),value:r.received/r.ordered*100})).sort((a,b)=>a.value-b.value||a.label.localeCompare(b.label)).slice(0,10);
  chart.notes.push('10 lowest completion rates for comparable order lines. Missing receipt evidence is excluded. Overreceipts may exceed 100%.');
 }else if(id==='production'){
  bars('Production output vs. plan',top(rows.map(r=>({label:[label(r),r.date].filter(Boolean).join(' · '),value:r.yield})),false),'%',100);
  chart.notes.push('Top 10 output attainment rates: actual ÷ planned output. This is not ingredient conversion yield.');
 }else if(id==='transfers'){
  bars('Transfer receipt completion',rows.filter(r=>finite(r.received)&&r.dispatched>0).map(r=>({label:[r.name,r.date].filter(Boolean).join(' · '),value:r.received/r.dispatched*100})).sort((a,b)=>a.value-b.value||a.label.localeCompare(b.label)).slice(0,10),'%',100);
  chart.notes.push('10 lowest receipt rates: received ÷ dispatched. Undispatched lines are excluded.');
 }else if(id==='waste'){
  bars('Recorded waste cost by reason',sumGroups(rows,r=>pretty(r.reason),'cost'),'USD');
  chart.notes.push('Estimated costs of recorded waste only. A reason with missing costs is not presented as a complete total.');
 }else if(id==='reorder'){
  // Percentages allow comparison without summing incompatible ordering units.
  const unique=[...new Map(rows.map(r=>[JSON.stringify([r.itemId,r.locationId]),r])).values()];
  bars('Physical count vs. reference demand',unique.filter(r=>finite(r.stock)&&r.current>0).map(r=>({label:label(r),value:r.stock/r.current*100})).sort((a,b)=>a.value-b.value||a.label.localeCompare(b.label)).slice(0,10),'%',100);
  chart.notes.push('10 lowest count-to-demand ratios. Last physical count ÷ selected-period demand; counts may be stale. Shared supplier items appear once.');
 }else if(id==='cogs'){
  chart.kind='donut';chart.title='Consumption cost data coverage';chart.unit='movements';
  chart.points=[{label:'Recorded cost available',value:rows.filter(r=>finite(r.cost)).length},{label:'Missing recorded cost',value:rows.filter(r=>!finite(r.cost)).length}];
  chart.notes.push('Counts of matching movements, not COGS amounts. Cost coverage alone does not certify inventory reconciliation.');
 }else{
  chart.kind='unavailable';chart.title=id==='tickets'?'Customer orders & average ticket':'Revenue, costs & net result';
  chart.notes.push(id==='tickets'?'The order-count and average-ticket chart needs verified customer-order data. Item sales cannot replace order totals.':'The income-statement chart needs reconciled COGS and operating expenses. Net profit cannot be inferred from recipe margins.');
 }
 const unknown=chart.points.filter(p=>!finite(p.value)).length;
 if(unknown)chart.notes.push(`${unknown} displayed groups or observations have unknown values and are omitted.`);
 chart.points=chart.points.filter(p=>finite(p.value)).map(p=>({...p,label:usDateText(p.label),value:Number(p.value)}));
 if(!rows.length||chart.kind==='donut'&&!chart.points.some(p=>p.value>0))chart.points=[];
 return chart;
}
const svg=(body,height=300)=>`<svg viewBox="0 0 960 ${height}" role="img" aria-label="Chart plot" class="report-chart-svg">${body}</svg>`;
const title=p=>`${p.label}${p.date?' · '+usDate(p.date):''}: `;
function bars(c){
 const height=Math.max(170,c.points.length*42+42),left=c.compact?360:330,right=c.compact?735:830,top=16,values=c.points.map(p=>p.value),min=Math.min(0,...values),max=Math.max(0,c.target||0,...values),span=max-min||1,x=v=>left+(v-min)/span*(right-left),zero=x(0);
 return svg(`<line x1="${zero}" x2="${zero}" y1="${top}" y2="${height-20}" class="chart-axis"/>${c.target!=null?`<line x1="${x(c.target)}" x2="${x(c.target)}" y1="${top}" y2="${height-20}" class="chart-target"/><text x="${x(c.target)}" y="12" text-anchor="middle" class="chart-tick">Target ${c.target}%</text>`:''}${c.points.map((p,i)=>{const y=top+i*42+12,full=title(p)+format(p.value,c.unit);return `<g tabindex="0" aria-label="${e(full)}"><title>${e(full)}</title><text x="${left-16}" y="${y+4}" text-anchor="end" class="chart-label">${e(p.label.length>(c.compact?32:46)?p.label.slice(0,c.compact?29:43)+'…':p.label)}</text><rect x="${Math.min(zero,x(p.value))}" y="${y-9}" width="${Math.max(p.value===0?2:0,Math.abs(x(p.value)-zero))}" height="22" rx="4" fill="${p.value<0?'#b9604b':colors[0]}"/><text x="${c.compact?755:850}" y="${y+5}" class="chart-value">${e(format(p.value,c.unit))}</text></g>`;}).join('')}`,height);
}
function line(c){
 const left=95,right=905,top=32,bottom=255,dates=[...new Set(c.points.map(p=>p.date))].sort(),stamp=d=>Date.parse(d+'T12:00:00Z'),a=stamp(dates[0]),b=stamp(dates.at(-1)),x=d=>a===b?(left+right)/2:left+(stamp(d)-a)/(b-a)*(right-left);
 const low=Math.min(0,...c.points.map(p=>p.value)),high=Math.max(0,...c.points.map(p=>p.value)),span=high-low||1,y=v=>bottom-(v-low)/span*(bottom-top),series=[...new Set(c.points.map(p=>p.label))].sort(),column=c.view==='bar',band=Math.min(42,(right-left)/Math.max(dates.length,1)*.7),zero=y(0);
 let body=Array.from({length:5},(_,i)=>{const value=low+span*i/4,py=y(value);return `<line x1="${left-25}" x2="${right+25}" y1="${py}" y2="${py}" class="chart-grid"/><text x="${left-32}" y="${py+4}" text-anchor="end" class="chart-tick">${e(format(value,c.unit))}</text>`;}).join('');
 let marks='';
 for(const [i,name] of series.entries()){
  const points=c.points.filter(p=>p.label===name).sort((a,b)=>a.date.localeCompare(b.date));let path='',last=null;
  for(const p of points){path+=(last&&stamp(p.date)-stamp(last)<=86400000*(c.interval||1)?' L':' M')+`${x(p.date)},${y(p.value)}`;last=p.date;}
  if(!column)body+=`<path d="${path}" fill="none" stroke="${colors[i%colors.length]}" stroke-width="3" ${points[0]?.previous?'stroke-dasharray="7 5"':''}/>`;
  marks+=points.map(p=>{const px=x(p.date)+(column?(i-(series.length-1)/2)*band/series.length:0),py=y(p.value),tx=Math.min(right-230,Math.max(left,px-115)),ty=py<105?py+18:py-80,full=title(p)+format(p.value,c.unit);return `<g class="chart-point" tabindex="0" aria-label="${e(full)}">${column?`<rect x="${px-band/series.length/2}" y="${Math.min(py,zero)}" width="${Math.max(2,band/series.length-2)}" height="${Math.max(2,Math.abs(zero-py))}" rx="3" fill="${colors[i%colors.length]}" fill-opacity="${p.previous?.55:.9}"/>`:`<circle cx="${px}" cy="${py}" r="12" fill="transparent"/><circle cx="${px}" cy="${py}" r="4" fill="${colors[i%colors.length]}"/>`}<g class="chart-tooltip" transform="translate(${tx},${ty})" aria-hidden="true"><rect width="230" height="64" rx="6"/><text x="10" y="18">${e(p.label)}</text><text x="10" y="36">${e(usDateText(p.originalDate||p.date))}${c.interval===7?' · week':''}</text><text x="10" y="54">${e(format(p.value,c.unit))}</text></g></g>`;}).join('');
 }
 const ticks=[...new Set(Array.from({length:Math.min(7,dates.length)},(_,i)=>Math.round(i*(dates.length-1)/Math.max(1,Math.min(7,dates.length)-1))))];body+=ticks.map(i=>`<text x="${x(dates[i])}" y="285" text-anchor="middle" class="chart-tick">${e(usDate(dates[i]))}</text>`).join('');
 return `<div class="report-chart-legend">${series.map((s,i)=>`<span><i style="background:${colors[i%colors.length]}"></i>${e(s)}${s==='Previous period'?' (aligned)':''}</span>`).join('')}</div>`+svg(body+marks,310);
}
function heatmap(c){
 const max=Math.max(1,...c.points.map(p=>Math.abs(p.value))),days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
 let body=days.map((d,i)=>`<text x="58" y="${49+i*34}" text-anchor="end" class="chart-tick">${d}</text>`).join('');
 body+=Array.from({length:24},(_,h)=>`<text x="${90+h*35}" y="20" text-anchor="middle" class="chart-tick">${String(h).padStart(2,'0')}</text>`).join('');
 for(let d=0;d<7;d++)for(let h=0;h<24;h++){const p=c.points.find(p=>p.weekday===d&&p.hour===h),value=p?format(p.value,'USD'):'No record',description=`${days[d]} ${String(h).padStart(2,'0')}:00 · ${value}`;body+=`<g tabindex="0" aria-label="${e(description)}"><title>${e(description)}</title><rect x="${74+h*35}" y="${29+d*34}" width="31" height="29" rx="4" fill="${!p?'#edf0ed':p.value<0?'#b9604b':colors[0]}" ${p?`fill-opacity="${0.16+0.84*Math.abs(p.value)/max}"`:''}/></g>`;}
 return svg(body,280)+`<div class="report-chart-legend"><span><i style="background:#edf0ed"></i>No record</span><span><i style="background:#356b50"></i>Darker = higher sales</span><span><i style="background:#b9604b"></i>Negative adjustment</span></div>`;
}
function donut(c){
 const total=c.points.reduce((s,p)=>s+p.value,0),circumference=2*Math.PI*82;let offset=0;
 const circles=c.points.map((p,i)=>{const length=p.value/total*circumference,part=`<circle cx="220" cy="140" r="82" fill="none" stroke="${colors[i%colors.length]}" stroke-width="28" stroke-dasharray="${length} ${circumference-length}" stroke-dashoffset="${-offset}" transform="rotate(-90 220 140)" tabindex="0" aria-label="${e(title(p)+format(p.value,c.unit))}"><title>${e(title(p)+format(p.value,c.unit))}</title></circle>`;offset+=length;return part;}).join('');
 return svg(circles+`<text x="220" y="139" text-anchor="middle" class="chart-total">${total}</text><text x="220" y="163" text-anchor="middle" class="chart-tick">movements</text>`+c.points.map((p,i)=>`<rect x="400" y="${88+i*55}" width="14" height="14" rx="3" fill="${colors[i%colors.length]}"/><text x="428" y="${100+i*55}" class="chart-label">${e(p.label)} · ${p.value} (${Math.round(p.value/total*100)}%)</text>`).join(''),280);
}
function chartControls(report){
 const f=report.filters||{},id=report.spec.id;
 const select=(key,label,options)=>`<select data-report-chart="${key}" aria-label="${label}">${options.map(([value,text])=>`<option value="${value}" ${String(f[key])===value?'selected':''}>${text}</option>`).join('')}</select>`;
 return `<div class="report-chart-controls">${id==='sales'?select('metric','Sales metric',[['netSales','Net sales'],['grossSales','Gross sales'],['quantity','Items sold']])+select('chartCompare','Compare sales',[['locations','Selected period'],['previous','Previous period']]):''}${['sales','cash'].includes(id)?select('chartInterval','Time grouping',[['day','Daily'],['week','Weekly']])+select('chartView','Chart style',[['line','Lines'],['bar','Columns']]):''}${id==='mix'?select('chartLimit','Number of ranked items',[['10','Top 10 items'],['20','Top 20 items']]):''}</div>`;
}
export function reportChart(report){
 const c=reportChartModel(report),reference=referenceChart(report),analytics=reportAnalytics(report);c.compact=!!analytics;if(reference){c.title=reference.title;c.notes=reference.notes;}const empty=(!c.points.length&&!reference)||c.kind==='unavailable';
 const plot=empty?`<div class="report-chart-empty"><svg viewBox="0 0 120 56" width="120" height="56" aria-hidden="true"><path d="M5 5v46h110" fill="none" stroke="#cbd5cb" stroke-width="2"/><path d="M18 39h16m12-11h16m12-9h16" stroke="#cbd5cb" stroke-width="6" stroke-linecap="round"/></svg><strong>${c.kind==='unavailable'?'Additional data required':'No chartable data for these filters'}</strong><span>${report.spec.id==='usage'||report.spec.id==='reorder'?'Choose a date range with available sales data.':'Unknown values are not plotted as zero.'}</span></div>`:reference?reference.plot:({line,heatmap,donut,bars}[c.kind](c));
 const primary=`<section class="panel report-chart" aria-label="${e(c.title)}"><div class="panel-head"><div><h2>${e(c.title)}</h2><p>${e(c.subtitle)}</p></div>${report.spec.id==='mix'?`<div class="report-metric-toggle" role="group" aria-label="Product mix metric"><button class="btn" data-action="report-metric" data-metric="netSales" aria-pressed="${report.filters?.metric!=='quantity'}">Net sales</button><button class="btn" data-action="report-metric" data-metric="quantity" aria-pressed="${report.filters?.metric==='quantity'}">Items sold</button></div>`:''}<span class="report-chart-badge">${{line:'Trend',heatmap:'Hourly pattern',bars:'Comparison',donut:'Coverage',unavailable:'Awaiting data'}[c.kind]}</span></div>${chartControls(report)}${report.comparison?`<div class="report-comparison-summary"><div><span>Selected period · recorded</span><strong>${e(format(report.comparison.currentTotal,c.unit))}</strong></div><div><span>Previous period · recorded</span><strong>${e(format(report.comparison.previousTotal,c.unit))}</strong></div><div><span>Change</span><strong>${e(format(report.comparison.change,'%'))}</strong></div></div>`:''}<div class="report-chart-plot chart-${c.kind}">${plot}</div><div class="report-chart-notes">${c.notes.map(n=>`<p>${e(usDateText(n))}</p>`).join('')}</div></section>`;
 return analytics?`<div class="report-chart-pair">${primary}<div class="panel report-chart-secondary">${analytics}</div></div>`:primary;
}
