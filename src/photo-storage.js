let token=null;
export async function loadCloudPhotos(){
 const response=await fetch('/api/photos',{cache:'no-store'});const result=await response.json();
 if(!response.ok)throw Error(result.error||'Não foi possível carregar as fotos do Storage.');
 token=result.token;return result;
}
export async function saveCloudPhoto(kind,id,photo){
 if(!token)await loadCloudPhotos();
 let body;
 if(photo){if(!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(photo.src||''))throw Error('Selecione uma nova foto para enviar ao Storage.');body=await (await fetch(photo.src)).blob();}
 const response=await fetch(`/api/photos/${kind}/${id}`,{method:photo?'PUT':'DELETE',headers:{'X-Photo-Token':token,...(photo?{'Content-Type':'image/jpeg'}:{})},body});
 const result=await response.json();if(!response.ok)throw Error(result.error||'Não foi possível salvar a foto no Storage.');return photo?result:null;
}
export function cloudPhotoSource(photo){return photo?.storage==='s3'&&/^\/api\/photos\/(items|recipes)\/[0-9a-f-]{36}(\?v=[A-Za-z0-9%._-]*)?$/.test(photo.src||'')?photo.src:null;}
