import {createHash} from 'node:crypto';
import {gzip} from 'node:zlib';
import {promisify} from 'node:util';
const compress=promisify(gzip);

// Public application assets only. API responses retain their no-store policy.
// Revalidate on every use so a deployment never leaves old scripts cached.
export async function replyStatic(req,res,body,headers){
 const etag=`W/"${createHash('sha256').update(body).digest('hex')}"`;
 const common={...headers,'Cache-Control':'no-cache','ETag':etag,'Vary':'Accept-Encoding'};
 if((req.headers['if-none-match']||'').split(',').map(x=>x.trim()).includes(etag)){
  res.writeHead(304,common);return res.end();
 }
 const gzipAccepted=(req.headers['accept-encoding']||'').split(',').some(entry=>{const [name,...params]=entry.trim().split(';');return name==='gzip'&&!params.some(p=>/^q=0(?:\.0*)?$/.test(p.trim()));});
 const text=/^(text\/|application\/(json|javascript)|image\/svg)/.test(headers['Content-Type']);
 const encoded=gzipAccepted&&text&&body.length>1024?await compress(body,{level:4}):body;
 res.writeHead(200,{...common,'Content-Length':encoded.length,...(encoded===body?{}:{'Content-Encoding':'gzip'})});
 res.end(req.method==='HEAD'?undefined:encoded);
}
