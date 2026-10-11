import http from 'node:http';
import {ApiError} from './auth.mjs';
export function bridgeRequest(action,payload={}){
 return new Promise((resolve,reject)=>{
  const body=JSON.stringify({action,...payload});
  const req=http.request({socketPath:process.env.HOT_DOOGY_OPENCLAW_SOCKET,path:'/',method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},res=>{
   let text='';res.setEncoding('utf8');res.on('data',chunk=>{text+=chunk;if(text.length>2*1024*1024)res.destroy(Error('Response too large'));});
   res.on('error',()=>reject(new ApiError(503,'OpenClaw connection unavailable. Try again.')));
   res.on('end',()=>{try{const value=JSON.parse(text);if(res.statusCode!==200)return reject(new ApiError(res.statusCode,value.error||'OpenClaw request failed.'));resolve(value);}catch{reject(new ApiError(503,'OpenClaw returned an invalid response.'));}});
  });
  req.setTimeout(40000,()=>req.destroy(Error('timeout')));
  req.on('error',()=>reject(new ApiError(503,action==='send'?'Delivery could not be confirmed. Retry the same message.':'OpenClaw connection unavailable. Try again.')));
  req.end(body);
 });
}
