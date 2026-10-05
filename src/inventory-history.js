import {escape as e,preciseNumber,money} from './model.js';
const known=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x));
const unique=rows=>[...new Map(rows.map(r=>[r.id,r])).values()];
const qty=(value,uom,signed=false)=>known(value)?`${signed&&Number(value)>0?'+':''}${preciseNumber(value)} ${e(uom||"unit not specified")}`:"Not specified";
const time=(value,withTime=true)=>{if(!value)return "Date not specified";const d=new Date(value.length===10?`${value}T12:00:00-04:00`:value);return Number.isNaN(d.getTime())?"Date not specified":new Intl.DateTimeFormat("en-US",{timeZone:'America/New_York',day:'2-digit',month:'2-digit',year:'numeric',...(withTime&&value.length!==10?{hour:'2-digit',minute:'2-digit'}:{})}).format(d);};
const match=(row,item)=>row.itemId===item.id&&row.locationId===item.locationId;
const labels={approved:"Approved",paid:"Paid",received:"Received",ordered:"Ordered",draft:"Draft",cancelled:"Canceled",uploaded:"Under review"};

export function inventoryHistoryFor(item,data,local={}){
  const raw=data.inventoryHistory;
  const counts=unique((raw?.counts||[]).filter(c=>match(c,item))).map(c=>({...c,date:c.completedAt||c.startedAt,dateLabel:"Count completed",kind:'count'}));
  for(const count of local.counts||[]){
    if(count.locationId!==item.locationId)continue;
    (count.lines||[]).forEach((line,i)=>{if((line.rowId?line.rowId===item.rowId:line.itemId===item.id)&&known(line.qty))counts.push({id:`local:${count.id}:${i}`,date:count.date||count.createdAt,dateLabel:count.moment||"Local count",kind:'count',local:true,sessionId:count.id,areaName:"Item total at location",baseQty:line.baseQty,baseUom:item.baseUnitName,entries:[{qty:line.qty,uom:line.uom}]});});
  }
  const movements=unique((raw?.movements||[]).filter(m=>match(m,item)));
  const purchases=movements.filter(m=>m.type==='purchase_receipt').map(m=>({...m,date:m.occurredAt,kind:'receipt',dateLabel:"Stock received",reference:`Receipt · ${m.sourceId?.slice(0,8)||m.id.slice(0,8)}`}));
  const invoices=(data.invoices||[]).filter(i=>i.locationId===item.locationId);
  const invoicedOrders=new Set();
  for(const doc of invoices){
    const lines=(doc.lines||[]).filter(l=>(l.itemId||l.inventoryItemId)===item.id);
    if(lines.length&&doc.purchaseOrderId)invoicedOrders.add(doc.purchaseOrderId);
    for(const line of lines)purchases.push({id:`invoice:${line.id}`,kind:'invoice',date:doc.date||doc.invoiceDate,dateLabel:"Invoice issue date",quantity:line.quantity,uom:line.uomName||line.uom,total:line.lineTotal,status:doc.status,reference:`Invoice #${doc.number}`,documentId:doc.id,supplier:doc.supplierName,posted:(doc.transactions||[]).some(t=>t.inventoryItemId===item.id&&t.locationId===item.locationId&&t.transactionType==='purchase_receipt')});
    for(const t of doc.transactions||[]){const row=purchases.find(r=>r.id===t.id);if(row){row.reference=`Invoice #${doc.number}`;row.documentId=doc.id;row.documentAction='invoice';}}
  }
  for(const doc of data.orders||[]){
    if(doc.locationId!==item.locationId)continue;
    if(!invoicedOrders.has(doc.id))for(const line of doc.lines||[])if((line.itemId||line.inventoryItemId)===item.id)purchases.push({id:`order:${line.id}`,kind:'order',date:doc.orderedAt||doc.createdAt,dateLabel:"Order date",quantity:line.quantity,uom:line.uomName||line.uom,total:line.lineTotal,status:doc.status,reference:`Order #${doc.number}`,documentId:doc.id,supplier:doc.supplierName});
    for(const t of doc.transactions||[]){const row=purchases.find(r=>r.id===t.id);if(row&&!row.documentId){row.reference=`Order #${doc.number}`;row.documentId=doc.id;row.documentAction='order';}}
  }
  const sales=movements.filter(m=>m.type==='sale_consumption').map(m=>({...m,date:m.occurredAt,kind:'sale',dateLabel:"Inventory posting"}));
  const sort=rows=>rows.sort((a,b)=>(Date.parse(b.date)||0)-(Date.parse(a.date)||0)||a.id.localeCompare(b.id));
  return {counts:sort(counts),purchases:sort(purchases),sales:sort(sales),loaded:Boolean(raw),extractedAt:raw?.meta?.extractedAt};
}

export function inventoryHistoryView(item,data,local={},tab='counts',page=1){
  const history=inventoryHistoryFor(item,data,local),keys=['counts','purchases','sales'];
  if(!keys.includes(tab))tab='counts';
  const rows=history[tab],size=8,pages=Math.max(1,Math.ceil(rows.length/size));page=Math.min(pages,Math.max(1,Number(page)||1));
  const control=(key,label)=>`<button class="history-tab${tab===key?' active':''}" role="tab" aria-selected="${tab===key}" data-action="inventory-history" data-id="${e(item.rowId)}" data-tab="${key}" data-page="1">${label}<span>${history[key].length}</span></button>`;
  const reference=r=>r.documentId?`<button class="table-name-button" data-action="${r.documentAction|| (r.kind==='order'?'order':'invoice')}" data-id="${e(r.documentId)}">${e(r.reference)}</button>`:e(r.reference||'');
  const rowHtml=r=>{
    let amount,detail,ref,note='';
    if(tab==='counts'){
      amount=r.entries?.length?r.entries.map(v=>qty(v.qty,v.uom)).join(' + '):qty(r.baseQty,r.baseUom);
      detail=e(r.areaName||"Area not specified");ref=`Count · ${e(r.sessionId?.slice(0,8)||r.id.slice(0,8))}`;
      note=`${r.entries?.length&&known(r.baseQty)?`<p>Recorded base quantity: ${qty(r.baseQty,r.baseUom)}.</p>`:''}${r.notes||r.sessionNotes?`<details><summary>Record notes</summary><p>${e([r.notes,r.sessionNotes].filter(Boolean).join('\n'))}</p></details>`:''}`;
    }else if(tab==='purchases'){
      amount=r.kind==='receipt'?qty(r.baseQty,r.baseUom,true):qty(r.quantity,r.uom);
      detail=r.kind==='receipt'?`<span class="history-badge entry">Stock receipt recorded</span> · ${e(r.areaName||"No area specified")}`:`<span class="history-badge">${r.kind==='order'?"Order":"Purchase document"}</span> · ${e(labels[r.status]||r.status||"No status")}`;
      ref=reference(r);note=r.kind==='receipt'?`<p>Posted amount: ${money(r.totalCost)}</p>`:`<p>${e(r.supplier||'')} · ${money(r.total)}${r.kind==='invoice'?` · ${r.posted?"Has a linked stock receipt in this history":"No linked stock receipt in this export"}`:" · Quantity ordered; does not represent stock received"}</p>`;
    }else{
      amount=qty(r.baseQty,r.baseUom,true);detail=`<span class="history-badge sale">${Number(r.baseQty)>0?"Usage reversal":"Sales usage"}</span> · ${e(r.areaName||"No area specified")}`;
      ref=e(r.batchName||`Sales · ${r.sourceId?.slice(0,8)||r.id.slice(0,8)}`);
      note=r.periodStart||r.batchStart?`<p>Period: ${time(r.periodStart||r.batchStart)} → ${time(r.periodEnd||r.batchEnd)} (exclusive end).</p>`:"<p>Sales period not specified.</p>";
    }
    return `<article class="history-record"><header><div><time>${time(r.date,tab!=='counts'||!r.local)}</time><small>${e(r.dateLabel)}</small></div><strong class="history-quantity ${tab==='sales'?'outgoing':''}">${amount}</strong></header><div class="history-reference">${ref}${r.local?"<span class=\"history-badge\">Local preview</span>":''}</div><div class="history-description">${detail}</div>${note}</article>`;
  };
  const help={counts:"Counts by area in the units originally entered. The date shown is the session’s completion time; the physical count time may appear in the notes. Counts are not added as stock receipts.",purchases:"Purchase documents and posted stock receipts are shown separately. An order, approval, or payment does not confirm an inventory movement.",sales:"Only usage and reversals already posted to inventory. The sales period is separate from the posting date. Imported sales alone are not shown as usage."};
  const pager=(label,next,disabled)=>`<button class="btn" data-action="inventory-history" data-id="${e(item.rowId)}" data-tab="${tab}" data-page="${next}" ${disabled?'disabled':''}>${label}</button>`;
  return `<section id="inventory-history" class="inventory-history" aria-label="Item history"><div class="history-heading"><h3>Item history</h3><span>${e(item.locationName)}</span></div><div class="history-tabs" role="tablist" aria-label="History type">${control('counts',"Counts")}${control('purchases',"Purchasing")}${control('sales',"Sales usage")}</div><p class="history-help">${help[tab]}</p>${!history.loaded?"<p class=\"history-empty\">Unable to load history from the database.</p>":''}<div role="tabpanel" aria-label="History records">${rows.slice((page-1)*size,page*size).map(rowHtml).join('')||"<p class=\"history-empty\">No records found for this item at this location.</p>"}</div>${rows.length>size?`<div class="history-pagination">${pager("Previous",page-1,page===1)}<span>${page} / ${pages}</span>${pager("Next",page+1,page===pages)}</div>`:''}<p class="history-help">Snapshot as of ${time(history.extractedAt)} · New York time · No automatic refresh.</p></section>`;
}
