import {gzip,brotliCompress,constants} from 'node:zlib';
import {promisify} from 'node:util';
const compress=promisify(gzip);
const brotli=promisify(brotliCompress);
function quality(header,name){
 const entries=String(header||'').split(',').map(entry=>entry.trim().split(';'));
 const entry=entries.find(([coding])=>coding.toLowerCase()===name)||entries.find(([coding])=>coding==='*');
 if(!entry)return 0;
 const parameter=entry.slice(1).find(p=>/^\s*q\s*=/i.test(p));
 const q=parameter?Number(parameter.split('=')[1]):1;
 return Number.isFinite(q)&&q>=0&&q<=1?q:0;
}
export async function replyData(req,res,value){
 const body=Buffer.from(JSON.stringify(value));
 const accepted=req.headers?.['accept-encoding'],br=quality(accepted,'br'),gz=quality(accepted,'gzip');
 const coding=body.length<=1024?null:br>0&&br>=gz?'br':gz>0?'gzip':null;
 // Async, moderate-quality Brotli sees repeated records across a much larger
 // window than gzip without changing a single field or caching private data.
 const encoded=coding==='br'?await brotli(body,{params:{[constants.BROTLI_PARAM_QUALITY]:4,[constants.BROTLI_PARAM_LGWIN]:22}}):coding==='gzip'?await compress(body,{level:6}):body;
 res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Accept-Encoding','Content-Length':encoded.length,...(coding?{'Content-Encoding':coding}:{})});res.end(encoded);
}
