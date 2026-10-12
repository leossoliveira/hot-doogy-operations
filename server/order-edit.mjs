import {ApiError,jsonBody,reply} from './auth.mjs';
import {ORGANIZATION_ID} from './supabase-config.mjs';
import {canEditInvoiceStatus} from '../src/invoice-status.js';
export async function editOrder(req,res,url,auth,session){
 const match=url.pathname.match(/^\/api\/orders\/([a-f0-9-]{36})\/edit$/);
 if(!match||req.method!=='POST')throw new ApiError(404,'Resource not found.');
 if(!canEditInvoiceStatus(session.member?.role))throw new ApiError(403,'You do not have permission to edit orders.');
 const body=await jsonBody(req,65536);
 if(typeof body.number!=='string'||!body.number.trim()||body.number.trim().length>100||!Number.isFinite(Date.parse(body.expectedUpdatedAt))||!Array.isArray(body.lines)||body.lines.length>200||body.lines.some(l=>!l||typeof l.id!=='string'||!Number.isFinite(l.quantity)||l.quantity<=0||l.quantity>1e8||(l.price!==null&&(!Number.isFinite(l.price)||l.price<0||l.price>1e8))))throw new ApiError(400,'Enter a valid identifier, quantities and prices. Reload the order before saving.');
 const result=await auth.request('/rest/v1/rpc/edit_order_details',{token:session.token,method:'POST',body:{p_order:match[1],p_organization:ORGANIZATION_ID,p_expected_updated_at:body.expectedUpdatedAt,p_number:body.number.trim(),p_lines:body.lines}});
 reply(res,200,result);
}
