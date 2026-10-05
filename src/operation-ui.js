export function createOperationUI({e,preciseNumber,money,date,status,icon,pair,notice,btn,openModal}){
  const list=x=>Array.isArray(x)?x:[];
  const absent='<span class="muted">Não informado</span>';
  const text=x=>x===null||x===undefined||x===''?absent:e(x);
  const number=x=>x===null||x===undefined||x===''?absent:e(preciseNumber(x));
  const amount=x=>x===null||x===undefined||x===''?absent:e(money(x));
  const quantity=(x,u)=>x===null||x===undefined||x===''?absent:number(x)+(u?' <span class="muted">'+e(u)+'</span>':'');
  const ref=x=>x.number||'#'+String(x.id||'').slice(0,7).toUpperCase();
  const when=(x,day=false)=>{
    if(!x)return absent;
    if(day||String(x).length===10){const parsed=new Date(String(x).slice(0,10)+'T12:00:00Z');return Number.isNaN(parsed.getTime())?text(x):e(new Intl.DateTimeFormat('pt-BR',{timeZone:'America/New_York',day:'2-digit',month:'short',year:'numeric'}).format(parsed));}
    const d=new Date(String(x).replace(' ','T').replace(/([+-]\d{2})$/,'$1:00'));
    return Number.isNaN(d.getTime())?text(x):e(new Intl.DateTimeFormat('pt-BR',{timeZone:'America/New_York',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(d));
  };
  const grid=fields=>'<div class="detail-grid operation-detail-grid">'+fields.map(([label,value])=>pair(label,value)).join('')+'</div>';
  const section=(title,body)=>'<section class="operation-section"><h3>'+e(title)+'</h3>'+body+'</section>';
  const row=values=>'<tr>'+values.map(v=>'<td>'+v+'</td>').join('')+'</tr>';
  const table=(headers,rows)=>'<div class="table-wrap operation-table"><table><thead><tr>'+headers.map(h=>'<th>'+e(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';
  const notes=x=>x?section('Observações','<p class="operation-notes">'+e(x)+'</p>'):'';
  const intro=x=>'<div class="operation-intro"><div class="eyebrow">'+e(x.supplierName||'')+'</div><h3 class="item-detail-title">'+e(x.locationName||'')+'</h3></div>';
  const product=l=>'<strong>'+text(l.name||l.itemName)+'</strong>'+(l.internalName&&l.internalName!==l.name?'<small>'+e(l.internalName)+'</small>':'')+(l.sku?'<small>SKU '+e(l.sku)+'</small>':'')+(l.notes?'<small class="operation-line-note">'+e(l.notes)+'</small>':'');
  const emptyLines=()=>notice('Não há linhas de itens cadastradas neste registro.',true);
  function linesView(lines,kind){
    if(!lines.length)return emptyLines();
    if(kind==='order')return table(['Produto / SKU','Pedida','Recebida','Unidade','Preço estimado','Total estimado'],lines.map(l=>row([product(l),number(l.orderedQuantity??l.quantity??l.qty),number(l.receivedQuantity),text(l.uom),amount(l.estimatedUnitPrice??l.unitPrice),amount(l.lineTotal)])));
    return table(['Produto / SKU','Quantidade','Unidade','Quantidade base','Preço unitário','Total'],lines.map(l=>row([product(l),number(l.quantity??l.qty),text(l.uom),quantity(l.quantityBase,l.baseUom),amount(l.unitPrice??l.unitCost),amount(l.lineTotal)])));
  }
  function lineReferences(lines,transfer=false){
    if(!lines.length)return '';
    return '<details class="operation-details"><summary>Unidades e referências dos itens</summary>'+table(['Item','Identificador da linha','Unidade do item','Unidade base','Fator cadastrado'],lines.map(l=>row([text(l.internalName||l.name),text(l.id),text(l.itemUnitId),text(l.baseUom),number(l.unitFactor??l.currentUnitFactor)])))+'<p class="operation-help">'+(transfer?'O fator da solicitação foi preservado no cadastro.':'Os fatores vêm do cadastro atual. Quantidades base são mostradas somente quando registradas na operação.')+'</p></details>';
  }
  function confirmedQuantitiesView(r){
    const lines=list(r.confirmedInvoiceLines);
    const explanation=notice('Recebimento integral confirmado pelo usuário, sem movimentação de estoque. As quantidades abaixo vêm do invoice; não representam uma nova contagem física.',true);
    return explanation+(lines.length?table(['Produto / SKU','Quantidade recebida conforme invoice','Unidade'],lines.map(l=>row([product(l),number(l.quantity),text(l.uom)]))):notice('O invoice não possui quantidades detalhadas cadastradas. A confirmação é do recebimento integral do documento; nenhum número foi estimado.',true));
  }
  function receiptsView(receipts){
    if(!receipts.length)return section('Recebimentos',notice('Não há recebimento explicitamente vinculado a este registro. Isso não confirma que a mercadoria esteja em trânsito.',true));
    return section('Recebimentos',receipts.map(r=>'<article class="operation-record"><div class="operation-record-head"><strong>Recebimento '+e(String(r.id||'').slice(0,7).toUpperCase())+'</strong>'+status(r.dbStatus??r.status)+'</div>'+grid([['Recebido em',when(r.receivedAt,r.receivedDateOnly)],['Loja',text(r.locationName)],['Linhas cadastradas',number(r.lineCount??list(r.lines).length)]])+(r.historicalConfirmation?confirmedQuantitiesView(r):linesView(list(r.lines),'receipt'))+(list(r.lines).some(l=>l.storageAreaName)?'<details class="operation-details"><summary>Áreas de armazenagem</summary>'+table(['Item','Área','Recebida','Quantidade base'],r.lines.map(l=>row([text(l.internalName||l.name),text(l.storageAreaName),quantity(l.receivedQuantity??l.quantity,l.uom),quantity(l.quantityBase,l.baseUom)])))+'</details>':'')+notes(r.notes)+'</article>').join(''));
  }
  function documentsView(documents){
    if(!documents.length)return section('Documentos',notice('Nenhum documento vinculado foi encontrado.',true));
    return section('Documentos',documents.map(d=>'<article class="operation-document"><div class="operation-document-head">'+icon('file-text')+'<div><strong>'+text(d.fileName)+'</strong><small>'+text(d.mimeType||d.storedMimeType)+(d.sizeBytes!=null?' · '+e(preciseNumber(d.sizeBytes/1024))+' KB':'')+'</small></div><span class="status '+(d.fileExists===true?'green':d.fileExists===false?'amber':'')+'">'+(d.fileExists===true?'Arquivo presente':d.fileExists===false?'Arquivo não encontrado':'Presença não verificada')+'</span></div>'+grid([['Cadastrado em',when(d.createdAt)],['Armazenado em',when(d.storageCreatedAt)],['Última atualização',when(d.storageUpdatedAt)]])+'<details class="operation-details"><summary>Referência do arquivo</summary>'+grid([['Nome',text(d.fileName)],['Tipo',text(d.mimeType)],['Caminho registrado',text(d.storagePath)],['Identificador',text(d.id)],['Tamanho em bytes',number(d.sizeBytes)]])+'</details></article>').join('')+'<p class="operation-help">Esta consulta apresenta os metadados registrados; a presença do arquivo só é indicada quando verificada.</p>');
  }
  function timelineView(x){
    const events=list(x.timeline).length?x.timeline:list(x.history);
    return events.length?section('Histórico registrado','<ol class="operation-timeline">'+events.map(t=>'<li><time>'+when(t.at,t.dateOnly)+'</time><div><strong>'+text(t.text||t.action)+'</strong>'+(t.number?'<small>Nota '+e(t.number)+'</small>':'')+(t.fileName?'<small>'+e(t.fileName)+'</small>':'')+(t.newStatus?'<small>Situação registrada: '+e(t.newStatus)+'</small>':'')+'</div></li>').join('')+'</ol>'):'';
  }
  function transactionsView(x){
    const transactions=list(x.transactions),labels={purchase_receipt:'Entrada de compra',transfer_out:'Saída de transferência',transfer_in:'Entrada de transferência',manual_adjustment:'Ajuste de estoque'};
    let out=list(x.transactionExceptions).length?notice('Há '+e(x.transactionExceptions.length)+' movimento(s) históricos de outra loja separados da movimentação desta operação. A referência foi preservada para conferência.',true):'';
    const corrections=list(x.historicalCorrections);
    if(corrections.length)out+=notice(e(x.historicalCorrectionSummary?.explanation||'Movimentações históricas em outra loja, preservadas para conferência.'),true)+'<details class="operation-details operation-ledger"><summary>Movimentações históricas corrigidas ('+corrections.length+')</summary>'+table(['Data','Movimento / item','Loja','Quantidade base','Custo total'],corrections.map(t=>row([when(t.occurredAt),'<strong>'+e(labels[t.transactionType]||t.transactionType||'Movimento')+'</strong><small>'+text(t.internalName||t.itemName)+'</small>',text(t.locationName),quantity(t.quantityBase,t.baseUom),amount(t.totalCost)])))+'</details>';
    if(transactions.length)out+='<details class="operation-details operation-ledger"><summary>Movimentos de estoque vinculados ('+transactions.length+')</summary>'+table(['Data','Movimento / item','Loja / área','Quantidade base','Custo por unidade base','Custo total'],transactions.map(t=>row([when(t.occurredAt),'<strong>'+e(labels[t.transactionType]||t.transactionType||'Movimento')+'</strong><small>'+text(t.internalName||t.itemName)+'</small>',text(t.locationName)+'<small>'+text(t.storageAreaName)+'</small>',quantity(t.quantityBase,t.baseUom),amount(t.unitCostBase),amount(t.totalCost)])))+'<p class="operation-help">Movimentos com vínculo explícito. Esta lista não representa o saldo atual de estoque.</p></details>';
    return out;
  }
  const references=x=>'<details class="operation-details"><summary>Referências do cadastro</summary>'+grid([['Identificador',text(x.id)],['Situação original',text(x.dbStatus??x.status)],['Criado em',when(x.createdAt)],['Atualizado em',when(x.updatedAt)]])+'</details>';
  const ending=x=>notes(x.notes)+timelineView(x)+transactionsView(x)+references(x);
  const linkedButton=(label,action,id)=>btn(label,action,'arrow-up-right','sm','data-id="'+e(id)+'"');
  function showInvoice(x,footer=''){
    const stored=x.dbStatus??x.status,paid=stored==='paid';
    const approval=stored==='approved'?'Aprovada':paid?'Registro marcado como pago':null;
    let body=intro(x)+grid([['Situação cadastrada',status(stored)],['Pagamento',paid?status('paid'):'<span class="muted">Sem confirmação de pagamento</span>'],['Aprovação',text(approval)],['Recebimento vinculado',x.receiptStatus?status(x.receiptStatus):absent],['Emissão',when(x.date,true)],['Vencimento',when(x.dueDate,true)],['Moeda',text(x.currency)],['Itens cadastrados',number(x.lineCount??list(x.lines).length)]]);
    body+=section('Valores da nota',grid([['Subtotal',amount(x.subtotal)],['Impostos',amount(x.tax)],['Taxas',amount(x.fees)],['Total',amount(x.total)]]));
    if(paid)body+='<p class="operation-help">O banco registra esta nota como paga. Data, método e valor do pagamento não estão cadastrados separadamente.</p>';
    body+=section('Itens da nota',linesView(list(x.lines),'invoice'))+lineReferences(list(x.lines));
    if(x.linkedOrder)body+=section('Pedido vinculado','<div class="operation-linked-record"><div><strong>'+e(ref(x.linkedOrder))+'</strong><small>'+text(x.linkedOrder.supplierName)+'</small></div>'+status(x.linkedOrder.status)+linkedButton('Abrir pedido','order',x.linkedOrder.id)+'</div>');
    body+=receiptsView(list(x.receipts))+documentsView(list(x.documents))+ending(x);
    openModal('Invoice '+e(ref(x)),body,footer||btn('Fechar','close'),{wide:true,className:'operation-modal',kind:'invoice-detail'});
  }
  function showOrder(x,footer=''){
    const evidence=x.receiptEvidence||{},labels={confirmed_received:'Quantidades recebidas — confirmação do usuário',fully_received:'Recebimento completo nas linhas vinculadas',partially_received:'Recebimento parcial nas linhas vinculadas',receipt_recorded:'Há recebimento registrado',no_receipt_recorded:'Sem recebimento vinculado'};
    let body=intro(x)+grid([['Situação cadastrada',status(x.dbStatus??x.status,x.statusLabel)],['Recebimento',text(labels[evidence.computedStatus])],['Pedido em',when(x.orderedAt)],['Entrega prevista',when(x.expectedAt)],['Itens cadastrados',number(x.lineCount??list(x.lines).length)],['Total estimado',amount(x.total)]]);
    if(x.paymentEvidence?.paidInvoiceCount)body+=notice(e(x.paymentEvidence.paidInvoiceCount)+' nota(s) vinculada(s) marcada(s) como paga(s). Pagamento e recebimento de mercadorias são registros separados.',true);
    body+=section('Itens do pedido',linesView(list(x.lines),'order'))+lineReferences(list(x.lines));
    if(evidence.comparableLineCount!=null)body+='<p class="operation-help">A conferência compara '+e(evidence.comparableLineCount)+' de '+e(evidence.orderLineCount??0)+' linhas com vínculo explícito e a mesma unidade. Campos ausentes permanecem sem confirmação.</p>';
    body+=receiptsView(list(x.receipts))+section('Notas vinculadas',list(x.invoices).length?table(['Nota','Emissão','Situação','Total',''],x.invoices.map(i=>row([text(i.number||ref(i)),when(i.date,true),status(i.status),amount(i.total),linkedButton('Abrir nota','invoice',i.id)]))):notice('Nenhuma nota vinculada a este pedido.',true));
    if(list(x.tags).length)body+=section('Marcadores','<div class="operation-tags">'+x.tags.map(t=>'<span class="tag">'+e(t.name)+'</span>').join('')+'</div>');
    body+=ending(x);
    openModal('Ordem '+e(ref(x)),body,footer||btn('Fechar','close'),{wide:true,className:'operation-modal',kind:'order-detail'});
  }
  function showTransfer(x,footer=''){
    const lines=list(x.lines);
    let body='<div class="operation-transfer-route"><strong>'+text(x.fromLocationName)+'</strong>'+icon('arrow-right')+'<strong>'+text(x.toLocationName)+'</strong></div>'+grid([['Situação da solicitação',status(x.dbStatus??x.status)],['Necessária em',when(x.date||x.neededOn,true)],['Itens solicitados',number(x.lineCount??lines.length)],['Despachos',number(list(x.dispatches).length)],['Recebimentos',number(list(x.receipts).length)]]);
    body+=section('Quantidades por item',lines.length?table(['Item','Solicitada','Aprovada','Enviada','Recebida','Em trânsito','A enviar','Unidade'],lines.map(l=>row([product(l),number(l.requestedQuantity??l.quantity??l.qty),number(l.approvedQuantity),number(l.dispatchedQuantity),number(l.receivedQuantity),number(l.inTransitQuantity),number(l.remainingToDispatch),text(l.uom)]))):emptyLines())+lineReferences(lines,true);
    const dispatches=list(x.dispatches).map(d=>'<article class="operation-record"><div class="operation-record-head"><strong>Despacho '+e(String(d.id||'').slice(0,7).toUpperCase())+'</strong><span>'+when(d.dispatchedAt)+'</span></div>'+table(['Item','Enviada','Área de origem'],list(d.lines).map(l=>row([text(l.name||l.internalName),quantity(l.dispatchedQuantity??l.quantity,l.uom),text(l.fromStorageAreaName)])))+notes(d.notes)+list(d.receipts).map(r=>'<div class="operation-receipt"><h4>Recebimento em '+when(r.receivedAt,r.receivedDateOnly)+'</h4>'+table(['Item','Recebida','Área de destino'],list(r.lines).map(l=>row([text(l.name||l.internalName),quantity(l.receivedQuantity??l.quantity,l.uom),text(l.toStorageAreaName)])))+notes(r.notes)+'</div>').join('')+'</article>').join('');
    body+=section('Despachos e recebimentos',dispatches||notice('Nenhum despacho foi registrado para esta solicitação.',true))+ending(x);
    openModal('Transferência interna '+e(ref(x)),body,btn('Imprimir','transfer-print','printer','','data-id="'+e(x.id)+'"')+(footer||btn('Fechar','close')),{wide:true,className:'operation-modal',kind:'transfer-detail'});
  }
  return {showInvoice,showOrder,showTransfer};
}
