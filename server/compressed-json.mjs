import {gzip} from 'node:zlib';
import {promisify} from 'node:util';
const compress=promisify(gzip);
export async function replyData(req,res,value){
 const body=Buffer.from(JSON.stringify(value));
 const gzipAccepted=(req.headers?.['accept-encoding']||'').split(',').some(entry=>{const [name,...params]=entry.trim().split(';');return name==='gzip'&&!params.some(p=>/^q=0(?:\.0*)?$/.test(p.trim()));});
 const encoded=gzipAccepted&&body.length>1024?await compress(body,{level:1}):body;
 res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Accept-Encoding','Content-Length':encoded.length,...(encoded===body?{}:{'Content-Encoding':'gzip'})});res.end(encoded);
}
