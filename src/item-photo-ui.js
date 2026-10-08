import {cloudPhotoSource} from './photo-storage.js';
import {escape as e} from './model.js';
export {prepareRecipePhoto as prepareItemPhoto} from './recipe-detail-ui.js';
export function itemPhotoSource(photo){return cloudPhotoSource(photo)||(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(photo?.src||'')?photo.src:null);}
export function itemPhotoView(item,photo,scope='item'){
  const src=itemPhotoSource(photo);
  return `<section class="recipe-photo item-photo" data-photo-item="${e(item.itemId||item.id)}"><div class="recipe-photo-preview">${src?`<img src="${e(src)}" alt="Photo of ${e(item.name)}">`:'<i data-lucide="image" class="icon" aria-hidden="true"></i>'}</div><div><strong>Item photo</strong><p>JPG, PNG, or WebP · Up to 5 MB<br>${scope==='supplier'?"Photo will be uploaded when you save.":"Uploads directly to private storage."} Shared across suppliers and inventory.<br>${photo?.storage==='s3'?"✓ Photo verified in storage":src?"Local photo — select it again to upload to storage.":''}</p><div class="recipe-photo-actions"><button type="button" class="btn sm" data-action="${scope}-photo-upload">${src?"Change photo":"Add photo"}</button>${src?`<button type="button" class="btn sm ghost" data-action="${scope}-photo-remove">Remove photo</button>`:''}</div><input type="file" hidden id="${scope}-photo-file" data-change="${scope}-photo" accept="image/jpeg,image/png,image/webp"><p class="error-text" role="status" data-photo-message></p></div></section>`;
}
export function itemPhotoThumbnail(item,photo,interactive=true){
  const src=itemPhotoSource(photo);
  if(!interactive)return `<div class="inventory-photo" aria-label="${src?'Photo of':'No photo for'} ${e(item.name)}">${src?`<img src="${e(src)}" alt="Photo of ${e(item.name)}" loading="lazy">`:'<i data-lucide="image" class="icon" aria-hidden="true"></i>'}</div>`;
  return `<button class="inventory-photo" data-action="item" data-id="${e(item.rowId)}" aria-label="${src?"View photo and details for":"Add photo for"} ${e(item.name)}">${src?`<img src="${e(src)}" alt="Photo of ${e(item.name)}" loading="lazy">`:'<i data-lucide="image-plus" class="icon" aria-hidden="true"></i>'}</button>`;
}
