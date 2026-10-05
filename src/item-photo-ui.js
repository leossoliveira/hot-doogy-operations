import {cloudPhotoSource} from './photo-storage.js';
import {escape as e} from './model.js';
export {prepareRecipePhoto as prepareItemPhoto} from './recipe-detail-ui.js';
export function itemPhotoSource(photo){return cloudPhotoSource(photo)||(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(photo?.src||'')?photo.src:null);}
export function itemPhotoView(item,photo,scope='item'){
  const src=itemPhotoSource(photo);
  return `<section class="recipe-photo item-photo" data-photo-item="${e(item.itemId||item.id)}"><div class="recipe-photo-preview">${src?`<img src="${e(src)}" alt="Foto de ${e(item.name)}">`:'<i data-lucide="image" class="icon" aria-hidden="true"></i>'}</div><div><strong>Foto do item</strong><p>JPG, PNG ou WebP · até 5 MB<br>${scope==='supplier'?'Foto enviada ao Storage ao salvar.':'Upload direto para o Storage privado.'} Compartilhada entre fornecedores e inventário.<br>${photo?.storage==='s3'?'✓ Foto confirmada no Storage':src?'Foto local — selecione novamente para enviar ao Storage.':''}</p><div class="recipe-photo-actions"><button type="button" class="btn sm" data-action="${scope}-photo-upload">${src?'Trocar foto':'Adicionar foto'}</button>${src?`<button type="button" class="btn sm ghost" data-action="${scope}-photo-remove">Remover foto</button>`:''}</div><input type="file" hidden id="${scope}-photo-file" data-change="${scope}-photo" accept="image/jpeg,image/png,image/webp"><p class="error-text" role="status" data-photo-message></p></div></section>`;
}
export function itemPhotoThumbnail(item,photo){
  const src=itemPhotoSource(photo);
  return `<button class="inventory-photo" data-action="item" data-id="${e(item.rowId)}" aria-label="${src?'Ver foto e cadastro de':'Adicionar foto de'} ${e(item.name)}">${src?`<img src="${e(src)}" alt="Foto de ${e(item.name)}" loading="lazy">`:'<i data-lucide="image-plus" class="icon" aria-hidden="true"></i>'}</button>`;
}
