import {ApiError, jsonBody, reply} from './auth.mjs';
import {ORGANIZATION_ID} from './supabase-config.mjs';
import {canEditInvoiceStatus, validInvoiceStatusChange} from '../src/invoice-status.js';

export async function updateInvoiceStatus(req, res, url, auth, session) {
  const match = url.pathname.match(/^\/api\/invoices\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\/status$/);
  if (!match || req.method !== 'POST') throw new ApiError(404, 'Resource not found.');
  if (!canEditInvoiceStatus(session.member?.role)) throw new ApiError(403, 'You do not have permission to manage invoices.');
  const body = await jsonBody(req, 4096);
  if (!validInvoiceStatusChange(body)) throw new ApiError(400, 'Choose a valid invoice status and reload the invoice before saving.');
  const result = await auth.request('/rest/v1/rpc/update_invoice_status', {
    token: session.token, method: 'POST', body: {
      p_invoice_id: match[1], p_organization_id: ORGANIZATION_ID,
      p_status: body.status, p_expected_status: body.expectedStatus,
      p_expected_updated_at: body.expectedUpdatedAt,
    },
  });
  reply(res, 200, result);
}
