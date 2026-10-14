import {ApiError,jsonBody,reply} from './auth.mjs';
import {ORGANIZATION_ID} from './supabase-config.mjs';
const uuid=/^[a-f0-9-]{36}$/;
export async function editTransfer(req,res,url,auth,session){
 const match=url.pathname.match(/^\/api\/transfers\/([a-f0-9-]{36})\/edit$/);
 if(!match||req.method!=='POST')throw new ApiError(404,'Resource not found.');
 if(!['owner','admin','manager','chef'].includes(session.member?.role))throw new ApiError(403,'You do not have permission to edit transfers.');
 const body=await jsonBody(req,65536);
 if(!Array.isArray(body.lines)||!body.lines.length||body.lines.length>200||body.lines.some(l=>!l||!uuid.test(l.itemId)||!uuid.test(l.itemUnitId)||!Number.isFinite(l.quantity)||l.quantity<=0||l.quantity>1e8))throw new ApiError(400,'Add items with valid units and quantities greater than zero.');
 if(typeof body.notes!=='string'||body.notes.length>4000)throw new ApiError(400,'Enter notes up to 4000 characters.');
 const result=await auth.request('/rest/v1/rpc/edit_internal_request',{token:session.token,method:'POST',body:{p_request:match[1],p_organization:ORGANIZATION_ID,p_lines:body.lines.map(l=>({itemId:l.itemId,itemUnitId:l.itemUnitId,quantity:l.quantity})),p_notes:body.notes}});
 reply(res,200,result);
}
export async function reportTransferIssue(req,res,url,auth,session){
 const match=url.pathname.match(/^\/api\/transfers\/([a-f0-9-]{36})\/issue$/);
 if(!match||req.method!=='POST')throw new ApiError(404,'Resource not found.');
 if(!['owner','admin','manager','chef'].includes(session.member?.role))throw new ApiError(403,'You do not have permission to report transfer issues.');
 const body=await jsonBody(req,8192);
 if(body.type!=='not_sent'||!uuid.test(body.lineId))throw new ApiError(400,'Select the item and the issue.');
 if(typeof body.reason!=='string'||!body.reason.trim()||body.reason.trim().length>1000)throw new ApiError(400,'Enter a reason up to 1000 characters.');
 const result=await auth.request('/rest/v1/rpc/report_internal_request_line_not_sent',{token:session.token,method:'POST',body:{p_request:match[1],p_organization:ORGANIZATION_ID,p_line:body.lineId,p_reason:body.reason.trim()}});
 reply(res,200,result);
}
