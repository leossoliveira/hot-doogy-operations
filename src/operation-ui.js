import {orderItemsTable} from './order-edit.js';
import {financialStatus} from './invoice-financial.js';
export function createOperationUI({e,preciseNumber,money,date,status,icon,pair,notice,btn,openModal}){
  const list=x=>Array.isArray(x)?x:[];
  const absent="<span class=\"muted\">Not specified</span>";
  const text=x=>x===null||x===undefined||x===''?absent:e(x);
  const number=x=>x===null||x===undefined||x===''?absent:e(preciseNumber(x));
  const amount=x=>x===null||x===undefined||x===''?absent:e(money(x));
  const quantity=(x,u)=>x===null||x===undefined||x===''?absent:number(x)+(u?' <span class="muted">'+e(u)+'</span>':'');
  const ref=x=>x.number||'#'+String(x.id||'').slice(0,7).toUpperCase();
  const when=(x,day=false)=>{
    if(!x)return absent;
    if(day||String(x).length===10){const parsed=new Date(String(x).slice(0,10)+'T12:00:00Z');return Number.isNaN(parsed.getTime())?text(x):e(new Intl.DateTimeFormat("en-US",{timeZone:'America/New_York',day:'2-digit',month:'2-digit',year:'numeric'}).format(parsed));}
    const d=new Date(String(x).replace(' ','T').replace(/([+-]\d{2})$/,'$1:00'));
    return Number.isNaN(d.getTime())?text(x):e(new Intl.DateTimeFormat("en-US",{timeZone:'America/New_York',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(d));
  };
  const grid=fields=>'<div class="detail-grid operation-detail-grid">'+fields.map(([label,value])=>pair(label,value)).join('')+'</div>';
  const section=(title,body)=>'<section class="operation-section"><h3>'+e(title)+'</h3>'+body+'</section>';
  const row=values=>'<tr>'+values.map(v=>'<td>'+v+'</td>').join('')+'</tr>';
  const table=(headers,rows,layout)=>'<div class="table-wrap operation-table'+(layout==='rows'?' operation-table-rows':'')+'"><table'+(layout==='rows'?' data-table-layout="rows"':'')+'><thead><tr>'+headers.map(h=>h?.html?h.html:'<th>'+(Array.isArray(h)?'<span class="th-full">'+e(h[0])+'</span><span class="th-short" aria-hidden="true">'+e(h[1])+'</span>':e(h))+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';
  const notes=x=>x?section("Notes",'<p class="operation-notes">'+e(x)+'</p>'):'';
  const intro=x=>'<div class="operation-intro"><div class="eyebrow">'+e(x.supplierName||'')+'</div><h3 class="item-detail-title">'+e(x.locationName||'')+'</h3></div>';
  const product=l=>'<strong>'+text(l.name||l.itemName)+'</strong>'+(l.internalName&&l.internalName!==l.name?'<small>'+e(l.internalName)+'</small>':'')+(l.sku?'<small>SKU '+e(l.sku)+'</small>':'')+(l.notes?'<small class="operation-line-note">'+e(l.notes)+'</small>':'');
  const emptyLines=()=>notice("This record has no item lines.",true);
  function linesView(lines,kind){
    if(!lines.length)return emptyLines();
    if(kind==='order')return table(["Product / SKU","Ordered","Received / Date","Unit","Item price","Estimated total"],lines.map(l=>row([product(l),number(l.orderedQuantity??l.quantity??l.qty),number(l.receivedQuantity)+(list(l.receivedDates).length?'<small>'+l.receivedDates.map(d=>when(d)).join('<br>')+'</small>':''),text(l.uom),amount(l.catalogUnitPrice),amount(l.lineTotal)])));
    return table(["Product / SKU","Quantity","Unit","Base quantity","Unit price",'Total'],lines.map(l=>row([product(l),number(l.quantity??l.qty),text(l.uom),quantity(l.quantityBase,l.baseUom),amount(l.unitPrice??l.unitCost),amount(l.lineTotal)])));
  }
  function lineReferences(lines,transfer=false){
    if(!lines.length)return '';
    return "<details class=\"operation-details\"><summary>Item units and references</summary>"+table(['Item',"Line ID","Item unit","Base unit","Saved conversion factor"],lines.map(l=>row([text(l.internalName||l.name),text(l.id),text(l.itemUnitId),text(l.baseUom),number(l.unitFactor??l.currentUnitFactor)])))+'<p class="operation-help">'+(transfer?"The request’s conversion factor was preserved in the record.":"Factors come from the current catalog. Base quantities are shown only when recorded in the activity.")+'</p></details>';
  }
  function confirmedQuantitiesView(r){
    const lines=list(r.confirmedInvoiceLines);
    const explanation=notice("User confirmed full receipt without an inventory movement. Quantities below come from the invoice and do not represent a new physical count.",true);
    return explanation+(lines.length?table(["Product / SKU","Quantity received per invoice","Unit"],lines.map(l=>row([product(l),number(l.quantity),text(l.uom)]))):notice("This invoice has no itemized quantities. Confirmation covers receipt of the entire document; no quantities were estimated.",true));
  }
  function receiptsView(receipts){
    if(!receipts.length)return section("Receipts",notice("No receipt is explicitly linked to this record. This does not confirm that the goods are in transit.",true));
    return section("Receipts",receipts.map(r=>"<article class=\"operation-record\"><div class=\"operation-record-head\"><strong>Receipt "+e(String(r.id||'').slice(0,7).toUpperCase())+'</strong>'+status(r.dbStatus??r.status)+'</div>'+grid([["Received on",when(r.receivedAt,r.receivedDateOnly)],["Location",text(r.locationName)],["Saved lines",number(r.lineCount??list(r.lines).length)]])+(r.historicalConfirmation?confirmedQuantitiesView(r):linesView(list(r.lines),'receipt'))+(list(r.lines).some(l=>l.storageAreaName)?"<details class=\"operation-details\"><summary>Storage areas</summary>"+table(['Item',"Area","Received","Base quantity"],r.lines.map(l=>row([text(l.internalName||l.name),text(l.storageAreaName),quantity(l.receivedQuantity??l.quantity,l.uom),quantity(l.quantityBase,l.baseUom)])))+'</details>':'')+notes(r.notes)+'</article>').join(''));
  }
  function documentsView(documents){
    if(!documents.length)return section("Documents",notice("No linked documents found.",true));
    return section("Documents",documents.map(d=>'<article class="operation-document"><div class="operation-document-head">'+icon('file-text')+'<div><strong>'+text(d.fileName)+'</strong><small>'+text(d.mimeType||d.storedMimeType)+(d.sizeBytes!=null?' · '+e(preciseNumber(d.sizeBytes/1024))+' KB':'')+'</small></div><span class="status '+(d.fileExists===true?'green':d.fileExists===false?'amber':'')+'">'+(d.fileExists===true?"File found":d.fileExists===false?"File not found":"File presence not verified")+'</span></div>'+grid([["Created on",when(d.createdAt)],["Stored in",when(d.storageCreatedAt)],["Last updated",when(d.storageUpdatedAt)]])+"<details class=\"operation-details\"><summary>File reference</summary>"+grid([["Name",text(d.fileName)],["Type",text(d.mimeType)],["Saved path",text(d.storagePath)],["ID",text(d.id)],["Size in bytes",number(d.sizeBytes)]])+'</details></article>').join('')+"<p class=\"operation-help\">This view shows saved metadata. File presence is shown only when verified.</p>");
  }
  function timelineView(x){
    const events=list(x.timeline).length?x.timeline:list(x.history);
    return events.length?section("Saved history",'<ol class="operation-timeline">'+events.map(t=>'<li><time>'+(t.at?when(t.at,t.dateOnly):'Date not recorded')+'</time><div><strong>'+text(t.text||t.action)+'</strong>'+(t.number?"<small>Note "+e(t.number)+'</small>':'')+(t.fileName?'<small>'+e(t.fileName)+'</small>':'')+(t.newStatus?"<small>Recorded status: "+e(t.newStatus)+'</small>':'')+'</div></li>').join('')+'</ol>'):'';
  }
  function transactionsView(x){
    const transactions=list(x.transactions),labels={purchase_receipt:"Purchase receipt",transfer_out:"Transfer out",transfer_in:"Transfer in",manual_adjustment:"Inventory adjustment"};
    let out=list(x.transactionExceptions).length?notice("There are "+e(x.transactionExceptions.length)+" historical movements from another location, listed separately from this activity. The reference was preserved for review.",true):'';
    const corrections=list(x.historicalCorrections);
    if(corrections.length)out+=notice(e(x.historicalCorrectionSummary?.explanation||"Historical movements at another location, preserved for review."),true)+"<details class=\"operation-details operation-ledger\"><summary>Corrected historical movements ("+corrections.length+')</summary>'+table(["Date","Movement / item","Location","Base quantity","Total cost"],corrections.map(t=>row([when(t.occurredAt),'<strong>'+e(labels[t.transactionType]||t.transactionType||"Movement")+'</strong><small>'+text(t.internalName||t.itemName)+'</small>',text(t.locationName),quantity(t.quantityBase,t.baseUom),amount(t.totalCost)])))+'</details>';
    if(transactions.length)out+="<details class=\"operation-details operation-ledger\"><summary>Linked inventory movements ("+transactions.length+')</summary>'+table(["Date","Movement / item","Location / area","Base quantity","Cost per base unit","Total cost"],transactions.map(t=>row([when(t.occurredAt),'<strong>'+e(labels[t.transactionType]||t.transactionType||"Movement")+'</strong><small>'+text(t.internalName||t.itemName)+'</small>',text(t.locationName)+'<small>'+text(t.storageAreaName)+'</small>',quantity(t.quantityBase,t.baseUom),amount(t.unitCostBase),amount(t.totalCost)])))+"<p class=\"operation-help\">Explicitly linked movements. This list does not represent current stock on hand.</p></details>";
    return out;
  }
  const references=x=>"<details class=\"operation-details\"><summary>Record references</summary>"+grid([["ID",text(x.id)],["Original status",text(x.dbStatus??x.status)],["Created on",when(x.createdAt)],["Updated on",when(x.updatedAt)]])+'</details>';
  const ending=x=>notes(x.notes)+timelineView(x)+transactionsView(x)+references(x);
  const linkedButton=(label,action,id)=>btn(label,action,'arrow-up-right','sm','data-id="'+e(id)+'"');
  function showInvoice(x,footer=''){
    const stored=financialStatus(x),paid=(x.dbStatus??x.status)==='paid';
    let body=intro(x)+grid([["INVOICE DATE",when(x.date,true)],["Due Date",when(x.dueDate,true)]]);
    body+=section("Invoice amounts",grid([['Subtotal',amount(x.subtotal)],["Tax",amount(x.tax)],["Fees",amount(x.fees)],['Total',amount(x.total)]]));
    if(paid&&x.paymentDate)body+='<div class="invoice-payment-details">'+grid([["Payment date",when(x.paymentDate,true)],["Payment method",text(({credit_card:"Credit card",debit_card:"Debit card",bank_transfer:"Bank transfer"})[x.paymentMethod]||"Not specified")]])+'</div>';
    if(paid&&!x.paymentDate)body+="<p class=\"operation-help\">This invoice is marked as paid in the database. The historical payment date was not recorded.</p>";
    body+=section("Invoice items",(list(x.lines).length?table(["Product / SKU","Quantity","Unit","Unit price","Total"],x.lines.map(l=>row([product(l),number(l.quantity??l.qty),text(l.uom),amount(x.intakeSource==='llm'?l.unitPrice:l.catalogUnitPrice),amount(l.lineTotal)])))+'<p class="operation-help">Invoice totals remain as recorded. Review the original document before approval.</p>':emptyLines())+'<p class="invoice-item-count">Total items <strong>'+number(x.lineCount??list(x.lines).length)+'</strong></p>');
    const declared=x.extraction?.receiving;
    if(declared)body+=section("Invoice receiving",grid([["Status",status(declared.status==='received'?'received':'awaiting_receipt')],["Received by",text(declared.receivedBy||"Not recorded")],["Received on",declared.receivedDate?when(declared.receivedDate,true):text("Not recorded")]]));
    if(!declared||list(x.receipts).length)body+=section("Receipts",list(x.receipts).length?x.receipts.map(r=>grid([["Received on",(r.dbStatus??r.status)==='completed'?when(r.receivedAt,r.receivedDateOnly):text("Not recorded")],["Received by",text(r.receiverName||r.receivedByName||"Not recorded")],["Status",status((r.dbStatus??r.status)==='completed'?'received':'awaiting_receipt')]])).join(''):grid([["Received on",text("Not recorded")],["Received by",text("Not recorded")],["Status",status("awaiting_receipt")]]));
    body+=notes(x.notes)+timelineView(x);
    openModal('<span class="invoice-title-number">Invoice '+e(ref(x))+'</span>'+status(stored),body,footer||btn("Close",'close'),{wide:true,className:'operation-modal invoice-detail-modal',kind:'invoice-detail'});
  }
  function showOrder(x,footer=''){
    const orderLines=list(x.lines);
    const estimatedTotal=orderLines.length&&orderLines.every(l=>(l.orderedPurchaseQty??l.orderedQuantity??l.quantity??l.qty)!=null&&(l.estimatedUnitPrice??l.catalogUnitPrice)!=null)?orderLines.reduce((sum,l)=>sum+Number(l.orderedPurchaseQty??l.orderedQuantity??l.quantity??l.qty)*Number(l.estimatedUnitPrice??l.catalogUnitPrice),0):null;
    const evidence=x.receiptEvidence||{},labels={confirmed_received:"Received quantities — user confirmation",fully_received:"Fully received on linked lines",partially_received:"Partially received on linked lines",receipt_recorded:"Receipt recorded",no_receipt_recorded:"No linked receipt"};
    const receivers=[...new Set(list(x.receipts).filter(r=>(r.dbStatus??r.status)==='completed').map(r=>r.receiverName||r.receivedByName).filter(Boolean))];
    let body=intro(x)+grid([["Received by",text(receivers.join(', ')||'Not recorded')],["Saved status",status(x.dbStatus??x.status,x.statusLabel)],["Receipt",text(labels[evidence.computedStatus])],["Ordered on",when(x.orderedAt)],["Expected delivery",when(x.expectedAt)],["Saved items",number(x.lineCount??list(x.lines).length)],["Estimated total",amount(estimatedTotal)]]);
    if(x.paymentEvidence?.paidInvoiceCount)body+=notice(e(x.paymentEvidence.paidInvoiceCount)+" linked invoice(s) marked as paid. Payment and receipt of goods are separate records.",true);
    body+=section("Order items",orderItemsTable(x,e,money,preciseNumber));
    if(evidence.comparableLineCount!=null)body+="<p class=\"operation-help\">This review compares "+e(evidence.comparableLineCount)+" of "+e(evidence.orderLineCount??0)+" explicitly linked lines with matching units. Missing fields remain unconfirmed.</p>";
    body+=section("Linked invoices",list(x.invoices).length?table(["Note","Issue date","Status",'Total',''],x.invoices.map(i=>row([text(i.number||ref(i)),when(i.date,true),status(i.status),amount(i.total),linkedButton("Open invoice",'invoice',i.id)]))):notice("No invoices linked to this order.",true));
    if(list(x.tags).length)body+=section("Tags",'<div class="operation-tags">'+x.tags.map(t=>'<span class="tag">'+e(t.name)+'</span>').join('')+'</div>');
    body+=timelineView(x);
    openModal("Order "+e(ref(x)),body,footer||btn("Close",'close'),{wide:true,className:'operation-modal',kind:'order-detail'});
  }
  function showTransfer(x,footer=''){
    const lines=list(x.lines);
    let body='<div class="operation-transfer-route"><strong>'+text(x.fromLocationName)+'</strong>'+icon('arrow-right')+'<strong>'+text(x.toLocationName)+'</strong></div>'+grid([["Delivery Date",when(x.date||x.neededOn,true)],["Requested items",number(x.lineCount??lines.length)],["Shipments",number(list(x.dispatches).length)],["Receipts",number(list(x.receipts).length)]]);
    const requested=(x.dbStatus??x.status)==='submitted',sortHead={html:'<th><button type="button" class="table-sort" data-sort="transfer-items" aria-label="Sort Item A–Z">Item <span data-sort-arrow aria-hidden="true">↕</span></button></th>'},item=l=>product(l)+'<small class="operation-unit-inline">'+text(l.uom)+'</small>',asked=l=>number(l.requestedQuantity??l.quantity??l.qty);
    // Until approval only the requested quantities exist; shipping columns appear afterwards.
    body+=section("Items",lines.length?(requested?table([sortHead,"Unit",["Requested","Req."]],lines.map(l=>row([item(l),text(l.uom),asked(l)])),'rows'):table([sortHead,"Unit",["Requested","Req."],["Approved","Appr."],["Shipped","Ship."],["Received","Rec."],["In transit","Transit"],["To ship","To ship"]],lines.map(l=>row([item(l),text(l.uom),asked(l),number(l.approvedQuantity),number(l.dispatchedQuantity),number(l.receivedQuantity),number(l.inTransitQuantity),number(l.remainingToDispatch)])),'rows')):emptyLines());
    body+=notes(x.notes)+timelineView(x)+transactionsView(x);
    openModal('<span class="transfer-title-number">Internal transfer '+e(ref(x))+'</span>'+status(x.dbStatus??x.status),body,btn("Print",'transfer-print','printer','','data-id="'+e(x.id)+'"')+(footer||btn("Close",'close')),{wide:true,className:'operation-modal transfer-detail-modal',kind:'transfer-detail'});
    const sort=typeof document==='undefined'?null:document.querySelector('#overlay-root [data-sort="transfer-items"]');
    if(sort)sort.onclick=()=>{
      const table=sort.closest('table'),header=sort.closest('th'),descending=header.getAttribute('aria-sort')==='ascending',name=r=>r.cells[0].querySelector('strong')?.textContent||'';
      [...table.tBodies[0].rows].sort((a,b)=>(descending?-1:1)*name(a).localeCompare(name(b),'en',{sensitivity:'base',numeric:true})).forEach(r=>table.tBodies[0].append(r));
      header.setAttribute('aria-sort',descending?'descending':'ascending');sort.querySelector('[data-sort-arrow]').textContent=descending?'↓':'↑';sort.setAttribute('aria-label','Sort Item '+(descending?'A–Z':'Z–A'));
    };
  }
  return {showInvoice,showOrder,showTransfer};
}