// Loopback-only preview with synthetic data. No production services are used.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Supplier receiving · Local preview</title>${['tokens','styles','responsive','a11y'].map(x=>`<link rel="stylesheet" href="/src/${x}.css">`).join('')}<style>body{padding:28px;background:#f8f9f5}.preview-bar{display:flex;gap:20px;align-items:center;margin-bottom:24px}.preview-bar img{width:130px}.preview-bar p{margin:0}.overlay{top:80px;height:calc(100dvh - 80px)}.preview-help{color:#56604e}#preview-message{color:#176b45}</style></head><body><div id="app"></div><header class="preview-bar"><img src="/brand/hot-doogy-wordmark.svg" alt="Hot Doogy"><p>Prévia local · dados de demonstração</p><button class="btn" id="reset">Reiniciar</button></header><p class="preview-help">Marque ✓ para receber ou ⓘ para relatar um problema. Depois, clique em Record receipt.</p><button class="btn primary" id="open">Open supplier order</button><p id="preview-message" role="status"></p><div id="overlay-root"></div><script src="/vendor/lucide.min.js"></script><script type="module" src="/preview.js"></script></body></html>`;
const server=http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://127.0.0.1'),pathname=decodeURIComponent(url.pathname);
 if(req.method!=='GET'){res.writeHead(405);return res.end();}
 if(pathname==='/'){res.setHeader('Content-Type','text/html');return res.end(html);}
 const relative=pathname==='/preview.js'?'scripts/preview-order-receiving-client.js':pathname.startsWith('/brand/')||pathname.startsWith('/vendor/')?'public'+pathname:pathname.slice(1);
 const file=path.resolve(root,relative);
 if(!file.startsWith(root)||relative.includes('..')||!['src/','public/brand/','public/vendor/','scripts/preview-order-receiving-client.js'].some(prefix=>relative.startsWith(prefix))){res.writeHead(404);return res.end();}
 res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2'})[path.extname(file)]||'application/octet-stream');res.end(await readFile(file));
 }catch{res.writeHead(404);res.end('Not found');}});
server.listen(4187,'127.0.0.1',()=>console.log('Supplier receiving preview: http://127.0.0.1:4187'));
