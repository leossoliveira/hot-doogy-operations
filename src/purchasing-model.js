import {supplierOrderItems} from './catalog-overlay.js';
import {measure} from './preparation-sales.js';
import {countUnit,periodWindow,suggestedProduction,partialProduction} from './preparation-model.js';
import {latestInventoryFor} from './inventory-model.js';
import {norm} from './model.js';

export const alphabetical=(a,b)=>a.name.localeCompare(b.name,'en-US',{sensitivity:'base',numeric:true});
export function purchasingRows(data,local,{start,end,locationId='all',supplierId='all',query=''}={}){
 const window=start||end?periodWindow(start,end):null,previous=window?periodWindow(window.previousStart,window.previousEnd):null,groups=new Map();
 for(const location of data.locations.filter(l=>locationId==='all'||l.id===locationId)){
  for(const supplier of data.suppliers.filter(s=>supplierId==='all'||s.id===supplierId)){
   for(const item of supplierOrderItems(data.supplierCatalog,data.items,local,{locationId:location.id,supplierId:supplier.id})){
    if(item.type==='prepared'||!norm([item.name,item.internalName,item.sku,supplier.name].join(' ')).includes(norm(query)))continue;
    const key=item.supplierItemId,group=groups.get(key)||{key,item,locations:[],items:[]};group.locations.push(location.id);group.items.push(item);groups.set(key,group);
   }
  }
 }
 const source=data.purchasingSales;
 return [...groups.values()].map(({key,item,locations,items})=>{
  const unit=countUnit(item),compatible=unit&&items.every(i=>Number(countUnit(i)?.factor)===Number(unit.factor));
  const observed=source?.rows.some(r=>r.itemId===item.id&&locations.includes(r.locationId));
  const unknown={qty:null,reason:!window?'Select a start and end date to calculate usage.':!source?'Sales usage calculation is unavailable.':!compatible?'Count unit conversion needs review.':'No calculated usage history. Plan this item manually.'};
  const current=window&&compatible&&observed?measure(item,locations,window,source,data.salesPeriods?.batches||[]):unknown;
  const prior=window&&compatible&&observed?measure(item,locations,previous,source,data.salesPeriods?.batches||[]):unknown;
  const variation=current.qty!=null&&prior.qty>0&&current.qty>=0?(current.qty-prior.qty)/prior.qty*100:null;
  const stocks=items.map(i=>({...latestInventoryFor(i,local,data.inventoryCounts),locationId:i.locationId}));
  const stock=stocks.every(s=>s.qty!=null)&&compatible?stocks.reduce((n,s)=>n+s.qty,0):null;
  const ordering=item.units.filter(u=>u.ordering&&Number(u.factor)>0&&Number.isFinite(Number(u.factor)));
  return {key,item,itemId:item.id,name:item.name,supplierName:item.supplierName,sku:item.sku,uom:unit?.name||'—',unit,orderingUnit:ordering.length===1?ordering[0]:null,current:current.qty,previous:prior.qty,variation,safetyPercent:variation==null?null:Math.ceil(Math.abs(variation)-1e-9),reason:current.reason,previousReason:prior.reason,partial:!!(current.partial||prior.partial),stock,stocks,window};
 }).sort((a,b)=>a.supplierName.localeCompare(b.supplierName,'en-US',{sensitivity:'base',numeric:true})||alphabetical(a,b));
}
export function purchasingDemand(row,margin){
 const demand=suggestedProduction(row.current,margin),net=partialProduction(demand,row.stock);
 const orderQty=net==null||!row.unit||!row.orderingUnit?null:Math.max(0,net)*Number(row.unit.factor)/Number(row.orderingUnit.factor);
 return {demand,net,orderQty};
}
export function validateOrderDates(start='',end=''){
 for(const value of [start,end])if(value&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value))throw Error('Enter valid order dates.');
 if(start&&end&&end<start)throw Error('End date must be on or after the start date.');
}
export function orderHistoryDate(order){
 const value=order.orderedAt||order.createdAt;
 if(!value||!Number.isFinite(Date.parse(value)))return null;
 if(/^\d{4}-\d{2}-\d{2}$/.test(value))return value;
 return new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
}
export function purchaseHistory(orders,{status='all',locationId='all',supplierId='all',start='',end='',query='',page=1,pageSize='25'}={}){
 validateOrderDates(start,end);
 const filtered=orders.filter(o=>{
  const day=start||end?orderHistoryDate(o):null;
  return (locationId==='all'||o.locationId===locationId)&&(supplierId==='all'||o.supplierId===supplierId)&&(!start||(day&&day>=start))&&(!end||(day&&day<=end))&&(status==='all'||(status==='awaiting_receipt'?['ordered','partially_received'].includes(o.status):o.status===status))&&norm([o.supplierName,o.number,o.id].join(' ')).includes(norm(query));
 });
 return paginatePurchasingRows(filtered,{page,pageSize});
}
export function paginatePurchasingRows(rows,{page=1,pageSize='25'}={}){
 const size=pageSize==='all'?Math.max(1,rows.length):[25,50,100].includes(Number(pageSize))?Number(pageSize):25;
 const pages=Math.max(1,Math.ceil(rows.length/size)),current=Math.min(pages,Math.max(1,Math.floor(Number(page))||1));
 return {rows:rows.slice((current-1)*size,current*size),total:rows.length,page:current,pages,start:rows.length?(current-1)*size+1:0,end:Math.min(current*size,rows.length)};
}
