import {invoiceHistory} from '../src/invoice-financial.js';
// Derive evidence only from explicit relationships; never infer payment or stock.
export function enrichOperations({orders,invoices,receipts,transfers,t,base,loc,area}){
 const movements=t.inventory_transactions.map(x=>({...x,itemName:base.get(x.inventoryItemId)?.name,internalName:base.get(x.inventoryItemId)?.internalName,baseUom:base.get(x.inventoryItemId)?.baseUom,locationName:loc.get(x.locationId)?.name}));
 for(const r of receipts){
  r.locationName=loc.get(r.locationId)?.name;r.lineCount=r.lines.length;
  for(const l of r.lines)Object.assign(l,{quantity:l.quantityReceived,qty:l.quantityReceived,receivedQuantity:l.quantityReceived,storageAreaName:area.get(l.storageAreaId)?.name});
  let notes;try{notes=JSON.parse(r.notes);}catch{}
  if(notes?.kind==='historical_receipt_confirmation'){r.historicalConfirmation=notes;r.receivedDateOnly=notes.dateOnly;r.confirmedInvoiceLines=(notes.quantities||[]).map(x=>({...x,name:x.description}));r.notes=notes.confirmation;r.confirmedAt=notes.confirmedAt;r.confirmedInvoiceId=notes.invoiceId;}
 }
 const attach=(record,rs,linkedInvoices=[])=>{
  const ids=new Set([record.id,...record.lines.map(x=>x.id),...rs.flatMap(r=>[r.id,...r.lines.map(l=>l.id)]),...linkedInvoices.flatMap(i=>[i.id,...i.lines.map(l=>l.id)])]);
  const matching=movements.filter(m=>ids.has(m.sourceId));record.transactions=matching.filter(m=>m.locationId===record.locationId);record.historicalCorrections=matching.filter(m=>m.locationId!==record.locationId);
  record.timeline=[{at:record.createdAt,text:"Record created"},{at:record.orderedAt,text:"Ordered"},...rs.map(r=>({at:r.receivedAt,text:r.historicalConfirmation?"Historical receipt confirmed without adding stock":"Receipt recorded",dateOnly:r.receivedDateOnly}))].filter(x=>x.at).sort((a,b)=>a.at.localeCompare(b.at));
 };
 for(const o of orders){
  let comparable=0,full=0,any=false;
  for(const l of o.lines){const matches=o.receipts.filter(r=>r.status==='completed').flatMap(r=>r.lines).filter(r=>r.purchaseOrderLineId===l.id&&r.receivedItemUnitId===l.purchaseItemUnitId);l.orderedQuantity=l.orderedPurchaseQty;l.estimatedUnitPrice=l.estimatedUnitCost;if(matches.length){comparable++;l.receivedQuantity=matches.reduce((n,r)=>n+Number(r.quantityReceived),0);any ||=l.receivedQuantity>0;if(l.receivedQuantity>=l.orderedPurchaseQty)full++;}else l.receivedQuantity=null;}
  o.receiptEvidence={computedStatus:o.receipts.some(r=>r.historicalConfirmation)?'confirmed_received':o.lines.length&&full===o.lines.length?'fully_received':any?'partially_received':o.receipts.length?'receipt_recorded':'no_receipt_recorded',orderLineCount:o.lines.length,comparableLineCount:comparable};
  o.paymentEvidence={paidInvoiceCount:o.invoices.filter(i=>i.status==='paid').length};attach(o,o.receipts,o.invoices);
 }
 for(const i of invoices){
  i.receipts=receipts.filter(r=>r.id===i.receiptId||r.confirmedInvoiceId===i.id);const order=orders.find(o=>o.id===i.purchaseOrderId);i.linkedOrder=order?{id:order.id,number:order.number,supplierName:order.supplierName,status:order.status}:null;i.receiptStatus=i.receipts[0]?.status;i.lineCount=i.lines.length;
  for(const l of i.lines){l.name=l.description||l.name;l.unitPrice=l.unitPrice??l.unitCost;l.qty=l.quantity;}
  attach(i,i.receipts);i.timeline=invoiceHistory(i,order,i.receipts);
 }
 for(const x of transfers){for(const l of x.lines){l.inTransitQuantity=Number(l.dispatchedQuantity)-Number(l.receivedQuantity);l.remainingToDispatch=Math.max(0,Number(l.approvedQuantity??l.requestedQuantity)-Number(l.dispatchedQuantity));}x.receipts=x.dispatches.flatMap(d=>d.receipts);}
}
