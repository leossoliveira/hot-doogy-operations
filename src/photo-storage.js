let token=null;
export async function loadCloudPhotos(){
 const response=await fetch('/api/photos',{cache:'no-store'});const result=await response.json();
 if(!response.ok)throw Error(result.error||"Unable to load photos from storage.");
 token=result.token;return result;
}
export async function saveCloudPhoto(kind,id,photo){
 if(!token)await loadCloudPhotos();
 let body;
 if(photo){if(!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(photo.src||''))throw Error("Select a new photo to upload.");
  // Decode locally: fetching a data URL is blocked by connect-src 'self'.
  const decoded=atob(photo.src.slice('data:image/jpeg;base64,'.length));
  body=new Blob([Uint8Array.from(decoded,char=>char.charCodeAt(0))],{type:'image/jpeg'});
 }
 const response=await fetch(`/api/photos/${kind}/${id}`,{method:photo?'PUT':'DELETE',headers:{'X-Photo-Token':token,...(photo?{'Content-Type':'image/jpeg'}:{})},body});
 const result=await response.json();if(!response.ok)throw Error(result.error||"Unable to save the photo to storage.");return photo?result:null;
}
export function cloudPhotoSource(photo){return photo?.storage==='s3'&&/^\/api\/photos\/(items|recipes)\/[0-9a-f-]{36}(\?v=[A-Za-z0-9%._-]*)?$/.test(photo.src||'')?photo.src:null;}
