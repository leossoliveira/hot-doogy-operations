import {escape as e} from './model.js';
import {calculateSalesPeriod,fullDayRange} from './period-model.js';
import {buildReport} from './reports-model.js';

export const known=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
const total=(rows,key)=>rows.length&&rows.every(r=>known(r[key]))?rows.reduce((s,r)=>s+Number(r[key]),0):null;
const day=86400000;
const shift=(date,n)=>new Date(Date.parse(date+'T12:00:00Z')+n*day).toISOString().slice(0,10);
export const chartNumber=(v,unit='')=>!known(v)?'—':new Intl.NumberFormat('en-US',{maximumFractionDigits:unit==='%'?1:2,...(unit==='USD'?{style:'currency',currency:'USD'}:{})}).format(v)+(unit==='%'?'%':unit&&unit!=='USD'?` ${unit}`:'');
export function groupedValues(rows,key,value){
 const groups=new Map();for(const r of rows){const name=key(r);if(!groups.has(name))groups.set(name,[]);groups.get(name).push(r);}
 return [...groups].map(([label,group])=>({label,value:total(group,value)}));
}
export function withSalesComparison(report,data,local){
 if(report.spec.id!=='sales'||report.filters.chartCompare!=='previous')return report;
 const dates=report.rows.map(r=>r.date).filter(Boolean).sort(),start=report.filters.start||dates[0],end=report.filters.end||dates.at(-1);
 if(!start||!end)return report;
 const length=Math.round((Date.parse(end)-Date.parse(start))/day)+1;
 const previousStart=shift(start,-length),previousEnd=shift(start,-1);
 const previous=buildReport('sales',data,{...report.filters,start:previousStart,end:previousEnd},report.location,local);
 const locations=(data.locations||[]).filter(l=>report.location==='all'||l.id===report.location).map(l=>l.id);
 const key=report.filters.metric==='quantity'?'quantity':report.filters.metric==='grossSales'?'grossSales':'netSales';
 const complete=(rows,first)=>locations.length>0&&rows.length===length*locations.length&&rows.every(r=>known(r[key]))&&locations.every(id=>new Set(rows.filter(r=>r.locationId===id).map(r=>r.date)).size===length)&&rows.every(r=>r.date>=first&&r.date<=shift(first,length-1));
 const currentTotal=total(report.rows,key),previousTotal=total(previous.rows,key);
 let importsComplete=false;try{importsComplete=calculateSalesPeriod(data,report.location,fullDayRange(start,end)).currentComplete&&calculateSalesPeriod(data,report.location,fullDayRange(previousStart,previousEnd)).currentComplete;}catch{}
 return {...report,comparison:{start,end,previousStart,previousEnd,length,rows:previous.rows.map(r=>({...r,originalDate:r.date,date:shift(r.date,length)})),currentTotal,previousTotal,change:importsComplete&&complete(report.rows,start)&&complete(previous.rows,previousStart)&&previousTotal>0&&known(currentTotal)?(currentTotal-previousTotal)/previousTotal*100:null}};
}
export function temporalPoints(report){
 const f=report.filters||{},key=report.spec.id==='cash'?'total':f.metric==='quantity'?'quantity':f.metric==='grossSales'?'grossSales':'netSales',weekly=f.chartInterval==='week',compare=f.chartCompare==='previous'&&report.comparison;
 const bucket=date=>weekly?shift(date,-((new Date(date+'T12:00:00Z').getUTCDay()+6)%7)):date;
 const source=report.rows.filter(r=>r.date&&(report.spec.id!=='cash'||r.currency==='USD')).map(r=>({...r,series:compare?'Selected period':r.location}));
 if(compare)source.push(...report.comparison.rows.map(r=>({...r,series:'Previous period'})));
 const groups=new Map();for(const r of source){const date=bucket(r.date),id=JSON.stringify([r.series,date]);if(!groups.has(id))groups.set(id,[]);groups.get(id).push(r);}
 return [...groups.values()].map(rows=>({label:rows[0].series,date:bucket(rows[0].date),value:total(rows,key),originalDate:rows[0].originalDate?(weekly?[...new Set(rows.map(r=>r.originalDate))].sort().filter((_,i,a)=>i===0||i===a.length-1).join(' – '):rows[0].originalDate):null,previous:rows[0].series==='Previous period',observations:rows.length})).filter(p=>known(p.value)).sort((a,b)=>a.date.localeCompare(b.date)||a.label.localeCompare(b.label));
}
export function paretoModel(rows,key='netSales',limit=10){
 const all=groupedValues(rows,r=>r.name||'Unmapped item',key).sort((a,b)=>(b.value??-Infinity)-(a.value??-Infinity));
 const valid=all.length>0&&all.every(p=>known(p.value)&&p.value>=0),sum=valid?all.reduce((s,p)=>s+p.value,0):null;let cumulative=0;
 return {total:sum,valid:valid&&sum>0,points:all.filter(p=>known(p.value)).slice(0,limit).map(p=>{cumulative+=p.value;return {...p,share:sum>0?p.value/sum*100:null,cumulative:sum>0?cumulative/sum*100:null};}),count:all.length};
}
const svg=(body,height=320)=>`<svg viewBox="0 0 960 ${height}" class="report-chart-svg analytics-svg" role="img" aria-label="Detailed chart">${body}</svg>`;
const tip=(x,y,lines)=>`<g class="chart-tooltip" transform="translate(${Math.min(610,Math.max(10,x))},${Math.max(5,y)})" aria-hidden="true"><rect width="335" height="${lines.length*22+16}" rx="7"/>${lines.map((line,i)=>`<text x="10" y="${25+i*22}">${e(line.length>35?line.slice(0,32)+'…':line)}</text>`).join('')}</g>`;
const mark=(body,x,y,lines)=>`<g class="chart-point" tabindex="0" aria-label="${e(lines.join(' · '))}">${body}${tip(x,y,lines)}</g>`;
const legend=items=>`<div class="report-chart-legend">${items.map(([name,color])=>`<span><i style="background:${color}"></i>${e(name)}</span>`).join('')}</div>`;
const panel=(title,description,body)=>`<section class="report-analysis" aria-label="${e(title)}"><div class="report-analysis-heading"><h3>${e(title)}</h3><p>${e(description)}</p></div><div class="report-chart-plot">${body}</div></section>`;
export function paretoChart(report){
 const quantity=report.filters?.metric==='quantity',unit=quantity?'items':'USD',c=paretoModel(report.rows,quantity?'quantity':'netSales',Number(report.filters?.chartLimit)||10);
 if(!c.valid)return panel('Sales concentration','Cumulative share requires complete, nonnegative values. Signed adjustments remain in the ranking above.','');
 const left=130,right=840,top=25,bottom=245,width=(right-left)/Math.max(c.points.length,1),max=Math.max(...c.points.map(p=>p.value),1),y=v=>bottom-v/max*(bottom-top),yp=v=>bottom-v/100*(bottom-top);
 let body=Array.from({length:5},(_,i)=>`<line class="chart-grid" x1="${left}" x2="${right}" y1="${yp(i*25)}" y2="${yp(i*25)}"/><text class="chart-tick" x="${left-10}" y="${yp(i*25)+4}" text-anchor="end">${e(chartNumber(max*i/4,unit))}</text><text class="chart-tick" x="${right+10}" y="${yp(i*25)+4}">${i*25}%</text>`).join('');
 body+=`<line class="chart-target" x1="${left}" x2="${right}" y1="${yp(80)}" y2="${yp(80)}"/><text class="chart-tick" x="${right}" y="${yp(80)-7}" text-anchor="end">80% concentration</text>`;
 body+=c.points.map((p,i)=>`<rect x="${left+i*width+width*.18}" y="${y(p.value)}" width="${width*.64}" height="${bottom-y(p.value)}" rx="4" fill="#356b50"/>`).join('');
 body+=`<path d="${c.points.map((p,i)=>`${i?'L':'M'}${left+(i+.5)*width},${yp(p.cumulative)}`).join(' ')}" fill="none" stroke="#d49a19" stroke-width="3"/>`;
 body+=c.points.map((p,i)=>{const x=left+(i+.5)*width;return mark(`<rect x="${left+i*width}" y="${top}" width="${width}" height="${bottom-top}" fill="transparent"/><circle cx="${x}" cy="${yp(p.cumulative)}" r="5" fill="#d49a19"/><text x="${x}" y="268" class="chart-tick" text-anchor="middle">#${i+1}</text>`,x-110,35,[p.label,chartNumber(p.value,unit),`${chartNumber(p.share,'%')} share · ${chartNumber(p.cumulative,'%')} cumulative`]);}).join('');
 return panel('Menu sales concentration',`Bars show the top ${c.points.length} of ${c.count} items. The line uses all items as its denominator. Ranks match the chart above.`,legend([[quantity?'Items sold':'Net sales','#356b50'],['Cumulative share','#d49a19']])+svg(body,290));
}
export function costScatterModel(rows){
 // One representative per item, matching the highest-known food-cost rule above.
 const items=new Map();for(const r of rows){if(!known(r.price)||!known(r.cost)||r.price<=0||!known(r.foodCost))continue;const key=r.itemId||r.name;if(!items.has(key)||r.foodCost>items.get(key).foodCost)items.set(key,r);}
 return [...items.values()].map(r=>({label:r.name,x:Number(r.price),y:Number(r.cost),margin:Number(r.price)-Number(r.cost),percent:Number(r.foodCost)}));
}
function scatter(report){
 const points=costScatterModel(report.rows);if(!points.length)return '';
 const left=85,right=890,top=30,bottom=265,maxX=Math.max(...points.map(p=>p.x))*1.1,maxY=Math.max(...points.map(p=>p.y),maxX*.25)*1.15,x=v=>left+v/maxX*(right-left),y=v=>bottom-v/maxY*(bottom-top);
 let body=Array.from({length:5},(_,i)=>`<line class="chart-grid" x1="${left}" x2="${right}" y1="${y(maxY*i/4)}" y2="${y(maxY*i/4)}"/><text class="chart-tick" x="${left-10}" y="${y(maxY*i/4)+4}" text-anchor="end">${e(chartNumber(maxY*i/4,'USD'))}</text><text class="chart-tick" x="${x(maxX*i/4)}" y="${bottom+22}" text-anchor="middle">${e(chartNumber(maxX*i/4,'USD'))}</text>`).join('');
 body+=`<path d="M${left},${bottom} L${right},${y(maxX*.25)} L${right},${bottom} Z" fill="#356b500b"/><line class="chart-target" x1="${left}" y1="${bottom}" x2="${right}" y2="${y(maxX*.25)}"/><text class="chart-tick" x="${right}" y="${y(maxX*.25)-8}" text-anchor="end">25% house target</text><text class="chart-tick" x="${left}" y="15">Recipe cost ($)</text><text class="chart-tick" x="490" y="315" text-anchor="middle">Menu price ($)</text>`;
 body+=points.map(p=>mark(`<circle cx="${x(p.x)}" cy="${y(p.y)}" r="7" fill="${p.percent>25?'#bb654b':'#356b50'}" fill-opacity=".75" stroke="white" stroke-width="1.5"/>`,x(p.x)-115,y(p.y)>130?y(p.y)-95:y(p.y)+12,[p.label,`Price ${chartNumber(p.x,'USD')} · Cost ${chartNumber(p.y,'USD')}`,`Contribution ${chartNumber(p.margin,'USD')}`,`Food cost ${chartNumber(p.percent,'%')}`])).join('');
 return panel('Menu price & recipe cost',`${points.length} menu items. Points above the target line exceed the house food-cost goal. Contribution excludes labor, overhead and selling fees.`,legend([['Within house target','#356b50'],['Above house target','#bb654b']])+svg(body,330));
}
export function breakdownModel(report){
 const rows=report.rows,id=report.spec.id;
 if(id==='hours')return {title:'Sales by daypart',description:'Totals across the selected dates, not average sales per service. House dayparts use New York time.',unit:'USD',points:groupedValues(rows,r=>{const h=Number(r.hour);return h<6?'Overnight · 12–6 AM':h<11?'Breakfast · 6–11 AM':h<15?'Lunch · 11 AM–3 PM':h<17?'Afternoon · 3–5 PM':h<21?'Dinner · 5–9 PM':'Late night · 9 PM–12 AM';},'netSales')};
 if(id==='purchases'||id==='cash'||id==='waste')return {title:id==='waste'?'Highest-loss days':id==='cash'?'Payments by method':'Highest-spend purchase days',description:'Signed recorded amounts. Missing dates or unknown amounts are not replaced with zero.',unit:'USD',points:groupedValues(rows.filter(r=>(id==='waste'||r.currency==='USD')&&(id==='cash'||r.date)),r=>id==='cash'?r.method||'Not recorded':r.date,id==='waste'?'cost':id==='cash'?'total':'lineTotal')};
 if(id==='payables')return {title:'Unpaid invoices by vendor',description:'Unpaid and overdue USD invoice totals; not a partial-payment balance.',unit:'USD',points:groupedValues(rows.filter(r=>['unpaid','overdue'].includes(r.status)&&r.currency==='USD'),r=>r.supplier||'Unknown vendor','total')};
 return null;
}
function breakdown(report){
 const c=breakdownModel(report);if(!c)return '';const points=c.points.filter(p=>known(p.value)).sort((a,b)=>b.value-a.value).slice(0,8);if(!points.length)return '';
 const max=Math.max(1,...points.map(p=>Math.abs(p.value))),height=points.length*38+24;
 const body=points.map((p,i)=>{const py=20+i*38,len=Math.abs(p.value)/max*520;return mark(`<text class="chart-label" x="245" y="${py+5}" text-anchor="end">${e(p.label.length>24?p.label.slice(0,21)+'…':p.label)}</text><rect x="265" y="${py-10}" width="${len}" height="22" rx="4" fill="${p.value<0?'#bb654b':'#527aa4'}"/><text class="chart-value" x="810" y="${py+5}">${e(chartNumber(p.value,c.unit))}</text>`,400,Math.max(0,py-50),[p.label,chartNumber(p.value,c.unit)]);}).join('');
 return panel(c.title,c.description+' Up to 8 groups, ranked by amount; negative amounts are shown in red.',svg(body,height));
}
export function reportAnalytics(report){
 if(report.spec.id==='mix')return paretoChart(report);
 if(report.spec.id==='food-cost')return scatter(report);
 return breakdown(report);
}

export function referenceModel(report){
 const config={inventory:['count','expected','Counted','Expected'],production:['actual','planned','Actual output','Planned output'],receiving:['received','ordered','Received','Ordered'],transfers:['received','dispatched','Received','Dispatched'],usage:['current','previous','Current demand','Prior demand'],reorder:['stock','current','Last count','Reference demand'],prices:['baseCost','previous','Current base cost','Prior approved cost']}[report.spec.id];
 if(!config)return null;
 const [actual,expected,actualLabel,expectedLabel]=config;
 let rows=report.rows;if(['usage','reorder'].includes(report.spec.id))rows=[...new Map(rows.map(r=>[JSON.stringify([r.itemId,r.locationId]),r])).values()];
 return {actualLabel,expectedLabel,total:rows.length,points:rows.filter(r=>known(r[actual])&&known(r[expected])&&r[expected]>0).map(r=>({label:[r.name,r.location,r.date].filter(Boolean).join(' · '),actual:Number(r[actual]),expected:Number(r[expected]),unit:report.spec.id==='prices'?`USD/${r.unit||'base unit'}`:r.unit||'',ratio:Number(r[actual])/Number(r[expected])*100})).sort((a,b)=>Math.abs(b.ratio-100)-Math.abs(a.ratio-100)||a.label.localeCompare(b.label)).slice(0,10)};
}
export function referenceChart(report){
 const c=referenceModel(report);if(!c?.points.length)return null;
 const left=340,right=790,top=38,height=c.points.length*43+65,lo=Math.min(0,...c.points.map(p=>p.ratio)),hi=Math.max(120,...c.points.map(p=>p.ratio)),x=v=>left+(v-lo)/(hi-lo)*(right-left);
 let body=Array.from({length:5},(_,i)=>{const v=lo+(hi-lo)*i/4;return `<line class="chart-grid" x1="${x(v)}" x2="${x(v)}" y1="25" y2="${height-20}"/><text class="chart-tick" x="${x(v)}" y="15" text-anchor="middle">${e(chartNumber(v,'%'))}</text>`;}).join('');
 body+=`<line class="chart-target" x1="${x(100)}" x2="${x(100)}" y1="25" y2="${height-20}"/>`;
 body+=c.points.map((p,i)=>{const y=top+i*43,color=p.ratio<100?'#527aa4':'#bb654b';return mark(`<text class="chart-label" x="${left-15}" y="${y+5}" text-anchor="end">${e(p.label.length>42?p.label.slice(0,39)+'…':p.label)}</text><line x1="${x(100)}" x2="${x(p.ratio)}" y1="${y}" y2="${y}" stroke="${color}" stroke-width="5" stroke-linecap="round"/><circle cx="${x(100)}" cy="${y}" r="5" fill="white" stroke="#96a48d" stroke-width="2"/><circle cx="${x(p.ratio)}" cy="${y}" r="7" fill="${color}"/><text class="chart-value" x="815" y="${y+5}">${p.ratio>=100?'+':''}${e(chartNumber(p.ratio-100,'%'))}</text>`,Math.min(x(p.ratio)-110,690),y>120?y-94:y+12,[p.label,`${c.actualLabel}: ${chartNumber(p.actual,p.unit)}`,`${c.expectedLabel}: ${chartNumber(p.expected,p.unit)}`,`Variance: ${chartNumber(p.ratio-100,'%')}`]);}).join('');
 return {title:`${c.actualLabel} vs. ${c.expectedLabel.toLowerCase()}`,plot:legend([[c.expectedLabel+' = 100%','#96a48d'],['Below reference','#527aa4'],['Above reference','#bb654b']])+svg(body,height),notes:[`Up to 10 largest relative gaps from ${c.total} matching observations. Hollow dots mark the reference; filled dots mark actual values. Hover or focus for original quantities and units.`, 'Positive, known references only. Different units are compared as ratios, never added. Percentage labels show deviation from the reference; colors indicate direction, not performance.',...(report.spec.id==='reorder'?['Last counts may be stale. Reference demand is the selected sales period, not a safety-stock target.']:[])]};
}
