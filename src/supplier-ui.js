import {invoicePriceHistory,invoicePriceChange} from './invoice-price-history.js';
import {createSupplierForms} from './supplier-create.js';
import {prioritizeUnits} from './units.js';
import {saveCloudState as saveLocal} from './cloud.js';
import {saveCloudPhoto} from './photo-storage.js';
import {itemPhotoView,prepareItemPhoto,itemPhotoSource} from './item-photo-ui.js';
import { escape as e, money, preciseNumber, date} from './model.js';
import {supplierItemWithEdits, filterSupplierItems, createSupplierDraft, saveSupplierDraft, restoreSupplierDraft, resolveSupplierPrice} from './supplier-model.js';

// Supplier catalog and editor share the application's local-only persistence boundary.
export function createSupplierUI(ctx) {
  const {icon,btn,field,input,select,options,pair,notice,empty,heading}=ctx;
  const $=s=>document.querySelector(s);
  let selected=null, sortKey='name', direction='asc', itemStatus='active', editor=null;
  const catalog=()=>ctx.catalog();
  const forms=createSupplierForms(ctx);
  const items=()=>catalog()?.items.map(x=>supplierItemWithEdits(x,ctx.local()))||[];
  const scopedRows=()=>filterSupplierItems(items(),{supplierId:selected,storeId:ctx.state().store,query:ctx.state().q,status:itemStatus,sortKey,direction});
  const unitName=(row,id)=>row.units?.find(u=>u.id===id)?.name||catalog()?.units?.find(u=>u.id===id)?.name||null;
  const supplier=()=>ctx.suppliers().find(x=>x.id===selected);
  const scopeLabel=scope=>scope==='all'?"All locations":ctx.locations().find(x=>x.id===scope)?.name||"Location";

  function priceFor(row,scope=ctx.state().store) {
    const price=resolveSupplierPrice(row,scope);
    return {...price,uom:unitName(row,price.unitId)||price.uom};
  }
  function priceCell(row) {
    const p=priceFor(row);
    if(p.varies)return "<span class=\"price-missing\">Varies by location</span><small>Select a location</small>";
    if(p.amount==null)return "<span class=\"price-missing\">Not specified</span>";
    const order=unitName(row,row.orderingUnitId);
    return `<strong class="mono">${money(p.amount)}</strong><small>${e(p.uom?`per ${p.uom}`:"Unit not confirmed")}${p.local?' · local':''}${p.unitId&&row.orderingUnitId&&p.unitId!==row.orderingUnitId?" · differs from ordering unit":''}${ctx.state().store==='all'&&p.locationId?` · ${e(scopeLabel(p.locationId))}`:''}</small>`;
  }
  function count(id) {return filterSupplierItems(items(),{supplierId:id,storeId:ctx.state().store,status:'active'}).length;}
  function open(id) {
    if(ctx.close()===false)return;
    selected=id;sortKey='name';direction='asc';itemStatus='active';ctx.state().q='';ctx.state().page=1;ctx.render();window.scrollTo(0,0);
  }
  function reset(){selected=null;editor=null;}
  function table() {
    if(!catalog())return heading("Catalog","Suppliers","Browse each supplier’s products.")+notice("The full catalog was not loaded. Reload the page to try again.");
    const rows=scopedRows(),page=Math.min(ctx.state().page,Math.max(1,Math.ceil(rows.length/30))),s=supplier();
    const sortHeader=(key,label)=>`<th aria-sort="${sortKey===key?(direction==='asc'?'ascending':'descending'):'none'}"><button class="catalog-sort" data-action="supplier-sort" data-key="${key}" aria-label="Sort ${label} ${sortKey===key&&direction==='asc'?"Z to A":"A to Z"}">${label}${icon(sortKey===key?(direction==='asc'?'arrow-down-a-z':'arrow-up-z-a'):'arrow-down-up')}</button></th>`;
    return `<div class="supplier-back">${btn("Suppliers",'supplier-back','arrow-left','ghost sm')}</div>`+
      heading("Supplier catalog",e(s?.name||"Supplier"),"Select a description to view and edit item details.",btn("Add item",'supplier-create-item','plus','primary'))+
      `<section class="panel supplier-catalog-panel">${ctx.searchToolbar("Search description, brand, or SKU",`<select class="filter-select" data-change="supplier-status" aria-label="Item status"><option value="active" ${itemStatus==='active'?'selected':''}>Active items</option><option value="all" ${itemStatus==='all'?'selected':''}>All items</option><option value="inactive" ${itemStatus==='inactive'?'selected':''}>Inactive items</option></select>`,`<span class="table-count">${rows.length} ${rows.length===1?'item':"items"}</span>`)}${rows.length?`<div class="table-wrap"><table class="supplier-items-table"><thead><tr><th>Photo</th>${sortHeader('name','Product Description')}${sortHeader('brand','Brand')}<th>SKU</th><th>Ordering unit</th><th>Price ($)</th></tr></thead><tbody>${rows.slice((page-1)*30,page*30).map(row=>`<tr><td><button class="inventory-photo" data-action="supplier-item" data-id="${e(row.supplierItemId)}" aria-label="View ${e(row.name)}">${itemPhotoSource(ctx.local().itemPhotos?.[row.itemId])?`<img src="${e(itemPhotoSource(ctx.local().itemPhotos?.[row.itemId]))}" alt="${e(row.name)}" loading="lazy">`:icon('image')}</button></td><td><button class="product-description" data-action="supplier-item" data-id="${e(row.supplierItemId)}"><span>${e(row.name)}</span>${icon('arrow-up-right')}</button><small>${e(row.categoryName||"Uncategorized")}${row.editedLocally?" · Local edit":''}${!row.active||!row.supplierActive?" · Inactive":''}</small></td><td>${row.brand?e(row.brand):"<span class=\"price-missing\">Not specified</span>"}</td><td class="mono sku-cell">${e(row.sku||'—')}</td><td>${e(unitName(row,row.orderingUnitId)||"Not set")}</td><td>${priceCell(row)}</td></tr>`).join('')}</tbody></table></div><div class="pagination"><span>${(page-1)*30+1}–${Math.min(page*30,rows.length)} of ${rows.length}</span><div class="pages">${btn("Previous",'page-prev','chevron-left','',page<=1?'disabled':'')}<span class="btn current">${page}</span>${btn("Next",'page-next','chevron-right','',page*30>=rows.length?'disabled':'')}</div></div>`:empty("No items found","Check your search, selected location, and item status.")}<div class="snapshot-footer">Approved catalog prices in the specified unit. Missing values remain unpriced.</div></section>`;
  }
  function prices(filter){
    if(!catalog())return heading("Purchasing","Price updates","Review and update supplier item prices.")+notice("Catalog unavailable. Reload to try again.");
    const st=ctx.state(),rows=filterSupplierItems(items(),{storeId:st.store,query:st.q,status:'all'}).filter(r=>st.supplier==='all'||(Array.isArray(st.supplier)?st.supplier.includes(r.supplierId):st.supplier===r.supplierId));
    const page=Math.min(st.page,Math.max(1,Math.ceil(rows.length/30)));
    return heading("Purchasing","Price updates","Compare the latest two invoices. Select an item to view its price history.")+`<section class="panel">${ctx.searchToolbar("Search item, description, or SKU",filter,`<span class="table-count">${rows.length} items</span>`)}<div class="table-wrap"><table><thead><tr><th>ITEM / SKU</th><th>SUPPLIER</th><th>LATEST INVOICE</th><th>PREVIOUS INVOICE</th><th>CHANGE</th><th></th></tr></thead><tbody>${rows.slice((page-1)*30,page*30).map(r=>{const h=invoicePriceHistory(r,ctx.data().invoices||[],st.store),change=invoicePriceChange(h),cell=v=>v?`<strong>${v.price==null?'Not recorded':money(v.price)}</strong><small>${e(v.uom||'')} · ${e(v.date||'')} · #${e(v.number||'')}</small>`:'—';return `<tr><td><button class="table-name-button" data-action="price-history" data-id="${e(r.supplierItemId)}">${e(r.internalName||r.name)}</button><small>${e([r.sku?'SKU '+r.sku:'No SKU',r.name].join(' · '))}</small></td><td>${e(ctx.suppliers().find(s=>s.id===r.supplierId)?.name||'—')}</td><td>${cell(h[0])}</td><td>${cell(h[1])}</td><td><span class="status ${change.delta>0?'red':change.delta<0?'green':''}">${e(change.label)}${change.percent!=null?' · '+(change.percent>0?'+':'')+change.percent.toFixed(2)+'%':''}</span></td><td><button class="row-action" data-action="price-history" data-id="${e(r.supplierItemId)}" aria-label="Price history for ${e(r.internalName||r.name)}">${icon('chart-no-axes-combined')}</button></td></tr>`;}).join('')}</tbody></table></div>${rows.length?'':empty("No items found","Try a different search or supplier.")}<div class="pagination"><span>${rows.length?(page-1)*30+1:0}–${Math.min(page*30,rows.length)} of ${rows.length}</span><div class="pages">${btn("Previous",'page-prev','chevron-left','',page<=1?'disabled':'')}<span class="btn current">${page}</span>${btn("Next",'page-next','chevron-right','',page*30>=rows.length?'disabled':'')}</div></div></section>`;
  }
  function priceHistory(id){
    const item=items().find(r=>r.supplierItemId===id);if(!item)return;
    const history=invoicePriceHistory(item,ctx.data().invoices||[],ctx.state().store);
    const units=[...new Set(history.filter(p=>p.price!=null).map(p=>p.unit))];
    const charts=units.map(unit=>{
      const points=history.filter(p=>p.unit===unit&&p.price!=null).slice().reverse(),max=Math.max(...points.map(p=>p.price),1),xs=points.map((p,i)=>40+i*620/Math.max(points.length-1,1)),ys=points.map(p=>190-p.price/max*160);
      return `<h3>${e(points[0].uom||'Unit')}</h3><svg viewBox="0 0 700 230" role="img" aria-label="Invoice price history in ${e(points[0].uom||'unit')}" style="width:100%;max-height:280px"><text x="5" y="20" font-size="12">${money(max)}</text><path d="M40 25 V195 H675" fill="none" stroke="#d9dfd3"/><polyline points="${points.map((p,i)=>`${xs[i]},${ys[i]}`).join(' ')}" fill="none" stroke="#24856c" stroke-width="2"/>${points.map((p,i)=>`<circle cx="${xs[i]}" cy="${ys[i]}" r="4" fill="#24856c"><title>${e(p.date)} · Invoice ${e(p.number)} · ${money(p.price)}</title></circle>`).join('')}<text x="40" y="220" font-size="12">${e(points[0].date)}</text><text x="660" y="220" text-anchor="end" font-size="12">${e(points.at(-1).date)}</text></svg>`;
    }).join('');
    ctx.openModal('Invoice price history',`<h3>${e(item.internalName||item.name)}</h3><p class="muted">Prices recorded on invoices, compared only within the same unit. Same-day invoices are ordered by registration time.</p>${charts||notice('No recorded invoice prices for this item.')}<div class="table-wrap"><table><thead><tr><th>DATE</th><th>INVOICE</th><th>LOCATION</th><th>PRICE / UNIT</th></tr></thead><tbody>${history.map(p=>`<tr><td>${e(p.date||'Not recorded')}</td><td><button class="table-name-button" data-action="invoice" data-id="${e(p.invoiceId)}">#${e(p.number||'')}</button></td><td>${e(p.location||'')}</td><td>${p.price==null?'Not recorded':money(p.price)} / ${e(p.uom||'—')}</td></tr>`).join('')}</tbody></table></div>`,btn('Close','close'),{wide:true});
  }
  const unitOptions=(row,id)=>options(prioritizeUnits(row.units||[]),id,"Not set");
  const booleanField=(label,key,value)=>field(label,'catalog-'+key,select('catalog-'+key,`<option value="true" ${value===true?'selected':''}>Yes</option><option value="false" ${value===false?'selected':''}>No</option>`,`data-item-field="${key}"`));
  const textField=(label,key,value,full=false,extra='')=>field(label,'catalog-'+key,input('catalog-'+key,value??'','text',`data-item-field="${key}" ${extra}`),full);
  function edit(id) {
    const row=items().find(x=>x.supplierItemId===id);if(!row)return;
    const price=priceFor(row),scope=ctx.state().store;
    const original={...row,price:price.amount,priceUnitId:price.unitId??null,priceScope:scope};
    editor={original,draft:createSupplierDraft(original),dirty:false,price,photo:ctx.local().itemPhotos?.[row.itemId]||null,photoBusy:false,photoDirty:false};
    renderEditor();
  }
  function links(row){
    const recipes=(ctx.data().recipes||[]).filter(r=>r.outputItemId===row.itemId||(r.components||[]).some(c=>c.itemId===row.itemId)).sort((a,b)=>(a.name||'').localeCompare(b.name||'','en-US'));
    return `<section class="catalog-section catalog-linked-recipes"><h3>Linked records</h3><div class="catalog-link-group"><strong>Recipes</strong><p>${recipes.map(r=>`<button type="button" class="table-name-button" data-action="recipe" data-id="${e(r.id)}">${e(r.name)}</button>`).join(' · ')||'No linked recipes.'}</p></div></section>`;
  }
  function renderEditor() {
    const row=editor.draft,s=ctx.suppliers().find(x=>x.id===row.supplierId),p=editor.price;
    const roles=[["Ordering unit",'orderingUnitId'],["Receiving unit",'receivingUnitId'],["Count unit",'stocktakeUnitId']];
    const body=`<div class="catalog-edit-heading"><span class="supplier-logo">${icon('package')}</span><div><div class="eyebrow">${e(s?.name||row.supplierName)}</div><h3>${e(row.name)}</h3><p>Shared across locations · ${e(row.sku||"No SKU")}</p></div><span class="validation-tag">${icon('hard-drive')}Local edit</span></div>
      ${itemPhotoView(row,editor.photo,'supplier')}<form id="supplier-item-form"><div class="catalog-editor-grid"><div class="catalog-editor-column"><section class="catalog-section"><h3>${icon('package')}Product information</h3><div class="form-grid">
      ${textField('Product Description','name',row.name,true,'required')}${textField('Internal name','internalName',row.internalName,true,'required')}${textField('Brand','brand',row.brand)}${textField('SKU','sku',row.sku)}
      ${field("Category",'catalog-categoryId',select('catalog-categoryId',options(catalog().categories||[],row.categoryId,"Uncategorized"),'data-item-field="categoryId"'))}
      ${field('Item Type','catalog-type',input('catalog-type',row.type==='prepared'?"Prep":row.type==='purchased'?"Purchased item":row.type,'text','readonly'))}
      ${field("Notes",'catalog-description',`<textarea id="catalog-description" data-item-field="description" rows="3">${e(row.description||'')}</textarea>`,true)}
      </div></section><section class="catalog-section"><h3>${icon('tag')}Purchase price</h3><p class="catalog-help">${e(scopeLabel(row.priceScope))}. Price and reference unit are saved together.</p><div class="form-grid">
      ${field('Price ($)','catalog-price',input('catalog-price',row.price??'','number',"min=\"0\" step=\"any\" data-item-field=\"price\" placeholder=\"Not specified\""))}
      ${field("Price unit",'catalog-priceUnitId',select('catalog-priceUnitId',unitOptions(row,row.priceUnitId),'data-item-field="priceUnitId"'))}</div>
      <p class="catalog-help">${p.varies?"Prices vary by location. A price saved here becomes the general local reference; location-specific edits take priority.":p.amount!=null?`${e(p.local?"Price edited in this preview.":"Latest approved price available.")}${p.date||p.effectiveAt?" Reference: "+date(p.date||p.effectiveAt)+'.':''}`:"No approved price available for this selection."}</p>
      ${p.amount!=null&&!p.local&&p.unitSource?`<p class="catalog-help">${p.unitSource==='invoice_line.item_unit_id'?"Price unit confirmed on the invoice.":"Reference unit from the current purchasing record."}</p>`:''}${priceHistory(row)}</section><section class="catalog-section"><h3>${icon('store')}Locations & storage areas</h3><div class="catalog-locations">${(row.stores||[]).map(l=>`<div><strong>${e(l.name)} ${l.active===false?"<span class=\"muted\">· inactive</span>":''}</strong><p>${(row.areas||[]).filter(a=>a.locationId===l.id).map(a=>e(a.name)).join(' · ')||"No assigned storage area"}</p></div>`).join('')||"<p class=\"muted\">No location assignments.</p>"}</div></section></div>
      <div class="catalog-editor-column"><section class="catalog-section"><h3>${icon('ruler')}Operating units</h3><p class="catalog-help">U.S. customary units appear first. Metric units remain available. Add an item-specific conversion before using a new unit.</p><div class="form-grid">${roles.map(([label,key])=>field(label,'catalog-'+key,select('catalog-'+key,unitOptions(row,row[key]),`data-item-field="${key}"`))).join('')}${field("Base unit",'catalog-base',input('catalog-base',row.baseUnitName||"Not specified",'text','readonly'))}</div></section>
      <section class="catalog-section"><h3>${icon('arrow-left-right')}Conversions</h3><p class="catalog-help">Quantity of ${e(row.baseUnitName||"base unit")} in each unit. The base unit stays unchanged.</p><div id="catalog-conversions"></div><div class="catalog-add-conversion"><select id="catalog-new-unit" aria-label="Unit for new conversion"></select>${btn("Add",'supplier-unit-add','plus','sm')}</div></section>
      <section class="catalog-section"><h3>${icon('settings-2')}Settings</h3><div class="form-grid">${booleanField("Active item",'active',row.active)}${booleanField("Active for this supplier",'supplierActive',row.supplierActive)}${row.trackInventory!=null?booleanField("Track inventory",'trackInventory',row.trackInventory):''}${row.yieldPercent!=null?field("Yield (%)",'catalog-yieldPercent',input('catalog-yieldPercent',row.yieldPercent,'number','min="0" max="100" step="any" data-item-field="yieldPercent"')):''}</div><p class="catalog-help">Internal name, category, and conversions are shared for this item. Product Description, brand, SKU, price, and ordering and receiving units belong to this supplier.</p></section>${links(row)}</div></div><p id="supplier-item-error" class="error-text" role="alert" tabindex="-1"></p></form>`;
    ctx.openModal("Item details",body,`${row.editedLocally?btn("Restore original",'supplier-restore','rotate-ccw','ghost'):''}<span class="meta catalog-save-note">${icon('hard-drive')}Changes saved to the database</span>${btn("Cancel",'supplier-cancel')}${btn("Save changes",'supplier-save','check','primary')}`,{wide:true,className:'catalog-item-modal',kind:'supplier-edit'});
    renderConversions();
  }
  function priceHistory(row) {
    const history=(row.currentPrices||[]);
    if(!history.length)return '';
    return `<details class="catalog-price-history"><summary>Approved prices by location</summary>${history.map(p=>`<div class="metric-inline"><span>${e(scopeLabel(p.locationId||'all'))}<small>${e(p.uom??p.priceUom??unitName(row,p.unitId??p.priceUnitId)??"Unit not confirmed")}${p.effectiveAt?' · '+date(p.effectiveAt):''}</small></span><strong>${money(p.amount??p.price)}</strong></div>`).join('')}</details>`;
  }
  function refreshUnitOptions(){for(const key of ['orderingUnitId','receivingUnitId','stocktakeUnitId','priceUnitId'])$('#catalog-'+key).innerHTML=unitOptions(editor.draft,editor.draft[key]);}
  function renderConversions() {
    const row=editor.draft,roles=[row.orderingUnitId,row.receivingUnitId,row.stocktakeUnitId,row.priceUnitId];
    $('#catalog-conversions').innerHTML=row.units.map((u,i)=>`<div class="catalog-conversion-row"><span>1 ${e(u.name)}</span><span>=</span><input type="number" min="0" step="any" data-unit-index="${i}" value="${e(u.factor)}" aria-label="Conversion for ${e(u.name)}" ${u.base?'readonly':''}><span>${e(row.baseUnitName)}</span><button type="button" class="icon-btn" data-action="supplier-unit-remove" data-index="${i}" aria-label="Remove conversion ${e(u.name)}" ${u.base||roles.includes(u.id)?"disabled title=\"Base unit or unit in use for this item\"":''}>${icon('trash-2')}</button></div>`).join('');
    const remaining=(catalog().units||[]).filter(u=>!row.units.some(x=>x.id===u.id));
    $('#catalog-new-unit').innerHTML=options(prioritizeUnits(remaining),'',"Select unit");ctx.icons();
  }
  async function uploadPhoto(el){
    const current=editor,file=el.files[0];if(!file||current.photoBusy)return;
    current.photoBusy=true;
    const section=el.closest('.item-photo'),message=section.querySelector('[data-photo-message]');
    section.querySelectorAll('button').forEach(b=>b.disabled=true);message.textContent="Preparing photo…";
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
      await saveLocal(result.local);ctx.setLocal(result.local);current.dirty=false;ctx.close(true);editor=null;ctx.render();ctx.toast(current.photoDirty?"Photo and item details saved.":"Item details updated in the database.");
    }catch(error){const target=$('#supplier-item-error');if(target){target.textContent=error.name==='QuotaExceededError'?"Unable to save locally: storage is full. A photo already verified in storage will still be available when you reload.":error.message;target.focus();}}
    finally{current.photoBusy=false;button.disabled=false;}
  }
  function requestDiscard() {
    if(editor?.photoBusy){ctx.toast("Wait for the photo to finish before closing.");return false;}
    if(!$('#supplier-discard-guard'))$('#overlay-root .modal-foot').insertAdjacentHTML('afterbegin',`<div class="recipe-discard-guard" id="supplier-discard-guard" role="alert"><span>You have unsaved changes.</span>${btn("Keep editing",'supplier-keep','','sm')}${btn("Discard changes",'supplier-discard','','sm')}</div>`);
    $('#supplier-discard-guard button')?.focus();return false;
  }
  function cancel(){if(editor?.dirty)return requestDiscard();ctx.close(true);editor=null;}
  function restore(){
    if(!$('#supplier-restore-guard'))$('#overlay-root .modal-foot').insertAdjacentHTML('afterbegin',`<div class="recipe-discard-guard" id="supplier-restore-guard" role="alert"><span>Restore shared item details and this supplier’s details from the original export?</span>${btn("Keep edits",'supplier-keep-restore','','sm')}${btn("Restore details",'supplier-confirm-restore','','sm')}</div>`);
  }
  const actions={
    'price-history':el=>priceHistory(el.dataset.id),
    'supplier-create':()=>forms.open('supplier'),'supplier-create-item':()=>forms.open('item',selected),'supplier-create-save':forms.save,
    'supplier-photo-upload':()=>$('#supplier-photo-file')?.click(),
    'supplier-photo-remove':()=>{editor.photo=null;editor.photoDirty=true;editor.dirty=true;$('.item-photo').outerHTML=itemPhotoView(editor.draft,null,'supplier');ctx.icons();},
    'supplier-sort':el=>{const key=el.dataset.key;direction=sortKey===key&&direction==='asc'?'desc':'asc';sortKey=key;ctx.state().page=1;ctx.render();},
    'supplier-back':()=>{selected=null;ctx.state().q='';ctx.state().page=1;ctx.render();},
    'supplier-item':el=>edit(el.dataset.id),'supplier-save':save,'supplier-cancel':cancel,
    'supplier-discard':()=>{if(editor.photoBusy)return;editor.dirty=false;ctx.close(true);editor=null;},'supplier-keep':()=>$('#supplier-discard-guard')?.remove(),
    'supplier-restore':restore,'supplier-keep-restore':()=>$('#supplier-restore-guard')?.remove(),
    'supplier-confirm-restore':()=>{try{const source=catalog().items.find(x=>x.supplierItemId===editor.original.supplierItemId);const result=restoreSupplierDraft(ctx.local(),source,{catalog:catalog()});ctx.setLocal(result.local);editor.dirty=false;ctx.close(true);editor=null;ctx.render();ctx.toast("Original item details restored in this preview.");}catch(error){$('#supplier-item-error').textContent=error.message||"Unable to restore. Try again.";$('#supplier-item-error').focus();}},
    'supplier-unit-add':()=>{const id=$('#catalog-new-unit').value,u=catalog().units.find(x=>x.id===id);if(!u)return;editor.draft.units.push({...u,itemUnitId:'local-'+crypto.randomUUID(),factor:'',base:false,ordering:false,receiving:false,stocktake:false});editor.dirty=true;refreshUnitOptions();renderConversions();},
    'supplier-unit-remove':el=>{const i=Number(el.dataset.index),u=editor.draft.units[i];if(!u||u.base||[editor.draft.orderingUnitId,editor.draft.receivingUnitId,editor.draft.stocktakeUnitId,editor.draft.priceUnitId].includes(u.id))return;editor.draft.units.splice(i,1);editor.dirty=true;refreshUnitOptions();renderConversions();}
  };
  return {open,reset,count,table,prices,actions,changed,requestDiscard,get selected(){return selected;},get dirty(){return editor?.dirty||editor?.photoBusy||false;},changeStatus(value){itemStatus=value;ctx.state().page=1;ctx.render();}};
}
