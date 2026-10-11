import {ApiError, jsonBody, reply} from './auth.mjs';
import {ORGANIZATION_ID} from './supabase-config.mjs';
import {canEditInvoiceStatus, validInvoiceStatusChange, validPaymentDate} from '../src/invoice-status.js';

export async function updateInvoiceStatus(req, res, url, auth, session) {
  const match = url.pathname.match(/^\/api\/invoices\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\/status$/);
  if (!match || req.method !== 'POST') throw new ApiError(404, 'Resource not found.');
  if (!canEditInvoiceStatus(session.member?.role)) throw new ApiError(403, 'You do not have permission to manage invoices.');
  const body = await jsonBody(req, 4096);
  if (!validInvoiceStatusChange(body)) throw new ApiError(400, 'Choose a valid invoice status and reload the invoice before saving.');
  if(body.status==='paid'&&!validPaymentDate(body.paymentDate))throw new ApiError(400,'Choose a valid payment date.');
  if(body.paymentMethod!=null&&!['credit_card','debit_card','bank_transfer'].includes(body.paymentMethod))throw new ApiError(400,'Choose a valid payment method.');
  const result = await auth.request(body.status==='paid'?'/rest/v1/rpc/record_invoice_payment':'/rest/v1/rpc/update_invoice_status', {
    token: session.token, method: 'POST', body: {
      p_invoice_id: match[1], p_organization_id: ORGANIZATION_ID,
      p_status: body.status, p_expected_status: body.expectedStatus,
      p_expected_updated_at: body.expectedUpdatedAt,
      ...(body.status==='paid'?{p_payment_date:body.paymentDate,p_payment_method:body.paymentMethod??null}:{}),
    },
  });
  reply(res, 200, result);
}

export async function deleteInvoice(req,res,url,auth,session){
 const match=url.pathname.match(/^\/api\/invoices\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\/delete$/);
 if(!match||req.method!=='POST')throw new ApiError(404,'Resource not found.');
 if(!canEditInvoiceStatus(session.member?.role))throw new ApiError(403,'You do not have permission to delete invoices.');
 const body=await jsonBody(req,4096);
 if(body?.confirmed!==true||typeof body.expectedUpdatedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(body.expectedUpdatedAt)||!Number.isFinite(Date.parse(body.expectedUpdatedAt)))throw new ApiError(400,'Confirm deletion and reload the invoice before deleting.');
 const result=await auth.request('/rest/v1/rpc/delete_invoice',{token:session.token,method:'POST',body:{p_invoice_id:match[1],p_organization_id:ORGANIZATION_ID,p_expected_updated_at:body.expectedUpdatedAt,p_confirmed:true}});
 reply(res,200,result);
}
