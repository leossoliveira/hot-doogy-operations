export const INVOICE_STATUSES = Object.freeze([
  ['uploaded', 'Uploaded'], ['processing', 'Processing'], ['review', 'Under review'],
  ['approved', 'Approved'], ['paid', 'Paid'], ['cancelled', 'Canceled'],
]);
export const canEditInvoiceStatus = role => ['owner', 'admin', 'manager'].includes(role);
export const invoiceStatusLabel = value => INVOICE_STATUSES.find(([id]) => id === value)?.[1] || value;
export const isUnpaidInvoice = invoice => !['paid', 'cancelled', 'credit'].includes(invoice.status);
export function validInvoiceStatusChange(body) {
  return body && INVOICE_STATUSES.some(([id]) => id === body.status)
    && INVOICE_STATUSES.some(([id]) => id === body.expectedStatus)
    && typeof body.expectedUpdatedAt === 'string'
    && /^\d{4}-\d{2}-\d{2}T/.test(body.expectedUpdatedAt)
    && Number.isFinite(Date.parse(body.expectedUpdatedAt));
}

export function validPaymentDate(value){
 return typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;
}
