import '/src/responsive.js';
import {createOperationUI} from '/src/operation-ui.js';
import {escape as e,money,date,preciseNumber} from '/src/model.js';
import {sortOrderItems} from '/src/order-edit.js';
import {mountOrderReceiving,selectedReceiptLines,receiptFormBody,receiptPayload,openOrderIssue} from '/src/order-receiving.js';
const root=document.querySelector('#overlay-root'),icon=name=>`<i class="icon" data-lucide="${name}"></i>`,icons=()=>window.lucide.createIcons();
const btn=(label,action,ic='',cls='',extra='')=>`<button class="btn ${cls}" data-action="${action}" ${extra}>${ic?icon(ic):''}${label}</button>`;
const pair=(label,value)=>`<div class="detail-pair"><small>${label}</small><strong>${value}</strong></div>`;
function openModal(title,body,foot,opts={}){root.innerHTML=`<div class="overlay"><section class="modal ${opts.wide?'wide':''} ${opts.className||''}" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><header class="modal-head"><h2 id="dialog-title">${title}</h2>${btn('','close','x')}</header><div class="modal-body">${body}</div><footer class="modal-foot">${foot}</footer></section></div>`;icons();}
const ui=createOperationUI({e,preciseNumber,money,date,status:s=>`<span class="status amber">${e(s==='ordered'?'Awaiting receipt':s)}</span>`,icon,pair,notice:text=>`<p class="operation-help">${text}</p>`,btn,openModal});
const seed=()=>({id:'demo',number:'FDS-640114909',supplierName:'FROZEN DESSERT SUPPLIES',locationName:'Sherwood Plaza',locationId:'store',status:'ordered',orderedAt:'2026-10-13T15:41:00Z',expectedAt:'2026-10-20T13:30:00Z',receipts:[],lines:[['12 oz Clear Dome Ice Cream Cup Lids','12 oz Açaí Bowl Lid (Small)',119.99],['12 oz Yellow Ice Cream Cups','12 oz Açaí Bowl (Small)',129.99],['16 oz Black Ice Cream Cups','16 oz Açaí Bowl (Large)',149.99],['16 oz Clear Dome Ice Cream Cup Lids','16 oz Açaí Bowl Lid (Large)',129.99]].map(([productDescription,name,price],i)=>({id:'line-'+i,itemId:'item-'+i,productDescription,name,internalName:name,uom:'Case',orderedPurchaseQty:1,receivedQuantity:null,estimatedUnitPrice:price,receiptIssues:[]}))});
let order=seed(),selected=[];
function show(){ui.showOrder(order,btn('Record receipt','receive','check','receipt-confirm-button')+btn('Close','close'));mountOrderReceiving(order,{root,e,icon,onReportIssue:line=>{openOrderIssue({line,e,number:preciseNumber,openModal,btn,onBack:show,onSave:async issue=>{line.receiptIssues.push(issue);show();}});icons();}});icons();}
root.onclick=event=>{const button=event.target.closest('[data-action]');if(!button)return;
 if(button.dataset.action==='close')root.innerHTML='';
 if(button.dataset.action==='back')show();
 if(button.dataset.action==='order-items-sort')sortOrderItems(button);
 if(button.dataset.action==='receive'){
 selected=selectedReceiptLines(order,root);if(!selected.length){document.querySelector('#preview-message').textContent='Selecione um item para receber ou relatar um problema.';return;}
 openModal('Receive order',receiptFormBody(order,selected,[{id:'demo-person',name:'Demo Receiver',locations:['store']}],order.lines.map(l=>({id:l.itemId,locationId:'store',areas:[{id:'area',locationId:'store',name:'Dry storage'}]})),{e,number:preciseNumber}),btn('Cancel','back')+btn('Confirm receipt','save','','receipt-confirm-button'));
 }
 if(button.dataset.action==='save'){
 const form=root.querySelector('form');if(!form.reportValidity())return;
 try{const payload=receiptPayload([...root.querySelectorAll('[data-receipt-line]')].map(row=>({line:selected.find(l=>l.id===row.dataset.receiptLine),reportIssue:selected.find(l=>l.id===row.dataset.receiptLine).reportIssue,quantity:row.querySelector('input').value,areaId:row.querySelector('select').value,reason:row.querySelector('textarea')?.value||''})));
 for(const received of payload.lines){const line=order.lines.find(l=>l.id===received.lineId);line.receivedQuantity=(line.receivedQuantity||0)+received.quantity;line.receivedDates=['2026-10-20'];}
 for(const issue of payload.issues)order.lines.find(l=>l.id===issue.lineId).receiptIssues.push(issue);
 if(payload.lines.length)order.status=order.lines.every(l=>l.receivedQuantity>=l.orderedPurchaseQty)?'received':'partially_received';
 document.querySelector('#preview-message').textContent='Demonstração salva apenas nesta página. Nenhum estoque real foi alterado.';show();
 }catch(error){root.querySelector('#receipt-error').textContent=error.message;}}
};
document.querySelector('#open').onclick=show;document.querySelector('#reset').onclick=()=>{order=seed();document.querySelector('#preview-message').textContent='';show();};show();
