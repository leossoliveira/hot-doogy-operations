import {readFile} from 'node:fs/promises';
import {createHash,createHmac,randomBytes} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
export const ORG='6013ed02-626a-497c-b951-619069035532',BUCKET='supplier-item-images';
const sha=b=>createHash('sha256').update(b).digest('hex');
const hmac=(k,v)=>createHmac('sha256',k).update(v).digest();
const encode=s=>encodeURIComponent(s).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function photoKey(kind,id,supplierId){if(!['items','recipes'].includes(kind)||!uuid.test(id))throw Error('Invalid photo identity');if(kind==='items'&&supplierId){if(!uuid.test(supplierId))throw Error('Invalid supplier identity');return `${ORG}/${supplierId}/photo.jpg`;}return `${ORG}/${kind}/${id}/photo.jpg`;}
export async function loadS3Config(){
 const file=process.env.HOT_DOOGY_S3_CONFIG||path.join(os.homedir(),'Documents/Codex/2026-09-12/referenced-chatgpt-conversation-this-is-an/.secrets/supabase-s3.env');
 const env={};for(const line of (await readFile(file,'utf8')).split('\n')){if(!line.includes('=')||line.trim().startsWith('#'))continue;const i=line.indexOf('=');env[line.slice(0,i).trim()]=line.slice(i+1).trim().replace(/^['"]|['"]$/g,'');}
 const endpoint=new URL(env.SUPABASE_S3_ENDPOINT);
 if(endpoint.protocol!=='https:'||!['kfnsfnytnnpwptklmbip.supabase.co','kfnsfnytnnpwptklmbip.storage.supabase.co'].includes(endpoint.hostname)||endpoint.port||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||endpoint.pathname.replace(/\/$/,'')!=='/storage/v1/s3')throw Error('Invalid S3 endpoint');
 if(!env.SUPABASE_S3_REGION||!env.SUPABASE_S3_ACCESS_KEY_ID||!env.SUPABASE_S3_SECRET_ACCESS_KEY)throw Error('Missing S3 credentials');return env;
}
export function signedUrl(env,method,key='',query={},now=new Date(),bucket=BUCKET){
 const endpoint=new URL(env.SUPABASE_S3_ENDPOINT),stamp=now.toISOString().replace(/[:-]|\.\d{3}/g,''),day=stamp.slice(0,8),region=env.SUPABASE_S3_REGION,scope=`${day}/${region}/s3/aws4_request`;
 const uri=endpoint.pathname.replace(/\/$/,'')+'/'+bucket+(key?'/'+key.split('/').map(encode).join('/'):'');
 const params={...query,'X-Amz-Algorithm':'AWS4-HMAC-SHA256','X-Amz-Credential':env.SUPABASE_S3_ACCESS_KEY_ID+'/'+scope,'X-Amz-Date':stamp,'X-Amz-Expires':'120','X-Amz-SignedHeaders':'host'};
 const qs=Object.keys(params).sort().map(k=>encode(k)+'='+encode(params[k])).join('&');
 const canonical=`${method}\n${uri}\n${qs}\nhost:${endpoint.host}\n\nhost\nUNSIGNED-PAYLOAD`;
 let signing=Buffer.from('AWS4'+env.SUPABASE_S3_SECRET_ACCESS_KEY);for(const value of [day,region,'s3','aws4_request'])signing=hmac(signing,value);
 return `${endpoint.origin}${uri}?${qs}&X-Amz-Signature=${hmac(signing,`AWS4-HMAC-SHA256\n${stamp}\n${scope}\n${sha(canonical)}`).toString('hex')}`;
}
const xmlValue=(text,tag)=>text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1]?.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"');
export function createPhotoStorage(env,fetcher=fetch,itemAliases={}){
 const bySupplier=Object.fromEntries(Object.entries(itemAliases).map(([id,supplierId])=>[supplierId,id]));
 const keyFor=(kind,id)=>photoKey(kind,id,itemAliases[id]);
 const request=async(method,key,body,query={})=>{const r=await fetcher(signedUrl(env,method,key,query),{method,body,redirect:'error',signal:AbortSignal.timeout(25000),headers:body?{'Content-Type':'image/jpeg','Cache-Control':'no-cache'}:{}});if(!r.ok&&r.status!==404)throw Error('Storage request failed');return r;};
 return {
  async list(){const result={items:{},recipes:{}};let token;
   do{const response=await request('GET','',undefined,{'list-type':'2',prefix:ORG+'/',...(token?{'continuation-token':token}:{})});if(!response.ok)throw Error('Bucket unavailable');const xml=await response.text();for(const part of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)){const key=xmlValue(part[1],'Key'),supplierMatch=key?.match(new RegExp(`^${ORG}/([0-9a-f-]{36})/photo\\.jpg$`)),match=(supplierMatch&&bySupplier[supplierMatch[1]]?['','items',bySupplier[supplierMatch[1]]]:null)||key?.match(new RegExp(`^${ORG}/(items|recipes)/([0-9a-f-]{36})/photo\\.jpg$`));if(match&&uuid.test(match[2])){const [,kind,id]=match;result[kind][id]={src:`/api/photos/${kind}/${id}?v=${encode(xmlValue(part[1],'ETag')||'')}`,storage:'s3',path:key,updatedAt:xmlValue(part[1],'LastModified')};}}token=xmlValue(xml,'IsTruncated')==='true'?xmlValue(xml,'NextContinuationToken'):null;if(xmlValue(xml,'IsTruncated')==='true'&&!token)throw Error('Incomplete Storage listing');}while(token);return result;
  },
  async read(kind,id){const r=await request('GET',keyFor(kind,id));if(r.status===404)return null;return Buffer.from(await r.arrayBuffer());},
  async save(kind,id,body){if(body.length<4||body.length>5*1024*1024||body[0]!==255||body[1]!==216||body[2]!==255)throw Error('Invalid JPEG');const key=keyFor(kind,id);const put=await request('PUT',key,body);if(!put.ok)throw Error('Upload failed');const verified=await request('GET',key);if(!verified.ok||sha(Buffer.from(await verified.arrayBuffer()))!==sha(body))throw Error('Upload verification failed');return {src:`/api/photos/${kind}/${id}?v=${sha(body).slice(0,16)}`,storage:'s3',path:key,sha256:sha(body),size:body.length,updatedAt:new Date().toISOString()};},
  async remove(kind,id){const r=await request('DELETE',keyFor(kind,id));if(!r.ok&&r.status!==404)throw Error('Removal failed');if((await request('GET',keyFor(kind,id))).status!==404)throw Error('Removal verification failed');}
 };
}
export function createPhotoHandler(storage,catalog,port){
 const token=randomBytes(32).toString('hex'),hosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`]);
 const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'});res.end(JSON.stringify(data));};
 return async(req,res,url)=>{
  if(!hosts.has(req.headers.host)||req.headers['sec-fetch-site']==='cross-site')return json(res,403,{error:'Acesso permitido somente pela aplicação local.'});
  const origin=`http://${req.headers.host}`;
  if(req.headers.origin&&req.headers.origin!==origin)return json(res,403,{error:'Origem não permitida.'});
  if(!storage)return json(res,503,{error:'Storage não configurado no servidor. A foto não foi salva.'});
  try{
   if(url.pathname==='/api/photos'&&req.method==='GET')return json(res,200,{...(await storage.list()),token});
   const match=url.pathname.match(/^\/api\/photos\/(items|recipes)\/([0-9a-f-]{36})$/);
   if(!match||!catalog[match[1]].has(match[2]))return json(res,404,{error:'Item não encontrado.'});
   const [,kind,id]=match;
   if(req.method==='GET'){const body=await storage.read(kind,id);if(!body)return json(res,404,{error:'Foto não encontrada.'});res.writeHead(200,{'Content-Type':'image/jpeg','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'});return res.end(body);}
   if(!['PUT','DELETE'].includes(req.method))return json(res,405,{error:'Método não permitido.'});
   if(req.headers.origin!==origin||req.headers['x-photo-token']!==token)return json(res,403,{error:'Recarregue a página para autorizar o upload.'});
   if(req.method==='DELETE'){await storage.remove(kind,id);return json(res,200,{removed:true});}
   if(req.headers['content-type']!=='image/jpeg')return json(res,415,{error:'Formato de imagem inválido.'});
   let length=0;const chunks=[];for await(const chunk of req){length+=chunk.length;if(length>5*1024*1024)return json(res,413,{error:'A foto excede 5 MB.'});chunks.push(chunk);}
   const body=Buffer.concat(chunks);if(body.length<4||body[0]!==255||body[1]!==216||body[2]!==255)return json(res,415,{error:'Imagem JPEG inválida.'});
   return json(res,200,await storage.save(kind,id,body));
  }catch{return json(res,502,{error:'Não foi possível concluir a operação no Storage. Tente novamente; a foto não foi confirmada.'});}
 };
}
