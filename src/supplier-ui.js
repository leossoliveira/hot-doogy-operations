import {saveCloudState as saveLocal} from './cloud.js';
import {saveCloudPhoto} from './photo-storage.js';
import {itemPhotoView,prepareItemPhoto} from './item-photo-ui.js';
import { escape as e, money, preciseNumber, date} from './model.js';
import {supplierItemWithEdits, filterSupplierItems, createSupplierDraft, saveSupplierDraft, restoreSupplierDraft, resolveSupplierPrice} from './supplier-model.js';

// Supplier catalog and editor share the application's local-only persistence boundary.
export function createSupplierUI(ctx) {
  const {icon,btn,field,input,select,options,pair,notice,empty,heading}=ctx;
  const $=s=>document.querySelector(s);
  let selected=null, sortKey='name', direction='asc', itemStatus='active', editor=null;
  const catalog=()=>ctx.catalog();
  const items=()=>catalog()?.items.map(x=>supplierItemWithEdits(x,ctx.local()))||[];
  const scopedRows=()=>filterSupplierItems(items(),{supplierId:selected,storeId:ctx.state().store,query:ctx.state().q,status:itemStatus,sortKey,direction});
  const unitName=(row,id)=>row.units?.find(u=>u.id===id)?.name||catalog()?.units?.find(u=>u.id===id)?.name||null;
  const supplier=()=>ctx.suppliers().find(x=>x.id===selected);
  const scopeLabel=scope=>scope==='all'?'Todas as lojas':ctx.locations().find(x=>x.id===scope)?.name||'Loja';

  function priceFor(row,scope=ctx.state().store) {
    const price=resolveSupplierPrice(row,scope);
    return {...price,uom:unitName(row,price.unitId)||price.uom};
  }
  function priceCell(row) {
    const p=priceFor(row);
    if(p.varies)return '<span class="price-missing">Varia por loja</span><small>Selecione uma loja</small>';
    if(p.amount==null)return '<span class="price-missing">Não informado</span>';
    const order=unitName(row,row.orderingUnitId);
    return `<strong class="mono">${money(p.amount)}</strong><small>${e(p.uom?`por ${p.uom}`:'Unidade não confirmada')}${p.local?' · local':''}${p.unitId&&row.orderingUnitId&&p.unitId!==row.orderingUnitId?' · difere da compra':''}${ctx.state().store==='all'&&p.locationId?` · ${e(scopeLabel(p.locationId))}`:''}</small>`;
  }
  function count(id) {return filterSupplierItems(items(),{supplierId:id,storeId:ctx.state().store,status:'active'}).length;}
  function open(id) {
    if(ctx.close()===false)return;
    selected=id;sortKey='name';direction='asc';itemStatus='active';ctx.state().q='';ctx.state().page=1;ctx.render();window.scrollTo(0,0);
  }
  function reset(){selected=null;editor=null;}
  function table() {
    if(!catalog())return heading('Cadastros','Fornecedores','Consulte os produtos de cada fornecedor.')+notice('O catálogo completo não foi carregado. Recarregue a página para tentar novamente.');
    const rows=scopedRows(),page=Math.min(ctx.state().page,Math.max(1,Math.ceil(rows.length/30))),s=supplier();
    const sortHeader=(key,label)=>`<th aria-sort="${sortKey===key?(direction==='asc'?'ascending':'descending'):'none'}"><button class="catalog-sort" data-action="supplier-sort" data-key="${key}" aria-label="Ordenar ${label} ${sortKey===key&&direction==='asc'?'de Z a A':'de A a Z'}">${label}${icon(sortKey===key?(direction==='asc'?'arrow-down-a-z':'arrow-up-z-a'):'arrow-down-up')}</button></th>`;
    return `<div class="supplier-back">${btn('Fornecedores','supplier-back','arrow-left','ghost sm')}</div>`+
      heading('Catálogo do fornecedor',e(s?.name||'Fornecedor'),'Selecione a descrição para consultar e editar o cadastro.',`<span class="validation-tag">${icon('hard-drive')}Edição local</span>`)+
      `<section class="panel supplier-catalog-panel">${ctx.searchToolbar('Buscar descrição, marca ou SKU',`<select class="filter-select" data-change="supplier-status" aria-label="Status dos itens"><option value="active" ${itemStatus==='active'?'selected':''}>Itens ativos</option><option value="all" ${itemStatus==='all'?'selected':''}>Todos os itens</option><option value="inactive" ${itemStatus==='inactive'?'selected':''}>Itens inativos</option></select>`,`<span class="table-count">${rows.length} ${rows.length===1?'item':'itens'}</span>`)}${rows.length?`<div class="table-wrap"><table class="supplier-items-table"><thead><tr>${sortHeader('name','Product Description')}${sortHeader('brand','Brand')}<th>SKU</th><th>Ordering UOM</th><th>Price ($)</th></tr></thead><tbody>${rows.slice((page-1)*30,page*30).map(row=>`<tr><td><button class="product-description" data-action="supplier-item" data-id="${e(row.supplierItemId)}"><span>${e(row.name)}</span>${icon('arrow-up-right')}</button><small>${e(row.categoryName||'Sem categoria')}${row.editedLocally?' · Edição local':''}${!row.active||!row.supplierActive?' · Inativo':''}</small></td><td>${row.brand?e(row.brand):'<span class="price-missing">Não informada</span>'}</td><td class="mono sku-cell">${e(row.sku||'—')}</td><td>${e(unitName(row,row.orderingUnitId)||'Não definida')}</td><td>${priceCell(row)}</td></tr>`).join('')}</tbody></table></div><div class="pagination"><span>${(page-1)*30+1}–${Math.min(page*30,rows.length)} de ${rows.length}</span><div class="pages">${btn('Anterior','page-prev','chevron-left','',page<=1?'disabled':'')}<span class="btn current">${page}</span>${btn('Próxima','page-next','chevron-right','',page*30>=rows.length?'disabled':'')}</div></div>`:empty('Nenhum item encontrado','Confira a busca, a loja selecionada e o status dos itens.')}<div class="snapshot-footer">Preços aprovados do cadastro, na unidade indicada. Valores ausentes permanecem sem preço informado.</div></section>`;
  }
  const unitOptions=(row,id)=>options(row.units||[],id,'Não definida');
  const booleanField=(label,key,value)=>field(label,'catalog-'+key,select('catalog-'+key,`<option value="true" ${value===true?'selected':''}>Sim</option><option value="false" ${value===false?'selected':''}>Não</option>`,`data-item-field="${key}"`));
  const textField=(label,key,value,full=false,extra='')=>field(label,'catalog-'+key,input('catalog-'+key,value??'','text',`data-item-field="${key}" ${extra}`),full);
  function edit(id) {
    const row=items().find(x=>x.supplierItemId===id);if(!row)return;
    const price=priceFor(row),scope=ctx.state().store;
    const original={...row,price:price.amount,priceUnitId:price.unitId??null,priceScope:scope};
    editor={original,draft:createSupplierDraft(original),dirty:false,price,photo:ctx.local().itemPhotos?.[row.itemId]||null,photoBusy:false,photoDirty:false};
    renderEditor();
  }
  function renderEditor() {
    const row=editor.draft,s=ctx.suppliers().find(x=>x.id===row.supplierId),p=editor.price;
    const roles=[['Ordering UOM','orderingUnitId'],['Receiving UOM','receivingUnitId'],['Stocktake UOM','stocktakeUnitId']];
    const body=`<div class="catalog-edit-heading"><span class="supplier-logo">${icon('package')}</span><div><div class="eyebrow">${e(s?.name||row.supplierName)}</div><h3>${e(row.name)}</h3><p>Cadastro compartilhado entre lojas · ${e(row.sku||'Sem SKU')}</p></div><span class="validation-tag">${icon('hard-drive')}Edição local</span></div>
      ${itemPhotoView(row,editor.photo,'supplier')}<form id="supplier-item-form"><div class="catalog-editor-grid"><div class="catalog-editor-column"><section class="catalog-section"><h3>${icon('package')}Informações do produto</h3><div class="form-grid">
      ${textField('Product Description','name',row.name,true,'required')}${textField('Item name — catálogo interno','catalogName',row.catalogName,true)}${textField('Internal name','internalName',row.internalName,true)}${textField('Brand','brand',row.brand)}${textField('SKU','sku',row.sku)}
      ${field('Categoria','catalog-categoryId',select('catalog-categoryId',options(catalog().categories||[],row.categoryId,'Sem categoria'),'data-item-field="categoryId"'))}
      ${field('Item Type','catalog-type',input('catalog-type',row.type==='prepared'?'Preparação':row.type==='purchased'?'Item comprado':row.type,'text','readonly'))}
      ${field('Observações','catalog-description',`<textarea id="catalog-description" data-item-field="description" rows="3">${e(row.description||'')}</textarea>`,true)}
      </div></section><section class="catalog-section"><h3>${icon('tag')}Preço de compra</h3><p class="catalog-help">${e(scopeLabel(row.priceScope))}. Preço e unidade de referência são registrados juntos.</p><div class="form-grid">
      ${field('Price ($)','catalog-price',input('catalog-price',row.price??'','number','min="0" step="any" data-item-field="price" placeholder="Não informado"'))}
      ${field('Unidade do preço','catalog-priceUnitId',select('catalog-priceUnitId',unitOptions(row,row.priceUnitId),'data-item-field="priceUnitId"'))}</div>
      <p class="catalog-help">${p.varies?'Existem preços diferentes por loja. Um preço salvo aqui será a referência local geral; preços editados para uma loja terão prioridade.':p.amount!=null?`${e(p.local?'Preço editado nesta prévia.':'Último preço aprovado disponível.')}${p.date||p.effectiveAt?' Referência: '+date(p.date||p.effectiveAt)+'.':''}`:'Nenhum preço aprovado disponível para esta seleção.'}</p>
      ${p.amount!=null&&!p.local&&p.unitSource?`<p class="catalog-help">${p.unitSource==='invoice_line.item_unit_id'?'Unidade do preço confirmada na nota fiscal.':'Unidade de referência conforme o cadastro atual de compra.'}</p>`:''}${priceHistory(row)}</section><section class="catalog-section"><h3>${icon('store')}Lojas & storage areas</h3><div class="catalog-locations">${(row.stores||[]).map(l=>`<div><strong>${e(l.name)} ${l.active===false?'<span class="muted">· inativo</span>':''}</strong><p>${(row.areas||[]).filter(a=>a.locationId===l.id).map(a=>e(a.name)).join(' · ')||'Sem storage area vinculado'}</p></div>`).join('')||'<p class="muted">Sem vínculo com lojas.</p>'}</div></section></div>
      <div class="catalog-editor-column"><section class="catalog-section"><h3>${icon('ruler')}Unidades de operação</h3><div class="form-grid">${roles.map(([label,key])=>field(label,'catalog-'+key,select('catalog-'+key,unitOptions(row,row[key]),`data-item-field="${key}"`))).join('')}${field('Unidade-base','catalog-base',input('catalog-base',row.baseUnitName||'Não informada','text','readonly'))}</div></section>
      <section class="catalog-section"><h3>${icon('arrow-left-right')}Conversões</h3><p class="catalog-help">Quantidade de ${e(row.baseUnitName||'unidade-base')} contida em cada unidade. A unidade-base é preservada.</p><div id="catalog-conversions"></div><div class="catalog-add-conversion"><select id="catalog-new-unit" aria-label="Unidade para nova conversão"></select>${btn('Adicionar','supplier-unit-add','plus','sm')}</div></section>
      <section class="catalog-section"><h3>${icon('settings-2')}Configurações</h3><div class="form-grid">${booleanField('Item ativo','active',row.active)}${booleanField('Ativo neste fornecedor','supplierActive',row.supplierActive)}${row.trackInventory!=null?booleanField('Controlar estoque','trackInventory',row.trackInventory):''}${row.yieldPercent!=null?field('Rendimento (%)','catalog-yieldPercent',input('catalog-yieldPercent',row.yieldPercent,'number','min="0" max="100" step="any" data-item-field="yieldPercent"')):''}</div><p class="catalog-help">Nome interno, categoria e conversões são compartilhados pelo item. Product Description, marca, SKU, preço e unidades de compra e recebimento pertencem a este fornecedor.</p></section></div></div><p id="supplier-item-error" class="error-text" role="alert" tabindex="-1"></p></form>`;
    ctx.openModal('Cadastro do item',body,`${row.editedLocally?btn('Restaurar original','supplier-restore','rotate-ccw','ghost'):''}<span class="meta catalog-save-note">${icon('hard-drive')}Alterações gravadas no banco</span>${btn('Cancelar','supplier-cancel')}${btn('Salvar alterações','supplier-save','check','primary')}`,{wide:true,className:'catalog-item-modal',kind:'supplier-edit'});
    renderConversions();
  }
  function priceHistory(row) {
    const history=(row.currentPrices||[]);
    if(!history.length)return '';
    return `<details class="catalog-price-history"><summary>Preços aprovados por loja</summary>${history.map(p=>`<div class="metric-inline"><span>${e(scopeLabel(p.locationId||'all'))}<small>${e(p.uom??p.priceUom??unitName(row,p.unitId??p.priceUnitId)??'Unidade não confirmada')}${p.effectiveAt?' · '+date(p.effectiveAt):''}</small></span><strong>${money(p.amount??p.price)}</strong></div>`).join('')}</details>`;
  }
  function refreshUnitOptions(){for(const key of ['orderingUnitId','receivingUnitId','stocktakeUnitId','priceUnitId'])$('#catalog-'+key).innerHTML=unitOptions(editor.draft,editor.draft[key]);}
  function renderConversions() {
    const row=editor.draft,roles=[row.orderingUnitId,row.receivingUnitId,row.stocktakeUnitId,row.priceUnitId];
    $('#catalog-conversions').innerHTML=row.units.map((u,i)=>`<div class="catalog-conversion-row"><span>1 ${e(u.name)}</span><span>=</span><input type="number" min="0" step="any" data-unit-index="${i}" value="${e(u.factor)}" aria-label="Conversão de ${e(u.name)}" ${u.base?'readonly':''}><span>${e(row.baseUnitName)}</span><button type="button" class="icon-btn" data-action="supplier-unit-remove" data-index="${i}" aria-label="Remover conversão ${e(u.name)}" ${u.base||roles.includes(u.id)?'disabled title="Unidade-base ou unidade em uso neste cadastro"':''}>${icon('trash-2')}</button></div>`).join('');
    const remaining=(catalog().units||[]).filter(u=>!row.units.some(x=>x.id===u.id));
    $('#catalog-new-unit').innerHTML=options(remaining,'','Selecionar unidade');ctx.icons();
  }
  async function uploadPhoto(el){
    const current=editor,file=el.files[0];if(!file||current.photoBusy)return;
    current.photoBusy=true;
    const section=el.closest('.item-photo'),message=section.querySelector('[data-photo-message]');
    section.querySelectorAll('button').forEach(b=>b.disabled=true);message.textContent='Preparando foto…';
    const saveButton=$('[data-action="supplier-save"]');saveButton.disabled=true;
    try{const photo=await prepareItemPhoto(file);if(editor!==current||!section.isConnected)return;current.photo=photo;current.photoDirty=true;current.dirty=true;section.outerHTML=itemPhotoView(current.draft,photo,'supplier');ctx.icons();}
    catch(error){message.textContent=error.message;}
    finally{current.photoBusy=false;el.value='';section.querySelectorAll('button').forEach(b=>b.disabled=false);saveButton.disabled=false;}
  }
  function changed(el) {
    if(!editor)return false;
    if(el.dataset.change==='supplier-photo'){if(el.files?.length)uploadPhoto(el);return true;}
    const key=el.dataset.itemField;
    if(key) {
      editor.draft[key]=['active','supplierActive','trackInventory'].includes(key)?el.value==='true':el.value;
      if(key==='categoryId')editor.draft.categoryName=catalog().categories.find(x=>x.id===el.value)?.name||null;
      if(key.endsWith('UnitId'))renderConversions();
    } else if(el.dataset.unitIndex!=null)editor.draft.units[Number(el.dataset.unitIndex)].factor=el.value;
    else return false;
    editor.dirty=true;$('#supplier-item-error').textContent='';return true;
  }
  async function save() {
    if(editor.photoBusy||!$('#supplier-item-form').reportValidity())return;
    const current=editor,button=$('[data-action="supplier-save"]');button.disabled=true;current.photoBusy=true;
    try {
      // Validate the full draft before uploading; persistence follows a verified Storage response.
      const result=saveSupplierDraft(ctx.local(),current.original,current.draft,{...catalog(),items:items()},{storage:{setItem(){}}});
      if(current.photoDirty){
        const photo=current.photo===null&&ctx.local().itemPhotos?.[current.original.itemId]?.storage!=='s3'?null:await saveCloudPhoto('items',current.original.itemId,current.photo);
        result.local.itemPhotos={...ctx.local().itemPhotos,[current.original.itemId]:photo};
      }
      await saveLocal(result.local);ctx.setLocal(result.local);current.dirty=false;ctx.close(true);editor=null;ctx.render();ctx.toast(current.photoDirty?'Foto e cadastro salvos.':'Cadastro atualizado no banco.');
    }catch(error){const target=$('#supplier-item-error');if(target){target.textContent=error.name==='QuotaExceededError'?'Não foi possível salvar o cadastro local: armazenamento cheio. Uma foto já confirmada no Storage permanece disponível ao recarregar.':error.message;target.focus();}}
    finally{current.photoBusy=false;button.disabled=false;}
  }
  function requestDiscard() {
    if(editor?.photoBusy){ctx.toast('Aguarde a conclusão da foto antes de fechar.');return false;}
    if(!$('#supplier-discard-guard'))$('#overlay-root .modal-foot').insertAdjacentHTML('afterbegin',`<div class="recipe-discard-guard" id="supplier-discard-guard" role="alert"><span>Há alterações não salvas.</span>${btn('Continuar editando','supplier-keep','','sm')}${btn('Descartar alterações','supplier-discard','','sm')}</div>`);
    $('#supplier-discard-guard button')?.focus();return false;
  }
  function cancel(){if(editor?.dirty)return requestDiscard();ctx.close(true);editor=null;}
  function restore(){
    if(!$('#supplier-restore-guard'))$('#overlay-root .modal-foot').insertAdjacentHTML('afterbegin',`<div class="recipe-discard-guard" id="supplier-restore-guard" role="alert"><span>Restaurar dados compartilhados do item e dados deste fornecedor ao extrato original?</span>${btn('Manter edição','supplier-keep-restore','','sm')}${btn('Restaurar cadastro','supplier-confirm-restore','','sm')}</div>`);
  }
  const actions={
    'supplier-photo-upload':()=>$('#supplier-photo-file')?.click(),
    'supplier-photo-remove':()=>{editor.photo=null;editor.photoDirty=true;editor.dirty=true;$('.item-photo').outerHTML=itemPhotoView(editor.draft,null,'supplier');ctx.icons();},
    'supplier-sort':el=>{const key=el.dataset.key;direction=sortKey===key&&direction==='asc'?'desc':'asc';sortKey=key;ctx.state().page=1;ctx.render();},
    'supplier-back':()=>{selected=null;ctx.state().q='';ctx.state().page=1;ctx.render();},
    'supplier-item':el=>edit(el.dataset.id),'supplier-save':save,'supplier-cancel':cancel,
    'supplier-discard':()=>{if(editor.photoBusy)return;editor.dirty=false;ctx.close(true);editor=null;},'supplier-keep':()=>$('#supplier-discard-guard')?.remove(),
    'supplier-restore':restore,'supplier-keep-restore':()=>$('#supplier-restore-guard')?.remove(),
    'supplier-confirm-restore':()=>{try{const source=catalog().items.find(x=>x.supplierItemId===editor.original.supplierItemId);const result=restoreSupplierDraft(ctx.local(),source,{catalog:catalog()});ctx.setLocal(result.local);editor.dirty=false;ctx.close(true);editor=null;ctx.render();ctx.toast('Cadastro original restaurado nesta prévia.');}catch(error){$('#supplier-item-error').textContent=error.message||'Não foi possível restaurar. Tente novamente.';$('#supplier-item-error').focus();}},
    'supplier-unit-add':()=>{const id=$('#catalog-new-unit').value,u=catalog().units.find(x=>x.id===id);if(!u)return;editor.draft.units.push({...u,itemUnitId:'local-'+crypto.randomUUID(),factor:'',base:false,ordering:false,receiving:false,stocktake:false});editor.dirty=true;refreshUnitOptions();renderConversions();},
    'supplier-unit-remove':el=>{const i=Number(el.dataset.index),u=editor.draft.units[i];if(!u||u.base||[editor.draft.orderingUnitId,editor.draft.receivingUnitId,editor.draft.stocktakeUnitId,editor.draft.priceUnitId].includes(u.id))return;editor.draft.units.splice(i,1);editor.dirty=true;refreshUnitOptions();renderConversions();}
  };
  return {open,reset,count,table,actions,changed,requestDiscard,get selected(){return selected;},get dirty(){return editor?.dirty||editor?.photoBusy||false;},changeStatus(value){itemStatus=value;ctx.state().page=1;ctx.render();}};
}
