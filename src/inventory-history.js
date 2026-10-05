import {escape as e,preciseNumber,money} from './model.js';
const known=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x));
const unique=rows=>[...new Map(rows.map(r=>[r.id,r])).values()];
const qty=(value,uom,signed=false)=>known(value)?`${signed&&Number(value)>0?'+':''}${preciseNumber(value)} ${e(uom||'unidade não informada')}`:'Não informada';
const time=(value,withTime=true)=>{if(!value)return 'Data não informada';const d=new Date(value.length===10?`${value}T12:00:00-04:00`:value);return Number.isNaN(d.getTime())?'Data não informada':new Intl.DateTimeFormat('pt-BR',{timeZone:'America/New_York',day:'2-digit',month:'2-digit',year:'numeric',...(withTime&&value.length!==10?{hour:'2-digit',minute:'2-digit'}:{})}).format(d);};
const match=(row,item)=>row.itemId===item.id&&row.locationId===item.locationId;
const labels={approved:'Aprovado',paid:'Pago',received:'Recebido',ordered:'Pedido realizado',draft:'Rascunho',cancelled:'Cancelado',uploaded:'Em análise'};

export function inventoryHistoryFor(item,data,local={}){
  const raw=data.inventoryHistory;
  const counts=unique((raw?.counts||[]).filter(c=>match(c,item))).map(c=>({...c,date:c.completedAt||c.startedAt,dateLabel:'Conclusão da contagem',kind:'count'}));
  for(const count of local.counts||[]){
    if(count.locationId!==item.locationId)continue;
    (count.lines||[]).forEach((line,i)=>{if((line.rowId?line.rowId===item.rowId:line.itemId===item.id)&&known(line.qty))counts.push({id:`local:${count.id}:${i}`,date:count.date||count.createdAt,dateLabel:count.moment||'Contagem local',kind:'count',local:true,sessionId:count.id,areaName:'Total do item na loja',baseQty:line.baseQty,baseUom:item.baseUnitName,entries:[{qty:line.qty,uom:line.uom}]});});
  }
  const movements=unique((raw?.movements||[]).filter(m=>match(m,item)));
  const purchases=movements.filter(m=>m.type==='purchase_receipt').map(m=>({...m,date:m.occurredAt,kind:'receipt',dateLabel:'Entrada no estoque',reference:`Recebimento · ${m.sourceId?.slice(0,8)||m.id.slice(0,8)}`}));
  const invoices=(data.invoices||[]).filter(i=>i.locationId===item.locationId);
  const invoicedOrders=new Set();
  for(const doc of invoices){
    const lines=(doc.lines||[]).filter(l=>(l.itemId||l.inventoryItemId)===item.id);
    if(lines.length&&doc.purchaseOrderId)invoicedOrders.add(doc.purchaseOrderId);
    for(const line of lines)purchases.push({id:`invoice:${line.id}`,kind:'invoice',date:doc.date||doc.invoiceDate,dateLabel:'Emissão do invoice',quantity:line.quantity,uom:line.uomName||line.uom,total:line.lineTotal,status:doc.status,reference:`Invoice #${doc.number}`,documentId:doc.id,supplier:doc.supplierName,posted:(doc.transactions||[]).some(t=>t.inventoryItemId===item.id&&t.locationId===item.locationId&&t.transactionType==='purchase_receipt')});
    for(const t of doc.transactions||[]){const row=purchases.find(r=>r.id===t.id);if(row){row.reference=`Invoice #${doc.number}`;row.documentId=doc.id;row.documentAction='invoice';}}
  }
  for(const doc of data.orders||[]){
    if(doc.locationId!==item.locationId)continue;
    if(!invoicedOrders.has(doc.id))for(const line of doc.lines||[])if((line.itemId||line.inventoryItemId)===item.id)purchases.push({id:`order:${line.id}`,kind:'order',date:doc.orderedAt||doc.createdAt,dateLabel:'Data do pedido',quantity:line.quantity,uom:line.uomName||line.uom,total:line.lineTotal,status:doc.status,reference:`Ordem #${doc.number}`,documentId:doc.id,supplier:doc.supplierName});
    for(const t of doc.transactions||[]){const row=purchases.find(r=>r.id===t.id);if(row&&!row.documentId){row.reference=`Ordem #${doc.number}`;row.documentId=doc.id;row.documentAction='order';}}
  }
  const sales=movements.filter(m=>m.type==='sale_consumption').map(m=>({...m,date:m.occurredAt,kind:'sale',dateLabel:'Lançamento no estoque'}));
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
      detail=e(r.areaName||'Área não informada');ref=`Contagem · ${e(r.sessionId?.slice(0,8)||r.id.slice(0,8))}`;
      note=`${r.entries?.length&&known(r.baseQty)?`<p>Quantidade-base registrada: ${qty(r.baseQty,r.baseUom)}.</p>`:''}${r.notes||r.sessionNotes?`<details><summary>Observações do registro</summary><p>${e([r.notes,r.sessionNotes].filter(Boolean).join('\n'))}</p></details>`:''}`;
    }else if(tab==='purchases'){
      amount=r.kind==='receipt'?qty(r.baseQty,r.baseUom,true):qty(r.quantity,r.uom);
      detail=r.kind==='receipt'?`<span class="history-badge entry">Entrada registrada</span> · ${e(r.areaName||'Sem área informada')}`:`<span class="history-badge">${r.kind==='order'?'Pedido':'Documento de compra'}</span> · ${e(labels[r.status]||r.status||'Sem status')}`;
      ref=reference(r);note=r.kind==='receipt'?`<p>Valor lançado: ${money(r.totalCost)}</p>`:`<p>${e(r.supplier||'')} · ${money(r.total)}${r.kind==='invoice'?` · ${r.posted?'Possui entrada vinculada neste histórico':'Sem entrada de estoque vinculada neste extrato'}`:' · Quantidade pedida; não representa entrada de estoque'}</p>`;
    }else{
      amount=qty(r.baseQty,r.baseUom,true);detail=`<span class="history-badge sale">${Number(r.baseQty)>0?'Estorno de consumo':'Saída por venda'}</span> · ${e(r.areaName||'Sem área informada')}`;
      ref=e(r.batchName||`Vendas · ${r.sourceId?.slice(0,8)||r.id.slice(0,8)}`);
      note=r.periodStart||r.batchStart?`<p>Período: ${time(r.periodStart||r.batchStart)} → ${time(r.periodEnd||r.batchEnd)} (fim exclusivo).</p>`:'<p>Período de vendas não informado.</p>';
    }
    return `<article class="history-record"><header><div><time>${time(r.date,tab!=='counts'||!r.local)}</time><small>${e(r.dateLabel)}</small></div><strong class="history-quantity ${tab==='sales'?'outgoing':''}">${amount}</strong></header><div class="history-reference">${ref}${r.local?'<span class="history-badge">Prévia local</span>':''}</div><div class="history-description">${detail}</div>${note}</article>`;
  };
  const help={counts:'Quantidades contadas por área, preservadas na unidade informada. A data exibida é a conclusão registrada da sessão; o horário físico pode estar nas observações. Contagens não são somadas como entradas.',purchases:'Documentos de compra e entradas efetivamente lançadas aparecem identificados separadamente. Pedido, aprovação ou pagamento não comprovam movimentação de estoque.',sales:'Somente baixas e estornos já lançados no estoque. O período do relatório é separado da data do lançamento; vendas apenas importadas não aparecem como consumo.'};
  const pager=(label,next,disabled)=>`<button class="btn" data-action="inventory-history" data-id="${e(item.rowId)}" data-tab="${tab}" data-page="${next}" ${disabled?'disabled':''}>${label}</button>`;
  return `<section id="inventory-history" class="inventory-history" aria-label="Histórico do item"><div class="history-heading"><h3>Histórico do item</h3><span>${e(item.locationName)}</span></div><div class="history-tabs" role="tablist" aria-label="Tipo de histórico">${control('counts','Contagens')}${control('purchases','Compras')}${control('sales','Saídas por vendas')}</div><p class="history-help">${help[tab]}</p>${!history.loaded?'<p class="history-empty">Não foi possível carregar o histórico do banco.</p>':''}<div role="tabpanel" aria-label="Registros do histórico">${rows.slice((page-1)*size,page*size).map(rowHtml).join('')||'<p class="history-empty">Nenhum registro encontrado para este item nesta loja.</p>'}</div>${rows.length>size?`<div class="history-pagination">${pager('Anterior',page-1,page===1)}<span>${page} / ${pages}</span>${pager('Próxima',page+1,page===pages)}</div>`:''}<p class="history-help">Extrato de ${time(history.extractedAt)} · horário de Nova York · sem sincronização automática.</p></section>`;
}
