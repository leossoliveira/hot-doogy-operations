import {invoiceDownload} from './server/invoice-download.mjs';
import {updateInvoiceStatus} from './server/invoice-status.mjs';
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
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf'};
http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(!allowedHosts.has(req.headers.host)||req.headers['sec-fetch-site']==='cross-site')throw new ApiError(403,"Origin not allowed.");
  if(!['GET','HEAD'].includes(req.method)&&req.headers.origin!==`http://${req.headers.host}`)throw new ApiError(403,"Origin not allowed.");
  if(await auth.handle(req,res,url))return;
  if(url.pathname.startsWith('/api/')){
   const session=await auth.requireSession(req);
   if(/^\/api\/invoices\/[^/]+\/status$/.test(url.pathname))return await updateInvoiceStatus(req,res,url,auth,session);
   if(/^\/api\/invoices\/[^/]+\/documents\/[^/]+\/download$/.test(url.pathname))return await invoiceDownload(req,res,url,auth,session);
   if(url.pathname.startsWith('/api/invoices/'))return await invoiceUpload(req,res,url,auth,session);
   if(url.pathname.startsWith('/api/photos'))return await photos(req,res,url,auth,session);
   if(url.pathname==='/api/data'&&req.method==='GET'){const raw=await readTables(auth,session.token);const data=projectData(raw);if(['owner','admin','manager','chef'].includes(session.member.role)){const summary=queueSalesSummary(auth,session,raw);data.preparationSales=summary.result?Object.fromEntries(Object.entries(summary.result).filter(([k])=>k!=='purchasingSales')):null;data.purchasingSales=summary.result?.purchasingSales||null;data.meta.preparationSalesStatus=summary.status;if(summary.result){data.meta.pendingImportRows=summary.result.days.reduce((n,x)=>n+x.incompleteLines,0);data.issues=summary.result.issues.map(x=>({...x,count:x.occurrences,label:x.code,locationName:data.locations.find(l=>l.id===x.locationId)?.name}));}}return await replyData(req,res,data);}
   if(url.pathname==='/api/command'&&req.method==='POST'){const body=await jsonBody(req);const result=await auth.request('/rest/v1/rpc/operations_command',{token:session.token,method:'POST',body:{p_action:body.action,p_payload:body.payload,p_command_id:body.commandId}});return reply(res,200,result);}
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
  res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'"});res.end(req.method==='HEAD'?undefined:body);
 }catch(error){reply(res,error.status||500,{error:error.status?error.message:"Unable to complete the request. Try again."});}
}).listen(port,'127.0.0.1',()=>console.log(`HOT DOOGY Operations → http://127.0.0.1:${port}`));
