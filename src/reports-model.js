import {foodCostRows} from './food-cost.js';
import {purchasingRows,purchasingDemand,validateOrderDates} from './purchasing-model.js';
import {financialStatus} from './invoice-financial.js';
import {toLocalDateTime,calculateSalesPeriod,fullDayRange} from './period-model.js';
import {safeCsv,norm} from './model.js';

const template=(id,title,group,description,filters,dateLabel='Record date')=>({id,title,group,description,filters,dateLabel});
export const REPORTS=[
 template('sales','Sales by location','Sales','Compare daily revenue, discounts and quantities across locations.',['category','item'],'Sale date'),
 template('mix','Product sales & ABC','Sales','Rank products by net sales and inspect the sales mix.',['category','item'],'Sale date'),
 template('hours','Sales by hour & weekday','Sales','Find busy hours and weekdays using transaction timestamps.',['category','item','weekday','hour'],'Sale date'),
 template('food-cost','Food cost & theoretical margin','Costs','Ingredient and packaging costs compared with current selling prices.',['category','item','status'],null),
 template('usage','Theoretical ingredient usage','Costs','Sales-derived demand using recipes and unit conversions.',['supplier','item'],'Sale date'),
 template('purchases','Purchases by supplier & item','Purchasing','Invoice-line purchases, quantities and spending by supplier.',['supplier','category','item','status'],'Invoice date'),
 template('prices','Purchase price changes','Purchasing','Price history and comparable changes per base unit.',['supplier','category','item','status'],'Price effective date'),
 template('payables','Accounts payable & invoices','Purchasing','Invoice balances by recorded status, supplier and due date.',['supplier','status','dateBasis'],'Invoice date / due date'),
 template('inventory','Inventory counts & variances','Operations','Completed physical counts and recorded expected quantities by area.',['category','item','area'],'Count date'),
 template('receiving','Orders & receiving','Purchasing','Ordered versus received quantities and receipt evidence.',['supplier','item','status'],'Order date (creation for drafts)'),
 template('production','Production & yield','Operations','Planned versus actual output for preparation batches.',['item','area','status'],'Completion date / creation for planned batches'),
 template('transfers','Interstore transfers','Operations','Requested, approved, dispatched and received quantities.',['item','status','destination'],'Request creation date'),
 template('cogs','Actual COGS & unexplained losses','Costs','Review readiness for reconciled actual consumption costs.',['item'],'Movement date'),
 template('waste','Waste & recorded losses','Operations','Recorded waste quantities, reasons and estimated cost.',['category','item','area','reason'],'Waste date'),
 template('tickets','Orders & average ticket','Sales','Customer order totals and average order value when order-level data is available.',[],'Order date'),
 template('cash','Recorded supplier payments','Purchasing','Paid invoice amounts by recorded payment date and method.',['supplier','method'],'Payment date'),
 template('reorder','Replenishment planning','Operations','Demand less last physical count, converted to supplier order units.',['supplier','item'],'Sales reference period'),
 template('pnl','Profit & loss','Costs','Readiness for a complete income statement including operating expenses.',[],'Accounting period'),
];
export const reportRoute=id=>`report-${id}`;
export const defaultReportFilters=()=>({start:'',end:'',supplier:'all',category:'all',item:'all',area:'all',status:'all',destination:'all',reason:'all',method:'all',weekday:'all',hour:'all',dateBasis:'invoice',query:'',sort:'',direction:'asc',page:1,pageSize:25});
const num=v=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?null:Number(v);
const subtract=(a,b)=>num(a)==null||num(b)==null?null:Number(a)-Number(b);
const sum=(rows,key)=>rows.length&&rows.every(r=>num(r[key])!=null)?rows.reduce((s,r)=>s+Number(r[key]),0):null;
export const reportDay=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')?v:toLocalDateTime(v).slice(0,10)||null;
const inRange=(day,f)=>(!f.start||(day&&day>=f.start))&&(!f.end||(day&&day<=f.end));
const col=(key,label,type='text')=>({key,label,type});
const dateCol=col('date','Date','date'),locationCol=col('location','Location'),itemCol=col('name','Item'),unitCol=col('unit','Unit');
function selected(row,f,location){
 if(location!=='all'&&row.locationId!==location&&row.fromLocationId!==location)return false;
 for(const [filter,key] of Object.entries({supplier:'supplierId',category:'categoryId',item:'itemId',area:'areaId',status:'status',destination:'toLocationId',reason:'reason',method:'method',weekday:'weekday',hour:'hour'})){
  if(f[filter]&&f[filter]!=='all'&&String(row[key])!==String(f[filter]))return false;
 }
 return inRange(row.date,f)&&(!f.query||norm(Object.values(row).filter(v=>typeof v==='string').join(' ')).includes(norm(f.query)));
}
function groupSum(rows,keys,fields){
 const groups=new Map();
 for(const r of rows){const key=JSON.stringify(keys.map(k=>r[k]));const a=groups.get(key)||[];a.push(r);groups.set(key,a);}
 return [...groups.values()].map(a=>({...a[0],...Object.fromEntries(fields.map(k=>[k,sum(a,k)])),lines:a.length}));
}
export function buildReport(id,data,filters={},location='all',local={}){
 const spec=REPORTS.find(r=>r.id===id);if(!spec)throw Error('Unknown report.');
 const f={...defaultReportFilters(),...filters};validateOrderDates(f.start,f.end);
 if(!spec.dateLabel){f.start='';f.end='';}
 const loc=id=>(data.locations||[]).find(l=>l.id===id)?.name||'Location not recorded';
 const items=new Map((data.ingredientItems||[]).map(i=>[i.id,i]));
 const itemInfo=id=>({itemId:id,name:items.get(id)?.internalName||items.get(id)?.name||'Unmapped item',categoryId:items.get(id)?.categoryId,unit:items.get(id)?.baseUom});
 const warnings=[],metrics=[];let rows=[],columns=[],dateFiltered=false;
 const base=[dateCol,locationCol,itemCol];
 if(['sales','mix','hours'].includes(id)){
  const menus=new Map((data.costInputs?.menus||[]).map(m=>[m.id,m]));
  rows=(data.salesPeriods?.facts||[]).map(r=>{
   const at=toLocalDateTime(r.occurredAt),day=r.date||r.factDate||at.slice(0,10),menu=menus.get(r.menuItemId);
   return {...r,date:day,location:loc(r.locationId),itemId:r.menuItemId||r.externalItemId,name:menu?.name||r.externalItemName||'Unmapped product',categoryId:menu?.categoryId,weekday:day?String(new Date(day+'T12:00:00Z').getUTCDay()):null,hour:at?at.slice(11,13):null};
  }).filter(r=>selected(r,f,location));dateFiltered=true;
  const dates=(data.salesPeriods?.facts||[]).filter(r=>location==='all'||r.locationId===location).map(r=>r.date||r.factDate).filter(Boolean).sort();
  warnings.push(dates.length?`Imported sales: ${dates[0]} through ${dates.at(-1)}. Rows are sold-item lines, not customer orders.`:'No imported sales available.');
  if(f.start&&f.end){const period=calculateSalesPeriod(data,location,fullDayRange(f.start,f.end));if(period.coverageNotice)warnings.push(period.coverageNotice);}
  else warnings.push('Open-ended dates show available records only; missing import days are not zero sales.');
  if(id==='hours'){
   const missing=rows.filter(r=>r.hour==null).length;if(missing)warnings.push(`${missing} lines without transaction timestamps are excluded.`);
   rows=groupSum(rows.filter(r=>r.hour!=null),['locationId','weekday','hour'],['quantity','grossSales','discounts','netSales']).map(r=>({...r,dayName:['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][r.weekday],hourLabel:`${r.hour}:00–${r.hour}:59`}));
   columns=[locationCol,col('dayName','Weekday'),col('hourLabel','Hour (New York)')];
  }else if(id==='mix'){
   rows=groupSum(rows,['locationId','itemId'],['quantity','grossSales','discounts','netSales']).sort((a,b)=>(b.netSales??-Infinity)-(a.netSales??-Infinity));
   const total=sum(rows,'netSales');let cumulative=0;
   const validABC=total>0&&rows.every(r=>r.netSales>=0);if(!validABC&&rows.length)warnings.push('ABC classification is unavailable for nonpositive totals or negative product sales. Signed adjustments are preserved.');
   rows=rows.map((r,i)=>{const before=cumulative;cumulative+=r.netSales||0;return {...r,rank:i+1,share:total>0&&r.netSales!=null?r.netSales/total*100:null,abc:validABC?(before/total<0.8?'A':before/total<0.95?'B':'C'):null};});
   columns=[col('rank','Rank','number'),locationCol,itemCol,col('share','Sales share','percent'),col('abc','ABC')];
  }else{rows=groupSum(rows,['date','locationId'],['quantity','grossSales','discounts','netSales']);columns=[dateCol,locationCol];}
  columns.push(col('quantity','Quantity','number'),col('grossSales','Gross sales','money'),col('discounts','Discounts','money'),col('netSales','Net sales','money'));
  metrics.push({label:'Net sales',value:sum(rows,'netSales'),type:'money'},{label:'Units sold',value:sum(rows,'quantity'),type:'number'});
 }else if(id==='food-cost'){
  rows=foodCostRows(data,local,location).map(r=>({locationId:r.location.id,location:r.location.name,itemId:r.recipe.id,name:r.recipe.name,categoryIds:r.categories.map(c=>c.id),category:r.categories.map(c=>c.name).join(', '),status:r.status,version:r.recipe.version,recipeStatus:r.recipe.status,cost:r.cost.total,price:r.cost.sellingPrice,foodCost:r.cost.foodCostPercent,margin:r.cost.grossMargin,optimalPrice:r.optimalPrice,note:r.cost.issues.join(' · ')})).filter(r=>f.category==='all'||r.categoryIds.includes(f.category));
  columns=[locationCol,itemCol,col('version','Recipe version','number'),col('recipeStatus','Recipe status'),col('cost','Unit cost','money'),col('price','Selling price','money'),col('foodCost','Food cost','percent'),col('margin','Theoretical margin','percent'),col('optimalPrice','Price at 25% target','money'),col('status','Target status'),col('note','Calculation notes')];
  warnings.push('Current catalog calculation, not historical profitability. Uses the latest displayed recipe version, including drafts, and a 25% target. Margin excludes operating expenses.');
 }else if(['usage','reorder'].includes(id)){
  columns=[locationCol,itemCol,col('supplier','Supplier'),col('current','Theoretical usage','number'),unitCol,col('previous','Prior comparable period','number'),col('variation','Change','percent'),col('note','Coverage')];
  if(!f.start||!f.end)warnings.push('Choose both start and end dates to calculate demand.');
  else for(const l of (data.locations||[]).filter(l=>location==='all'||l.id===location)){
   rows.push(...purchasingRows(data,local,{start:f.start,end:f.end,locationId:l.id,supplierId:f.supplier,query:f.query}).map(r=>{const demand=purchasingDemand(r,0);return {date:f.start,locationId:l.id,location:l.name,itemId:r.itemId,name:r.name,sku:r.sku,supplierId:r.item.supplierId,supplier:r.supplierName,unit:r.uom,current:r.current,previous:r.previous,variation:r.variation,stock:r.stock,orderQty:demand.orderQty,orderUnit:r.orderingUnit?.name,countDate:r.stocks.map(s=>s.countedAt||s.date||s.countDate).filter(Boolean).sort()[0],note:[r.reason,r.previousReason,r.partial?'Partial recipe or modifier coverage':null].filter(Boolean).join(' · ')||'Calculated'};}));
  }
  if(id==='reorder')columns.splice(6,0,col('stock','Last physical count','number'),col('countDate','Oldest count used','date'),col('orderQty','Suggested order quantity','number'),col('orderUnit','Order unit'));
  warnings.push('An item offered by several suppliers repeats its demand in each catalog; do not add those rows together.');
  if(id==='reorder')warnings.push('Planning estimate: selected-period demand minus last physical count, with no safety-stock allowance. Counts may be stale. This is not an automatic minimum-stock order.');
 }else if(['purchases','payables','cash'].includes(id)){
  const invoices=(data.invoices||[]).map(i=>({...i,location:loc(i.locationId),supplier:i.supplierName,status:financialStatus(i),date:reportDay(id==='cash'?i.paymentDate:f.dateBasis==='due'&&id==='payables'?i.dueDate:i.date||i.invoiceDate),method:i.paymentMethod||'Not recorded'}));
  if(id==='purchases'){
   const eligible=invoices.filter(i=>!['draft','cancelled'].includes(i.status));
   const missing=eligible.filter(i=>(location==='all'||i.locationId===location)&&selected({...i,itemId:f.item,categoryId:f.category},f,location)&&!i.lines?.length).length;
   if(missing)warnings.push(`${missing} matching invoices have no item lines and are excluded from the item breakdown.`);
   rows=eligible.flatMap(i=>(i.lines||[]).map(l=>({...itemInfo(l.itemId||l.inventoryItemId),date:i.date,locationId:i.locationId,location:i.location,supplierId:i.supplierId,supplier:i.supplier,number:i.number,status:i.status,quantity:l.quantity??l.qty,unit:l.uom||l.uomName||l.sourceUnit,unitPrice:l.unitPrice,lineTotal:l.lineTotal,currency:i.currency||'USD'})));
   columns=[...base,col('supplier','Supplier'),col('number','Invoice'),col('status','Status'),col('quantity','Quantity','number'),unitCol,col('unitPrice','Unit price','money'),col('lineTotal','Line total','money'),col('currency','Currency')];
   warnings.push('Invoice-line amounts exclude header-level taxes and fees. Drafts and canceled invoices are excluded; credit amounts retain their sign.');
  }else{
   rows=invoices;
   if(id==='cash'){
    const undated=invoices.filter(i=>i.status==='paid'&&!i.date&&(location==='all'||i.locationId===location)&&(f.supplier==='all'||i.supplierId===f.supplier)).length;
    warnings.push(`${undated} paid invoices have no payment date and are excluded. Amounts are recorded invoice totals, not bank transactions or partial-payment balances.`);
    rows=rows.filter(i=>i.status==='paid'&&i.date);
   }
   columns=[dateCol,locationCol,col('supplier','Supplier'),col('number','Invoice'),col('dueDate','Due date','date'),col('status','Status'),col('total','Invoice total','money'),col('currency','Currency'),col('paymentDate','Payment date','date'),col('method','Payment method')];
   if(id==='payables')warnings.push('Financial status is separate from receiving status. Invoice totals are not partial-payment balances; drafts need review before recognition. Date filters use the selected invoice/due date basis.');
  }
 }else if(id==='prices'){
  for(const item of data.supplierCatalog?.items||[]){
   const history=[...(item.priceHistory||[])].sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.id).localeCompare(String(b.id)));
   const last=new Map();
   for(const p of history){const key=p.locationId||'global',prior=last.get(key),cost=num(p.amount)!=null&&Number(p.unitFactor)>0?p.amount/p.unitFactor:null;
    const old=prior&&Number(prior.unitFactor)>0&&num(prior.amount)!=null?prior.amount/prior.unitFactor:null;
    rows.push({date:reportDay(p.date),locationId:p.locationId||'global',location:p.locationId?loc(p.locationId):'All locations (shared)',...itemInfo(item.itemId),name:item.internalName||item.name,supplierId:item.supplierId,supplier:item.supplierName,status:p.status,price:num(p.amount),purchaseUnit:p.uom,baseCost:cost,previous:old,change:old>0&&cost!=null?(cost-old)/old*100:null,note:p.unitHistoricallyVerified&&prior?.unitHistoricallyVerified?'Invoice unit references available':'Uses current unit conversions; verify historical pack sizes'});
    if(p.status==='approved')last.set(key,p);
   }
  }
  // Shared prices are applicable to any selected location, but never duplicated.
  if(location!=='all')rows=rows.map(r=>r.locationId==='global'?{...r,locationId:location}:r);
  columns=[...base,col('supplier','Supplier'),col('status','Status'),col('price','Purchase-unit price','money'),col('purchaseUnit','Purchase unit'),col('baseCost','Price per base unit','decimal'),unitCol,col('previous','Prior approved base price','decimal'),col('change','Price change','percent'),col('note','Comparison basis')];
  warnings.push('Changes compare with the preceding approved price in the same location scope. Historical pack conversions require verification.');
 }else if(id==='inventory'){
  rows=(data.inventoryHistory?.sessions||[]).filter(s=>s.status==='completed').flatMap(s=>(s.lines||[]).map(l=>({...itemInfo(l.itemId),date:reportDay(s.countedAt||s.date||l.completedAt),locationId:s.locationId,location:loc(s.locationId),areaId:l.areaId||l.storageAreaId,area:l.areaName||'Area not recorded',count:num(l.quantityBase??l.baseQty),expected:num(l.expectedBaseQuantity),variance:subtract(l.quantityBase??l.baseQty,l.expectedBaseQuantity),note:s.notes||l.notes||''})));
  columns=[...base,col('area','Storage area'),col('count','Physical count','number'),col('expected','Recorded expected','number'),col('variance','Variance','number'),unitCol,col('note','Notes')];
  warnings.push('Completed count history, not current stock. Quantities use base units. Missing expected quantities remain unknown; counts from different dates or areas are not added together.');
 }else if(id==='receiving'){
  rows=(data.orders||[]).flatMap(o=>(o.lines?.length?o.lines:[{}]).map(l=>({...itemInfo(l.itemId),name:l.itemId?itemInfo(l.itemId).name:'No order lines recorded',date:reportDay(o.orderedAt||o.createdAt),locationId:o.locationId,location:loc(o.locationId),supplierId:o.supplierId,supplier:o.supplierName,number:o.number,status:o.status,expectedAt:o.expectedAt,ordered:num(l.orderedQuantity??l.orderedPurchaseQty??l.qty),received:num(l.receivedQuantity),remaining:subtract(l.orderedQuantity??l.orderedPurchaseQty??l.qty,l.receivedQuantity)==null?null:Math.max(0,subtract(l.orderedQuantity??l.orderedPurchaseQty??l.qty,l.receivedQuantity)),unit:l.uom||l.uomName,evidence:o.receiptEvidence?.computedStatus||'Not evaluated'})));
  columns=[...base,col('supplier','Supplier'),col('number','Order'),col('status','Status'),col('expectedAt','Expected delivery','date'),col('ordered','Ordered','number'),col('received','Received','number'),col('remaining','Remaining','number'),unitCol,col('evidence','Receipt evidence')];
  warnings.push('Received quantities require explicitly linked completed receipt lines in matching units. Missing evidence does not mean an order was never delivered.');
 }else if(id==='production'){
  rows=(data.preparationHistory?.batches||[]).map(b=>({...itemInfo(b.itemId),date:reportDay(b.status==='completed'?b.completedAt:b.createdAt),locationId:b.locationId,location:loc(b.locationId),areaId:b.areaId,area:b.areaName,status:b.status,planned:num(b.plannedBase),actual:num(b.actualBase),variance:subtract(b.actualBase,b.plannedBase),yield:num(b.actualBase)!=null&&b.plannedBase>0?b.actualBase/b.plannedBase*100:null,note:b.status==='completed'&&!b.completedAt?'Completion date not recorded':''}));
  columns=[...base,col('area','Storage area'),col('status','Status'),col('planned','Planned output','number'),col('actual','Actual output','number'),col('variance','Output variance','number'),col('yield','Actual / planned','percent'),unitCol,col('note','Notes')];
  warnings.push('Output attainment is actual output divided by planned output, not ingredient yield. Undated completions cannot be assigned to a reporting period.');
 }else if(id==='transfers'){
  rows=(data.transfers||[]).flatMap(t=>(t.lines||[]).map(l=>({...itemInfo(l.itemId),date:reportDay(t.createdAt),locationId:t.toLocationId,fromLocationId:t.fromLocationId,toLocationId:t.toLocationId,from:loc(t.fromLocationId),location:loc(t.toLocationId),status:t.status,requested:num(l.requestedQuantity??l.qty),approved:num(l.approvedQuantity),dispatched:num(l.dispatchedQuantity),received:num(l.receivedQuantity),transit:subtract(l.dispatchedQuantity,l.receivedQuantity),unit:l.uom||l.uomName,neededOn:t.neededOn||t.date})));
  columns=[dateCol,col('from','Origin'),col('location','Destination'),itemCol,col('status','Status'),col('neededOn','Needed on','date'),col('requested','Requested','number'),col('approved','Approved','number'),col('dispatched','Dispatched','number'),col('received','Received','number'),col('transit','In transit','number'),unitCol];
  warnings.push('The location filter includes transfers into or out of that location. Quantities remain in each request’s unit.');
 }else if(id==='waste'){
  rows=(data.waste||[]).map(w=>({...itemInfo(w.inventoryItemId),date:reportDay(w.occurredAt),locationId:w.locationId,location:loc(w.locationId),areaId:w.storageAreaId,area:w.areaName,reason:w.reason,quantity:num(w.quantity),unit:w.unitName,cost:num(w.estimatedCost),note:w.notes}));
  columns=[...base,col('area','Storage area'),col('reason','Reason'),col('quantity','Quantity','number'),unitCol,col('cost','Estimated loss','money'),col('note','Notes')];
  warnings.push('Only recorded waste is shown. An empty report does not prove zero waste.');
 }else if(id==='cogs'){
  rows=(data.inventoryHistory?.movements||[]).filter(m=>['sale_consumption','prep_consumption','waste'].includes(m.type)).map(m=>({...itemInfo(m.itemId),date:reportDay(m.occurredAt),locationId:m.locationId,location:loc(m.locationId),type:m.type,quantity:num(m.baseQty),cost:num(m.totalCost),note:num(m.totalCost)==null?'Missing recorded cost':'Recorded movement cost'}));
  columns=[...base,col('type','Movement type'),col('quantity','Signed base quantity','number'),unitCol,col('cost','Recorded cost','money'),col('note','Readiness')];
  warnings.push('Actual COGS is not calculated: reconcile opening/closing inventory, purchases, production, transfers and historical costs first. The movement detail below is a readiness review; summing production and sales consumption may double-count costs.');
 }else if(id==='tickets'){
  columns=[dateCol,locationCol,col('orders','Customer orders','number'),col('ticket','Average ticket','money')];
  warnings.push('Unavailable: the reporting feed has item-level sales but no verified customer-order dataset. Sold-item lines cannot be used as a customer-order count or average ticket.');
 }else if(id==='pnl'){
  columns=[col('account','Account'),col('amount','Amount','money')];
  warnings.push('Unavailable: a complete income statement requires reconciled COGS, payroll, rent, taxes, fees and other operating expenses. Food-cost margin must not be presented as net profit.');
 }
 if(!dateFiltered){
  const missing=rows.filter(r=>!r.date&&selected({...r,date:f.start||f.end}, {...f,category:id==='food-cost'?'all':f.category},location)).length;
  if(spec.dateLabel&&(f.start||f.end)&&missing)warnings.push(`${missing} otherwise matching rows lack a reporting date and are excluded.`);
  rows=rows.filter(r=>selected(r,{...f,category:id==='food-cost'?'all':f.category},location));
 }
 if(id==='purchases')metrics.push({label:'Invoice-line spending (USD)',value:rows.every(r=>r.currency==='USD')?sum(rows,'lineTotal'):null,type:'money'});
 if(id==='payables')metrics.push({label:'Unpaid invoice totals (USD)',value:sum(rows.filter(r=>['unpaid','overdue'].includes(r.status)&&r.currency==='USD'),'total'),type:'money'});
 if(id==='cash')metrics.push({label:'Dated paid invoice totals (USD)',value:sum(rows.filter(r=>r.currency==='USD'),'total'),type:'money'});
 if(id==='waste')metrics.push({label:'Recorded estimated loss',value:sum(rows,'cost'),type:'money'});
 if(f.sort&&columns.some(c=>c.key===f.sort)){
  const direction=f.direction==='desc'?-1:1;
  rows.sort((a,b)=>{const av=a[f.sort],bv=b[f.sort];if(av==null||bv==null)return av==null?(bv==null?0:1):-1;return direction*(typeof av==='number'&&typeof bv==='number'?av-bv:String(av).localeCompare(String(bv),'en-US',{numeric:true}));});
 }
 return {spec,columns,rows,warnings:[...new Set(warnings)],metrics,filters:f,location,generatedAt:data.meta?.extractedAt||null};
}
export function reportCsv(report){
 const extra=[{label:'Report',value:()=>report.spec.title},{label:'Date basis',value:()=>report.spec.dateLabel||'Current catalog'},{label:'Start date (inclusive)',value:()=>report.filters.start},{label:'End date (inclusive)',value:()=>report.filters.end},{label:'Time zone',value:()=>'America/New_York'},{label:'Location filter',value:()=>report.location},{label:'Applied filters',value:()=>JSON.stringify(Object.fromEntries(Object.entries(report.filters).filter(([k])=>!['page','pageSize'].includes(k))))},{label:'Data as of',value:()=>report.generatedAt},{label:'Report notes',value:()=>report.warnings.join(' | ')}];
 return safeCsv(report.rows,[...report.columns.map(c=>({label:c.label,value:c.key})),...extra]);
}
