import {cloudPhotoSource} from './photo-storage.js';
import {escape as e} from './model.js';

const tabs=[['ingredients','Ingredientes'],['packaging','Embalagens'],['cost','Cost'],['steps','Step-by-Step']];
const photoSource=photo=>cloudPhotoSource(photo)||(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(photo?.src||'')?photo.src:null);
export function recipePhotoView(recipe,photo){
  const src=photoSource(photo);
  return `<section class="recipe-photo" data-photo-recipe="${e(recipe.id)}"><div class="recipe-photo-preview">${src?`<img src="${e(src)}" alt="Foto de ${e(recipe.name)}">`:'<i data-lucide="image" class="icon" aria-hidden="true"></i>'}</div><div><strong>Foto do item</strong><p>JPG, PNG ou WebP · até 5 MB<br>${photo?.storage==='s3'?'✓ Foto confirmada no Storage':src?'Foto local — selecione novamente para enviar ao Storage.':'Upload para o Storage privado.'}</p><div class="recipe-photo-actions"><button class="btn sm" data-action="recipe-photo-upload">${src?'Trocar foto':'Adicionar foto'}</button>${src?'<button class="btn sm ghost" data-action="recipe-photo-remove">Remover foto</button>':''}</div><input type="file" hidden id="recipe-photo-file" data-change="recipe-photo" data-id="${e(recipe.id)}" accept="image/jpeg,image/png,image/webp"><p class="error-text" role="status" id="recipe-photo-message"></p></div></section>`;
}
export function recipeDetailTabs(recipe,componentsView,costView){
  const ingredients=recipe.components.filter(c=>c.kind!=='packaging');
  const packaging=recipe.components.filter(c=>c.kind==='packaging');
  const steps=[...(recipe.steps||[])].sort((a,b)=>(a.stepNumber||0)-(b.stepNumber||0));
  const content={
    ingredients:`<div class="section-title recipe-section-title"><div>Ingredientes <span class="pill-count">${ingredients.length}</span><p>Quantidades conforme o rendimento desta versão.</p></div></div>${componentsView({...recipe,components:ingredients})}`,
    packaging:`<div class="section-title recipe-section-title"><div>Embalagens <span class="pill-count">${packaging.length}</span><p>Materiais utilizados para acondicionar e servir.</p></div></div>${!recipe.componentsLoaded?componentsView(recipe):packaging.length?componentsView({...recipe,components:packaging}):'<div class="recipe-empty"><h3>Nenhuma embalagem cadastrada</h3><p>Use Editar ingredientes para adicionar um item do tipo Embalagem.</p></div>'}`,
    cost:costView,
    steps:`<div class="section-title">Modo de preparo</div>${steps.length?`<ol class="recipe-steps">${steps.map((s,i)=>`<li><span class="recipe-step-number">${i+1}</span><div><h3>${e(s.title||`Etapa ${i+1}`)}</h3><p>${e(s.instructions||'')}</p></div></li>`).join('')}</ol>`:'<div class="recipe-empty"><h3>Passo a passo não cadastrado</h3><p>Esta versão ainda não possui instruções de preparo.</p></div>'}${recipe.notes?`<div class="section-title">Observações da receita</div><p class="recipe-step-notes">${e(recipe.notes)}</p>`:''}`
  };
  return `<div class="recipe-detail-tabs" role="tablist" aria-label="Detalhes da receita">${tabs.map(([id,label],i)=>`<button id="recipe-tab-${id}" type="button" role="tab" aria-selected="${i===0}" aria-controls="recipe-panel-${id}" tabindex="${i===0?0:-1}" data-action="recipe-detail-tab" data-tab="${id}">${label}</button>`).join('')}</div>${tabs.map(([id],i)=>`<section id="recipe-panel-${id}" class="recipe-detail-panel" role="tabpanel" aria-labelledby="recipe-tab-${id}" tabindex="0" ${i?'hidden':''}>${content[id]}</section>`).join('')}`;
}
export function selectRecipeTab(id){
  document.querySelectorAll('.recipe-detail-tabs [role="tab"]').forEach(button=>{const active=button.dataset.tab===id;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;document.getElementById(button.getAttribute('aria-controls')).hidden=!active;});
}
export async function prepareRecipePhoto(file){
  if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024)throw Error('Selecione uma foto JPG, PNG ou WebP de até 5 MB.');
  const url=URL.createObjectURL(file);
  try{
    const img=new Image();img.src=url;
    try{await img.decode();}catch{throw Error('Não foi possível ler esta imagem. Selecione outra foto.');}
    const ratio=Math.min(1,1000/Math.max(img.naturalWidth,img.naturalHeight));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*ratio));canvas.height=Math.max(1,Math.round(img.naturalHeight*ratio));
    const ctx=canvas.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
    return {src:canvas.toDataURL('image/jpeg',0.82),name:file.name,updatedAt:new Date().toISOString()};
  }finally{URL.revokeObjectURL(url);}
}
