// Invoice prices only: never substitute today's catalog price for historical evidence.
export function invoicePriceHistory(item,invoices,location='all'){
 return invoices.filter(i=>i.supplierId===item.supplierId&&(location==='all'||i.locationId===location)&&!['cancelled','canceled','draft'].includes(i.dbStatus||i.status)).flatMap(i=>{
  const lines=(i.lines||[]).filter(l=>l.supplierItemId?l.supplierItemId===item.supplierItemId:(l.itemId||l.inventoryItemId)===item.itemId);
  if(!lines.length)return [];
  const units=new Set(lines.map(l=>l.itemUnitId||l.uomId||l.uom||''));
  const valid=units.size===1&&!units.has('')&&lines.every(l=>l.unitPrice!=null&&Number.isFinite(Number(l.unitPrice))&&Number(l.unitPrice)>=0&&Number(l.quantity??l.qty)>0);
  const qty=lines.reduce((n,l)=>n+Number(l.quantity??l.qty),0);
  return [{invoiceId:i.id,number:i.number,date:i.date,createdAt:i.createdAt||'',location:i.locationName,unit:[...units][0],uom:lines[0].uom,price:valid?lines.reduce((n,l)=>n+Number(l.unitPrice)*Number(l.quantity??l.qty),0)/qty:null}];
 }).sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||b.createdAt.localeCompare(a.createdAt)||a.invoiceId.localeCompare(b.invoiceId));
}
export function invoicePriceChange(history){
 const [last,prior]=history;
 if(last?.price==null||prior?.price==null)return {label:'Not enough price history'};
 if(last.unit!==prior.unit)return {label:'Different units'};
 const delta=last.price-prior.price;
 return {delta,percent:prior.price>0?delta/prior.price*100:null,label:delta>0?'Increased':delta<0?'Decreased':'Unchanged'};
}
