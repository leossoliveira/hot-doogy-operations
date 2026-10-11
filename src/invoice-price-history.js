// Invoice prices only: never substitute today's catalog price for historical evidence.
export function invoicePriceHistory(item,invoices,location='all',allItem=false){
 return invoices.filter(i=>!(i.intakeSource==='llm'&&!i.humanApprovedAt)&&(allItem||i.supplierId===item.supplierId)&&(location==='all'||i.locationId===location)&&(allItem||!['cancelled','canceled','draft'].includes(i.dbStatus||i.status))).flatMap(i=>{
  const lines=(i.lines||[]).filter(l=>allItem?(l.itemId||l.inventoryItemId)===item.itemId||l.supplierItemId===item.supplierItemId:l.supplierItemId?l.supplierItemId===item.supplierItemId:(l.itemId||l.inventoryItemId)===item.itemId);
  if(!lines.length)return [];
  const units=new Set(lines.map(l=>l.itemUnitId||l.uomId||l.uom||''));
  const valid=units.size===1&&!units.has('')&&lines.every(l=>l.unitPrice!=null&&Number.isFinite(Number(l.unitPrice))&&Number(l.unitPrice)>=0&&Number(l.quantity??l.qty)>0);
  const qty=lines.reduce((n,l)=>n+Number(l.quantity??l.qty),0);
  return [{invoiceId:i.id,number:i.number,date:i.date,createdAt:i.createdAt||'',location:i.locationName,supplier:i.supplierName,status:i.dbStatus||i.status,unit:[...units][0],uom:lines[0].uom,price:valid?lines.reduce((n,l)=>n+Number(l.unitPrice)*Number(l.quantity??l.qty),0)/qty:null}];
 }).sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||b.createdAt.localeCompare(a.createdAt)||a.invoiceId.localeCompare(b.invoiceId));
}
export function invoicePriceChange(history){
 const [last,prior]=history;
 if(last?.price==null||prior?.price==null)return {label:'Not enough price history'};
 if(last.unit!==prior.unit)return {label:'Different units'};
 const delta=last.price-prior.price;
 return {delta,percent:prior.price>0?delta/prior.price*100:null,label:delta>0?'Increased':delta<0?'Decreased':'Unchanged'};
}

export function filterInvoicePricePeriod(history,period,today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())){
 if(period==='all')return history;
 const end=new Date(today+'T12:00:00Z'),start=new Date(end);
 if(period==='year')start.setUTCFullYear(start.getUTCFullYear()-1);else start.setUTCDate(start.getUTCDate()-Number(period)+1);
 const from=start.toISOString().slice(0,10);
 return history.filter(p=>p.date>=from&&p.date<=today);
}
