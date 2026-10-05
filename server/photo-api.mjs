import {createPhotoStorage,loadS3Config,ORG} from './photo-storage.mjs';
import {ApiError,reply} from './auth.mjs';
export async function photos(req,res,url,auth,session){
 const items=await auth.request(`/rest/v1/supplier_items?select=id,inventory_item_id&organization_id=eq.${ORG}&order=id.desc`,{token:session.token});
 const recipes=await auth.request(`/rest/v1/recipes?select=id&organization_id=eq.${ORG}`,{token:session.token});
 const aliases=Object.fromEntries(items.map(x=>[x.inventory_item_id,x.id]));
 const storage=createPhotoStorage(await loadS3Config(),fetch,aliases);
 if(url.pathname==='/api/photos'&&req.method==='GET'){const all=await storage.list();all.items=Object.fromEntries(Object.entries(all.items).filter(([id])=>aliases[id]));const ids=new Set(recipes.map(r=>r.id));all.recipes=Object.fromEntries(Object.entries(all.recipes).filter(([id])=>ids.has(id)));return reply(res,200,{...all,token:'session'});}
 const m=url.pathname.match(/^\/api\/photos\/(items|recipes)\/([a-f0-9-]{36})$/);if(!m)throw new ApiError(404,"Photo not found.");const [,kind,id]=m;
 if(kind==='items'?!aliases[id]:!recipes.some(r=>r.id===id))throw new ApiError(404,"Item not found.");
 if(req.method==='GET'){const body=await storage.read(kind,id);if(!body)throw new ApiError(404,"Photo not found.");res.writeHead(200,{'Content-Type':'image/jpeg','Cache-Control':'no-store'});return res.end(body);}
 if(!['owner','admin','manager','chef'].includes(session.member.role))throw new ApiError(403,"You do not have permission to change photos.");
 if(!['PUT','DELETE'].includes(req.method))throw new ApiError(405,"Invalid method.");
 let photo=null;
 if(req.method==='PUT'){let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>5*1024*1024)throw new ApiError(413,"Photo exceeds 5 MB.");chunks.push(c);}const body=Buffer.concat(chunks);if(req.headers['content-type']!=='image/jpeg'||body[0]!==255||body[1]!==216)throw new ApiError(415,"Use a JPEG image.");photo=await storage.save(kind,id,body);}
 else await storage.remove(kind,id);
 if(kind==='items')await auth.request(`/rest/v1/supplier_items?id=eq.${aliases[id]}&organization_id=eq.${ORG}`,{token:session.token,method:'PATCH',body:{photo_path:photo?.path||null}});
 reply(res,200,photo||{removed:true});
}
