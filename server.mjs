import {saveInventoryDraft} from './server/inventory-count.mjs';
import {editOrder} from './server/order-edit.mjs';
import {editTransfer,reportTransferIssue} from './server/transfer-edit.mjs';
import {myDayAPI} from './server/my-day.mjs';
import {loadProfile,requireProfileRequest,requireProfileCommand} from './server/permission-profiles.mjs';
import {hrAPI} from './server/hr.mjs';
import {careersAPI} from './server/careers.mjs';
import {insightsService} from './server/doogy-insights.mjs';
import {agentService} from './server/doogy-agent.mjs';
import {conversationService} from './server/doogy-chat.mjs';
import {readWhatsappDirectory} from './server/doogy-ai.mjs';
import {invoiceIntake} from './server/invoice-intake.mjs';
import {requireStaffRequest,requireStaffCommand} from './server/staff-access.mjs';
import {preparationUsage} from './server/preparation-usage.mjs';
import {invoiceDownload} from './server/invoice-download.mjs';
import {serveTaskCalendar} from './server/my-day-calendar.mjs';
import {updateInvoiceStatus,deleteInvoice,deleteOrder} from './server/invoice-status.mjs';
import {replyData} from './server/compressed-json.mjs';
import {queueSalesSummary} from './server/sales-summary.mjs';
import {invoiceUpload} from './server/invoice-api.mjs';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createAuth,ApiError,reply,jsonBody} from './server/auth.mjs';
import {readTables,projectData} from './server/live-data.mjs';
import {photos} from './server/photo-api.mjs';
const root=path.dirname(fileURLToPath(import.meta.url)),port=Number(process.env.PORT||4173),auth=createAuth();
const allowedHosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`]);
const mime={'.mjs':'text/javascript; charset=utf-8','.wasm':'application/wasm','.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf'};
http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(!allowedHosts.has(req.headers.host)||req.headers['sec-fetch-site']==='cross-site')throw new ApiError(403,"Origin not allowed.");
  if(!['GET','HEAD'].includes(req.method)&&req.headers.origin!==`http://${req.headers.host}`)throw new ApiError(403,"Origin not allowed.");
  if(url.pathname.startsWith('/calendar/my-day/'))return await serveTaskCalendar(req,res,url,auth);
  if(await auth.handle(req,res,url))return;
  if(url.pathname.startsWith('/api/')){
   const session=await auth.requireSession(req);
   requireStaffRequest(session.member.role,req.method,url.pathname);
   const profile=await loadProfile(auth,session);requireProfileRequest(profile,req.method,url.pathname);
   if(url.pathname.startsWith('/api/my-day'))return await myDayAPI(req,res,url,auth,session);
   if(['/api/invoices/team-members','/api/preparation/team-members'].includes(url.pathname)&&req.method==='GET')return reply(res,200,await auth.request('/rest/v1/rpc/operations_team_directory',{token:session.token,method:'POST',body:{p_module:url.pathname.includes('/invoices/')?'purchasing':'preparation'}}));
   if(url.pathname.startsWith('/api/hr/careers'))return await careersAPI(req,res,url,auth,session);
   if(url.pathname.startsWith('/api/hr'))return await hrAPI(req,res,url,auth,session);
   if(/^\/api\/orders\/[^/]+\/edit$/.test(url.pathname))return await editOrder(req,res,url,auth,session);
   if(/^\/api\/transfers\/[^/]+\/edit$/.test(url.pathname))return await editTransfer(req,res,url,auth,session);
   if(/^\/api\/transfers\/[^/]+\/issue$/.test(url.pathname))return await reportTransferIssue(req,res,url,auth,session);
   if(/^\/api\/orders\/[^/]+\/delete$/.test(url.pathname))return await deleteOrder(req,res,url,auth,session);
   if(/^\/api\/invoices\/[^/]+\/delete$/.test(url.pathname))return await deleteInvoice(req,res,url,auth,session);
   if(/^\/api\/invoices\/[^/]+\/status$/.test(url.pathname))return await updateInvoiceStatus(req,res,url,auth,session);
   if(/^\/api\/invoices\/[^/]+\/documents\/[^/]+\/download$/.test(url.pathname))return await invoiceDownload(req,res,url,auth,session);
   if(url.pathname.startsWith('/api/invoices/analysis-jobs')||['/api/invoices/analyze','/api/invoices/draft'].includes(url.pathname)||url.pathname.endsWith('/approve-draft')||url.pathname.endsWith('/edit-draft'))return await invoiceIntake(req,res,url,auth,session);
   if(url.pathname.startsWith('/api/invoices/'))return await invoiceUpload(req,res,url,auth,session);
   if(url.pathname.startsWith('/api/photos'))return await photos(req,res,url,auth,session);
   if(['/api/preparation/preparer','/api/inventory/counter'].includes(url.pathname)&&req.method==='GET')return reply(res,200,await auth.request('/rest/v1/rpc/operations_current_preparer',{token:session.token,method:'POST',body:{}}));
   if(url.pathname==='/api/preparation/team-member'&&req.method==='POST'){const b=await jsonBody(req,4096);return reply(res,200,await auth.request('/rest/v1/rpc/set_prep_team_member',{token:session.token,method:'POST',body:{p_batch:b.id,p_expected_version:b.expectedVersion,p_team:b.teamMemberId}}));}
   if(url.pathname==='/api/preparation/usage')return preparationUsage(req,res,url,auth,session);
   if(url.pathname==='/api/inventory/count-draft'&&req.method==='POST'){const body=await jsonBody(req,600000);return reply(res,200,await saveInventoryDraft(auth,session,body));}
   if(url.pathname==='/api/inventory/count-edit'&&req.method==='POST'){
    const body=await jsonBody(req);
    return reply(res,200,await auth.request('/rest/v1/rpc/edit_inventory_count',{token:session.token,method:'POST',body:{p_source:body.source,p_id:body.id,p_quantity:body.quantity,p_unit:body.unit,p_old_quantity:body.oldQuantity,p_old_unit:body.oldUnit}}));
   }
   if(url.pathname==='/api/inventory/count-notes'&&req.method==='GET'){
    const id=url.searchParams.get('id'),location=url.searchParams.get('location');
    if(!/^[a-f0-9-]{36}$/.test(id||'')||!/^[a-f0-9-]{36}$/.test(location||''))throw new ApiError(400,'Invalid count.');
    return reply(res,200,await auth.request('/rest/v1/rpc/inventory_count_notes',{token:session.token,method:'POST',body:{p_session:id,p_location:location}}));
   }
   if(url.pathname==='/api/data'&&req.method==='GET'){const raw=await readTables(auth,session.token,session.member.role);const data=projectData(raw);data.access={role:session.member.role,profile};if(['owner','admin','manager','chef'].includes(session.member.role)){const summary=queueSalesSummary(auth,session,raw);data.preparationSales=summary.result?Object.fromEntries(Object.entries(summary.result).filter(([k])=>k!=='purchasingSales')):null;data.purchasingSales=summary.result?.purchasingSales||null;data.meta.preparationSalesStatus=summary.status;if(summary.result){data.meta.pendingImportRows=summary.result.days.reduce((n,x)=>n+x.incompleteLines,0);data.issues=summary.result.issues.map(x=>({...x,count:x.occurrences,label:x.code,locationName:data.locations.find(l=>l.id===x.locationId)?.name}));}}return await replyData(req,res,data);}
   if(url.pathname==='/api/catalog/delete'&&req.method==='POST'){const body=await jsonBody(req,4096);if(body.confirmed!==true||!/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(body.id||''))throw new ApiError(400,'Confirm deletion of a valid item.');return reply(res,200,await auth.request('/rest/v1/rpc/delete_catalog_item',{token:session.token,method:'POST',body:{p_id:body.id,p_confirmed:true}}));}
   if(url.pathname==='/api/doogy-ai/insights'&&req.method==='POST'){if(!['owner','admin'].includes(session.member.role))throw new ApiError(403,'Insights are available to administrators only.');const body=await jsonBody(req,4096);const data=projectData(await readTables(auth,session.token,session.member.role));return reply(res,200,await insightsService.start(session,data,body.location||'all',body.requestId));}
   if(url.pathname==='/api/doogy-ai/insights'&&req.method==='GET')return reply(res,200,await insightsService.result(session,url.searchParams.get('id')));
   if(url.pathname==='/api/doogy-ai/agent/history'&&req.method==='GET')return reply(res,200,await agentService.history(session.member.role,session.user.id));
   if(url.pathname==='/api/doogy-ai/agent/send'&&req.method==='POST')return reply(res,200,await agentService.send(session.member.role,session.user.id,await jsonBody(req,20000)));
   if(url.pathname.startsWith('/api/doogy-ai/conversation/')){
    const action=url.pathname.split('/').at(-1),role=session.member.role;
    if(req.method==='GET'&&action==='history')return reply(res,200,await conversationService.history(role,url.searchParams.get('id'),Number(url.searchParams.get('offset')||0)));
    if(req.method==='GET'&&action==='settings')return reply(res,200,await conversationService.settings(role,url.searchParams.get('id')));
    if(req.method==='POST'&&['send','settings'].includes(action)){const body=await jsonBody(req,100000);return reply(res,200,action==='send'?await conversationService.send(role,session.user.id,body.id,body):await conversationService.saveSettings(role,body.id,body));}
    throw new ApiError(404,'Conversation action not found.');
   }
   if(url.pathname==='/api/doogy-ai/whatsapp'&&req.method==='GET')return reply(res,200,await readWhatsappDirectory(session.member.role));
   if(url.pathname==='/api/waste/reporter'&&req.method==='GET')return reply(res,200,await auth.request('/rest/v1/rpc/operations_current_preparer',{token:session.token,method:'POST',body:{}}));
   if(url.pathname==='/api/waste'&&req.method==='POST'){const body=await jsonBody(req,8192);return reply(res,200,await auth.request('/rest/v1/rpc/record_waste',{token:session.token,method:'POST',body:{p_id:body.id,p:body.payload}}));}
   if(url.pathname==='/api/catalog/create'&&req.method==='POST'){const body=await jsonBody(req);const result=await auth.request('/rest/v1/rpc/catalog_create',{token:session.token,method:'POST',body:{p_kind:body.kind,p_payload:body.payload,p_command_id:body.commandId}});return reply(res,200,result);}
   if(url.pathname==='/api/command'&&req.method==='POST'){const body=await jsonBody(req);requireStaffCommand(session.member.role,body);requireProfileCommand(profile,body);const counts=body.payload.changes.filter(c=>c.action==='counts');if(counts.length){const counter=await auth.request('/rest/v1/rpc/operations_current_preparer',{token:session.token,method:'POST',body:{}});if(!counter?.name?.trim())throw new ApiError(422,'Your account name could not be loaded.');for(const change of counts)change.payload.employeeName=counter.name.trim().slice(0,80);}if(body.payload.changes.some(c=>c.action==='receipt'&&c.payload?.lines?.length>0&&!/^[a-f0-9-]{36}$/.test(c.payload?.receiverTeamMemberId||'')))throw new ApiError(422,'Choose the team member who received this order.');const result=await auth.request('/rest/v1/rpc/operations_command',{token:session.token,method:'POST',body:{p_action:body.action,p_payload:body.payload,p_command_id:body.commandId}});return reply(res,200,result);}
   throw new ApiError(404,"Resource not found.");
  }
  // Historical exports are never served, even to logged-in users. Live data uses RLS.
  if(url.pathname.startsWith('/data/'))throw new ApiError(404,"Resource not found.");
  if(!['GET','HEAD'].includes(req.method))throw new ApiError(405,"Method not allowed.");
  const part=decodeURIComponent(url.pathname);
  if(part.includes('..')||part.includes('\\')||part.split('/').some(p=>p.startsWith('.')))throw new ApiError(403,"Access denied.");
  const relative=part==='/'?'index.html':part.startsWith('/src/')?part.slice(1):'public'+part,file=path.resolve(root,relative);
  if(file.startsWith(path.join(root,'public','data')+path.sep)||!file.startsWith(root+path.sep))throw new ApiError(403,"Access denied.");
  const body=await readFile(file);
  res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'"});res.end(req.method==='HEAD'?undefined:body);
 }catch(error){reply(res,error.status||500,{error:error.status?error.message:"Unable to complete the request. Try again."});}
}).listen(port,'127.0.0.1',()=>console.log(`HOT DOOGY Operations → http://127.0.0.1:${port}`));
