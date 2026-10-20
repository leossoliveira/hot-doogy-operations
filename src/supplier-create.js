import {createCatalogDraft} from './catalog-draft.js';
import {api} from './cloud.js';
import {escape as e} from './model.js';
import {prioritizeUnits} from './units.js';
export function createSupplierForms(ctx){
 let kind,draft,busy=false;
 const field=(name,label,type='text',required=false)=>`<label class="field">${label}<input name="${name}" type="${type}" ${required?'required':''} ${type==='number'?'min="0" step="any"':''}></label>`;
 const select=(name,label,rows,required=true)=>`<label class="field">${label}<select name="${name}" ${required?'required':''}><option value="">Select…</option>${rows.map(r=>`<option value="${e(r.id)}">${e(r.name)}</option>`).join('')}</select></label>`;
 function open(type,supplierId){if(busy)return;kind=type;let storage;try{storage=globalThis.localStorage;}catch{}
 draft=createCatalogDraft({storage:ctx.user?.()?storage:null,key:'hotdoogy:catalog-draft:'+ctx.user?.()+':'+type+':'+(supplierId||'new')});const cat=ctx.catalog();
 const fields=type==='supplier'?field('name','Supplier name','text',true)+field('contactName','Contact name')+field('email','Email','email')+field('phone','Phone','tel')+field('address','Street address')+field('city','City')+field('region','State / Province')+field('postalCode','ZIP / Postal code')+field('country','Country')+field('taxId','Tax ID')+field('accountNumber','Account number')+field('paymentTerms','Payment terms')+field('websiteUrl','Website','url')+field('orderUrl','Ordering URL','url')+select('categoryId','Category',cat.supplierCategories||[],false)+select('orderMethod','Order method',['portal','email','sms','link','phone','other'].map(id=>({id,name:id[0].toUpperCase()+id.slice(1)})),false):
 `<input type="hidden" name="supplierId" value="${e(supplierId)}">`+field('internalName','Internal name','text',true)+field('name','Product Description','text',true)+field('brand','Brand')+field('sku','SKU')+select('categoryId','Category',cat.categories||[])+select('baseUnitId','Base unit',prioritizeUnits(cat.units||[]))+select('orderUnitId','Ordering / receiving unit',prioritizeUnits(cat.units||[]))+field('orderFactor','Base units per ordering unit','number',true)+select('countUnitId','Count unit',prioritizeUnits(cat.units||[]))+field('countFactor','Base units per count unit','number',true)+field('price','Price per ordering unit ($)','number')+field('productUrl','Product URL','url')+`<fieldset class="field full"><legend>Locations and storage areas</legend>${ctx.locations().map(l=>`<label class="supplier-location-create"><input type="checkbox" name="locations" value="${e(l.id)}">${e(l.name)}<select name="area-${e(l.id)}" aria-label="Storage area for ${e(l.name)}"><option value="">Select storage area…</option>${(cat.storageAreas||[]).filter(a=>a.locationId===l.id&&a.active!==false).map(a=>`<option value="${e(a.id)}">${e(a.name)}</option>`).join('')}</select></label>`).join('')}</fieldset><p class="field full">Conversions specify how many base units are in one ordering or count unit. Photos can be added in Item details after saving.</p>`;
 ctx.openModal(type==='supplier'?'Add supplier':'Add item',`<form id="supplier-create-form"><div class="form-grid">${fields}<label class="field full">Notes<textarea name="notes" rows="3"></textarea></label></div><p id="supplier-create-error" class="error-text" role="alert"></p></form>`,ctx.btn('Cancel','close')+ctx.btn('Save','supplier-create-save','check','primary'),{wide:true,kind:'supplier-create'});
 const form=document.querySelector('#supplier-create-form');
 for(const [name,value] of draft.value.fields){for(const el of [...form.elements].filter(el=>el.name===name)){if(el.type==='checkbox')el.checked=draft.value.fields.some(([n,v])=>n===name&&v===el.value);else el.value=value;}}
 const capture=()=>{if(!draft.capture([...new FormData(form).entries()]))message(form,'Draft recovery is unavailable in this browser. Keep this form open until saving is confirmed.');};
 form.addEventListener('input',capture);form.addEventListener('change',capture);
 if(draft.value.fields.length)message(form,'Your unfinished draft was restored.');
 if(draft.value.pending){lock(form,true);message(form,'The previous save was not confirmed. Select Save to check it safely without creating a duplicate.');}
 }
 function message(form,text){const el=form.querySelector('#supplier-create-error');if(el)el.textContent=text;}
 function lock(form,value){for(const el of form.elements)el.disabled=value;}

 async function save(){
 const form=document.querySelector('#supplier-create-form');if(busy||!form)return;
 const current=draft,operationKind=kind;
 let envelope=current.value.pending;
 if(!envelope){
  if(!form.reportValidity())return;
  const fields=[...new FormData(form).entries()],payload=Object.fromEntries(fields);
  if(kind==='item'){
   payload.locations=[...form.querySelectorAll('[name="locations"]:checked')].map(el=>({id:el.value,areaId:form.elements['area-'+el.value].value}));
   if(!payload.locations.length||payload.locations.some(l=>!l.areaId)){message(form,'Select at least one location and its storage area.');return;}
  }
  current.capture(fields);envelope=current.prepare(kind,payload);
 }
 busy=true;lock(form,true);
 const button=document.querySelector('[data-action="supplier-create-save"]'),label=button?.innerHTML;
 if(button){button.disabled=true;button.textContent='Saving…';}
 message(form,'Saving your draft. Please wait for confirmation.');
 try{
  await api('/api/catalog/create',envelope);current.complete();
  if(document.querySelector('#supplier-create-form')===form)ctx.close(true);
  ctx.toast(operationKind==='supplier'?'Supplier created.':'Item created.');
  try{await ctx.refresh();ctx.render();}catch{ctx.toast('Saved. The list updates on the next automatic refresh.','info');}
 }catch(error){
  if([400,422].includes(error.status)){current.rejected();lock(form,false);}
  message(form,error.status>=500?'The save could not be confirmed. Your draft is kept. Select Save to retry the same item safely.':error.message);
 }finally{busy=false;if(button){button.disabled=false;button.innerHTML=label;}}
 }

 return {open,save};
}
