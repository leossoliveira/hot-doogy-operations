export const remainingToReceive = line => Math.max(0, Number(line.orderedPurchaseQty ?? line.orderedQuantity ?? line.quantity ?? line.qty ?? 0) - Number(line.receivedQuantity ?? 0));

export function mountOrderReceiving(order, {root, e, icon, onReportIssue}) {
 const active = ['ordered','partially_received'].includes(order.status);
 const table = root.querySelector('.order-items-table table');
 if (!table) return;
 table.tHead.rows[0].insertAdjacentHTML('beforeend', '<th>Receiving</th>');
 for (const row of table.tBodies[0].rows) {
  const line = order.lines.find(line => line.id === row.dataset.orderLine);
  const name = e(line.productDescription || line.name || line.itemName || 'item');
  if(line.sourceInvoiceLineId&&line.orderedPurchaseQty!=null&&Number(line.orderedPurchaseQty)<=0){row.insertAdjacentHTML('beforeend','<td>Credit / adjustment — no receipt</td>');continue;}
  if(line.catalogPending||line.sourceInvoiceLineId&&line.orderedPurchaseQty==null){row.insertAdjacentHTML('beforeend','<td>Match product, unit and quantity before receiving</td>');continue;}
  const history = (line.receiptIssues || []).map(issue => `<small class="transfer-line-progress not-sent">Not received: ${e(issue.quantity)} · ${e(issue.reason)}</small>`).join('');
  row.insertAdjacentHTML('beforeend', `<td>${active && remainingToReceive(line) > 0 ? `<span class="transfer-line-actions"><button type="button" class="icon-btn transfer-line-check" data-receive-choice="received" aria-pressed="false" aria-label="Mark ${name} as received" title="Mark as received">${icon('check')}</button><button type="button" class="icon-btn transfer-line-issue" data-receive-choice="issue" aria-haspopup="dialog" aria-label="Report issue for ${name}" title="Report issue">${icon('info')}</button></span>` : remainingToReceive(line) === 0 ? '<span class="transfer-line-badge shipped">Received</span>' : 'Pending'}${history}</td>`);
  for (const button of row.querySelectorAll('[data-receive-choice]')) button.onclick = () => {
   if(button.dataset.receiveChoice==='issue'){onReportIssue(line);return;}
   const selected = button.getAttribute('aria-pressed') !== 'true';
   button.setAttribute('aria-pressed',String(selected));
   row.classList.toggle('transfer-line-selected', selected);
  };
 }
}

export function selectedReceiptLines(order, root) {
 return [...root.querySelectorAll('[data-receive-choice][aria-pressed="true"]')].map(button => ({...order.lines.find(line => line.id === button.closest('tr').dataset.orderLine), reportIssue: button.dataset.receiveChoice === 'issue'}));
}

export function receiptPayload(rows) {
 const lines = [], issues = [];
 for (const row of rows) {
  const quantity = Number(row.quantity), remaining = remainingToReceive(row.line);
  if (!Number.isFinite(quantity) || quantity < 0 || quantity > remaining) throw Error('Enter a received quantity between zero and the pending quantity.');
  if (quantity > 0) {
   if (!row.areaId) throw Error('Choose a storage area for every received item.');
   lines.push({lineId:row.line.id, quantity, areaId:row.areaId});
  }
  if (row.reportIssue) {
   const reason = row.reason.trim();
   if (!reason || reason.length > 1000 || remaining - quantity <= 0) throw Error('Describe the issue and leave the quantity not received pending.');
   issues.push({lineId:row.line.id, quantity:remaining - quantity, reason});
  }
 }
 if (!lines.length && !issues.length) throw Error('Select at least one item to receive or report.');
 return {lines, issues};
}

export function receiptFormBody(order,selected,team,inventory,{e,number}) {
 return `<form id="receipt-form"><p>Confirm each selected item. Only received quantities are added to stock; quantities with issues remain pending.</p><label class="field">Received by<select name="receiverTeamMemberId" required><option value="">Choose team member</option>${team.filter(t=>t.locations.includes(order.locationId)).map(t=>`<option value="${e(t.id)}">${e(t.name)}</option>`).join('')}</select></label>${selected.map(l=>{const areas=inventory.find(i=>i.id===l.itemId&&i.locationId===order.locationId)?.areas.filter(a=>a.locationId===order.locationId)||[];return `<div class="field" data-receipt-line="${e(l.id)}"><label for="receipt-qty-${e(l.id)}">${e(l.name)} · ${e(l.uom)} · Pending: ${e(number(remainingToReceive(l)))}</label><input id="receipt-qty-${e(l.id)}" type="number" min="0" max="${remainingToReceive(l)}" step="any" value="${l.reportIssue?0:remainingToReceive(l)}" required aria-label="Quantity received for ${e(l.name)}"><select aria-label="Storage area for ${e(l.name)}"><option value="">Select area</option>${areas.map(a=>`<option value="${e(a.id)}" ${areas.length===1?'selected':''}>${e(a.name)}</option>`).join('')}</select>${l.reportIssue?`<label for="receipt-reason-${e(l.id)}">Issue — quantity not received</label><textarea id="receipt-reason-${e(l.id)}" required maxlength="1000" rows="3" placeholder="Describe missing, damaged, or rejected items"></textarea><small>The pending quantity minus the received quantity will be recorded with this issue.</small>`:''}</div>`;}).join('')}<p id="receipt-error" role="alert" class="error-text"></p></form>`;
}

export function openOrderIssue({line,e,number,openModal,btn,onSave,onBack}) {
 const remaining=remainingToReceive(line);
 openModal('Report issue',`<form id="order-issue-form" class="transfer-issue-form"><p><strong>${e(line.name||line.itemName)}</strong> · ${e(number(remaining))} ${e(line.uom||'')} left to receive</p><div class="form-grid"><div class="field"><label for="order-issue-type">Issue</label><select id="order-issue-type" required><option value="not_received">Item not received</option></select></div><div class="field"><label for="order-issue-quantity">Quantity not received (${e(line.uom||'units')})</label><input id="order-issue-quantity" type="number" min="0.000001" max="${remaining}" step="any" value="${remaining}" required></div></div><div class="field"><label for="order-issue-reason">Reason</label><textarea id="order-issue-reason" required maxlength="1000" rows="3" placeholder="e.g., Missing from delivery or damaged on arrival"></textarea></div><p class="muted">The reported quantity stays pending. Reporting an issue does not add stock.</p><p id="order-issue-error" role="alert" class="error-text"></p></form>`,btn('Back','order-receipt-issue-back')+btn('Report issue','order-receipt-issue-save','info','primary'),{kind:'order-receipt-issue'});
 const form=document.querySelector('#order-issue-form'),save=document.querySelector('[data-action="order-receipt-issue-save"]'),back=document.querySelector('[data-action="order-receipt-issue-back"]');
 let busy=false;
 back.onclick=event=>{event.stopPropagation();if(!busy)onBack();};
 const submit=async event=>{event.preventDefault();event.stopPropagation();if(busy||!form.reportValidity())return;busy=true;save.disabled=true;back.disabled=true;form.inert=true;
  try{await onSave({lineId:line.id,quantity:Number(form.querySelector('input').value),reason:form.querySelector('textarea').value.trim()});}
  catch(error){form.querySelector('#order-issue-error').textContent=error.message;}
  finally{busy=false;save.disabled=false;back.disabled=false;form.inert=false;}
 };
 save.onclick=submit;form.onsubmit=submit;
}
