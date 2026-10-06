export const FINANCIAL_STATUSES=[['unpaid','Unpaid'],['paid','Paid'],['cancelled','Canceled'],['credit','Credit'],['overdue','Overdue']];
export function financialStatus(invoice,now=new Date()){
 const state=invoice.dbStatus??invoice.status;
 if(state==='cancelled')return 'cancelled';
 if(Number(invoice.total)<0||state==='credit')return 'credit';
 if(state==='paid')return 'paid';
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 return invoice.dueDate&&invoice.dueDate.slice(0,10)<day?'overdue':'unpaid';
}
export function invoiceHistory(invoice,order,receipts=invoice.receipts||[]){
 return [
  ...(order?[{at:order.createdAt,text:'Order created'}]:[]),
  ...receipts.filter(r=>(r.dbStatus??r.status)==='completed').sort((a,b)=>String(a.receivedAt||'').localeCompare(String(b.receivedAt||''))).map(r=>({at:r.receivedAt,text:'Received',dateOnly:r.receivedDateOnly})),
  ...((invoice.dbStatus??invoice.status)==='paid'?[{at:invoice.paymentRecordedAt,text:'Invoice paid'}]:[])
 ];
}
