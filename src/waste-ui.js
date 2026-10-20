import {api} from './cloud.js';
import {createItemSearch} from './item-search.js';
import {createMultiSelect} from './multi-select.js';
import {closeDatePicker} from './date-picker.js';
import {compactDateLabel} from './date-picker-model.js';
import {escape as e,norm,preciseNumber,money} from './model.js';
import {itemQuantityValue} from './recipe-cost-model.js';
export const wasteReasons=['Expired','Spoiled','Preparation error','Overproduction','Damaged','Other'];
export function createWasteUI(ctx){
 const {btn,heading,searchToolbar,empty,field,input,select,options}=ctx;let draftId=null,busy=false,savedAt=null,itemSearch=null;
 const $=s=>document.querySelector(s);
 const items=loc=>ctx.data().items.filter(x=>x.locationId===loc&&x.active!==false).filter((x,i,a)=>a.findIndex(y=>y.id===x.id)===i).sort((a,b)=>a.name.localeCompare(b.name));
 // Estimated loss uses today's supplier prices or the prep recipe cost; a dash means a price or conversion is missing.
 const lossValue=x=>itemQuantityValue({itemId:x.inventoryItemId,itemUnitId:x.inventoryItemUnitId,quantity:x.quantity,locationId:x.locationId},ctx.data(),ctx.local?.()||{});
 const lossTag=x=>{const value=lossValue(x);return value==null?'<span class="muted" title="No price or conversion available">—</span>':`<span class="status red">-${money(value)}</span>`;};
 // Filters follow the Prep history pattern: one Date trigger for a single day or a period, and a searchable multi-select.
 const ws={start:'',end:'',reasons:'all'};
 const wasteDay=x=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(x.occurredAt));
 const reasonRows=()=>[...new Set([...wasteReasons,...(ctx.data().waste||[]).map(x=>x.reason).filter(Boolean)])].map(name=>({id:name,name}));
 const reasonPicker=createMultiSelect({action:'waste-reasons-filter',label:'Reason',allSummary:'All',rows:reasonRows,current:()=>ws.reasons,onChange:value=>{ws.reasons=value;ctx.state().page=1;ctx.render();},beforeOpen:()=>closeDatePicker(false)});
 const inStoreAndDates=x=>{const state=ctx.state(),day=wasteDay(x);return (state.store==='all'||x.locationId===state.store)&&(!ws.start||day>=ws.start)&&(!ws.end||day<=ws.end);};
 const reasonMatches=x=>ws.reasons==='all'||ws.reasons.includes(x.reason);
 // Net sales for the same store and days as the loss. Without a date filter, the period runs from the first to the
 // last waste day shown. Days with no imported sales are reported, since they would inflate the percentage.
 function salesShare(rows,total){
  const days=rows.map(wasteDay).sort(),from=ws.start||days[0],to=ws.end||ws.start||days.at(-1);if(!from)return null;
  const store=ctx.state().store,sales=(ctx.data().salesDaily||[]).filter(x=>(store==='all'||x.locationId===store)&&x.date>=from&&x.date<=to);
  const net=sales.reduce((a,x)=>a+Number(x.netSales||0),0),covered=new Set(sales.map(x=>x.date));
  let missing=0;for(let d=new Date(from+'T12:00:00Z');d.toISOString().slice(0,10)<=to;d=new Date(d.getTime()+86400000))if(!covered.has(d.toISOString().slice(0,10)))missing++;
  return {from,to,net,missing,pct:net>0?total/net*100:null};
 }
 function totalCard(){const rows=(ctx.data().waste||[]).filter(inStoreAndDates),values=rows.map(lossValue),known=values.filter(v=>v!=null),missing=values.length-known.length,total=known.reduce((a,b)=>a+b,0);
  const where=ctx.state().store==='all'?'All locations':(ctx.data().locations.find(l=>l.id===ctx.state().store)?.name||'Selected location');
  const scope=`${ws.start||ws.end?compactDateLabel(ws.start,ws.end||ws.start):'All dates'} · ${where}`;
  const share=salesShare(rows,total),period=share?compactDateLabel(share.from,share.to):'';
  const shareCard=ctx.stat('Waste / net sales',`<span class="waste-total">${share?.pct==null?'—':`${share.pct<10?share.pct.toFixed(2):share.pct.toFixed(1)}%`}</span>`,'percent',
   share?share.net>0?`${money(total)} of ${money(share.net)} net sales · ${e(period)}${share.missing?` · no sales imported for ${share.missing} ${share.missing===1?'day':'days'}`:''}`:`No net sales imported for ${e(period)}`:'No waste in this period');
  return `<div class="stats waste-stats">${ctx.stat('Estimated loss',`<span class="waste-total">${total?'-':''}${money(total)}</span>`,'trending-down',`${rows.length} ${rows.length===1?'record':'records'} · ${e(scope)}${missing?` · ${missing} without a price`:''}`)}${shareCard}</div>`;}
 function page(){const state=ctx.state(),rows=(ctx.data().waste||[]).filter(x=>inStoreAndDates(x)&&reasonMatches(x)&&norm(x.name+' '+x.reason+' '+x.notes).includes(norm(state.q))).sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt)),per=25,page=Math.min(state.page,Math.max(1,Math.ceil(rows.length/per)));
 return heading('Operations','Waste','Record losses and review inventory deductions.',btn('Waste log','waste-new','plus','primary'))+totalCard()+`<div class="prep-filters prep-usage-filters waste-filters"><div class="hd-date-filter"><input id="waste-start" type="date" data-waste-date value="${ws.start}" data-date-end="#waste-end" aria-label="Waste date"><input id="waste-end" type="date" data-waste-date value="${ws.end}" data-date-start="#waste-start"></div>${reasonPicker.trigger()}</div><section class="panel">${searchToolbar('Search waste history','',`<span class="table-count">${rows.length} records</span>`)}${rows.length?`<div class="table-wrap"><table><thead><tr><th>Date</th><th>Item</th><th>Quantity</th><th>UOM</th><th>Reason</th><th>Location</th><th>Reported by</th><th>Estimated loss</th></tr></thead><tbody>${rows.slice((page-1)*per,page*per).map(x=>`<tr><td>${e(new Date(x.occurredAt).toLocaleString('en-US',{timeZone:'America/New_York',month:'2-digit',day:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}))}</td><td>${e(x.name)}</td><td>${preciseNumber(x.quantity)}</td><td>${e(x.unitName||'—')}</td><td>${e(x.reason)}</td><td>${e(x.locationName)}</td><td>${e(x.reportedByName||'Team member')}${Object.hasOwn(x,'reportedTeamMemberId')&&!x.reportedTeamMemberId?'<small>Not linked to a team member</small>':''}</td><td>${lossTag(x)}</td></tr>`).join('')}</tbody></table></div>`:empty('No waste recorded','Use Waste log to record an inventory loss.')}<div class="pagination"><span>${rows.length?(page-1)*per+1:0}–${Math.min(page*per,rows.length)} of ${rows.length}</span><div class="pages">${btn('Previous','page-prev','chevron-left','',page<=1?'disabled':'')}<span class="btn current">${page}</span>${btn('Next','page-next','chevron-right','',page*per>=rows.length?'disabled':'')}</div></div></section>`;
 }
 // Device date and time; the record is stamped again at save so it matches the moment of recording.
 const stamp=d=>d.toLocaleString('en-US',{month:'2-digit',day:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
 const output=(label,id,value)=>`<div class="field"><label for="${id}">${label}</label><output id="${id}">${e(value)}</output></div>`;
 let reporter=null;
 async function loadReporter(){if(reporter)return reporter;for(const path of ['/api/waste/reporter','/api/preparation/preparer']){try{const value=await api(path);if(value?.name){reporter=value.name;break;}}catch{}}return reporter;}
 function open(){draftId=crypto.randomUUID();savedAt=null;const loc=ctx.state().store==='all'?'':ctx.state().store;
 ctx.openModal('Waste log',`<form id="waste-form"><div class="form-grid">${field('Location','waste-location',select('waste-location',options(ctx.data().locations,loc,'Select location'),'required data-change="waste-location"'))}${field('Item','waste-item-search','<div id="waste-item-search"></div><input type="hidden" id="waste-item">')}${field('Quantity','waste-quantity',input('waste-quantity','','number','min="0.000001" max="1000000" step="any" required'))}${field('UOM','waste-unit',select('waste-unit','','required'))}${field('Reason','waste-reason',select('waste-reason',options(wasteReasons.map(name=>({id:name,name})),'','Select reason'),'required'))}${output('Date/Time','waste-at',stamp(new Date()))}${output('Reported by','waste-reporter',reporter||ctx.user?.()?.email||'Signed-in user')}${field('Notes','waste-notes','<textarea id="waste-notes" maxlength="4000"></textarea>')}<p id="waste-area-note" class="prep-help prep-warning waste-full" hidden></p></div><p class="prep-help">Saving deducts this quantity from the item's storage area at this location and records the loss under your name.</p><p class="error-text" role="alert" id="waste-error"></p></form>`,btn('Cancel','close')+btn('Save','waste-save','check','receipt-confirm-button'),{wide:true,subtitle:'Record a loss and deduct it from inventory'});
 for(const id of ['#waste-reason','#waste-notes'])$(id)?.closest('.field')?.classList.add('full');updateLocation();loadReporter().then(name=>{const out=$('#waste-reporter');if(name&&out)out.textContent=name;});}
 // Same search used in transfers and orders: type a name, internal name or SKU, then pick from the results.
 function updateLocation(){const loc=$('#waste-location').value;$('#waste-item').value='';itemSearch?.destroy();itemSearch=createItemSearch($('#waste-item-search'),{label:'Search items to record as waste',required:true,items:()=>items(loc),onSelect:item=>{$('#waste-item').value=item.id;updateItem();$('#waste-quantity')?.focus();},onQueryChange:()=>{if($('#waste-item').value){$('#waste-item').value='';updateItem();}}});itemSearch.setDisabled(!loc);ctx.icons?.();updateItem();}
 const missingArea=item=>`${item.name} has no storage area at this location. Assign one in Inventory before recording waste.`;
 function updateItem(){const item=items($('#waste-location').value).find(x=>x.id===$('#waste-item').value);$('#waste-unit').innerHTML=options((item?.units||[]).filter(u=>u.factor>0).map(u=>({id:u.itemUnitId,name:u.name})),'','Select UOM');const note=$('#waste-area-note');if(note){note.hidden=!item||Boolean(item.areaId);note.textContent=note.hidden?'':missingArea(item);}}
 async function save(){if(busy||!$('#waste-form').reportValidity())return;busy=true;const b=$('[data-action="waste-save"]');b.disabled=true;const value=id=>$('#waste-'+id).value;
 try{const item=items(value('location')).find(x=>x.id===value('item'));if(!item?.areaId)throw Error(item?missingArea(item):'Choose an item available at this location.');const at=savedAt||=new Date();$('#waste-at').textContent=stamp(at);
 await api('/api/waste',{id:draftId,payload:{locationId:value('location'),itemId:value('item'),areaId:item.areaId,unitId:value('unit'),quantity:Number(value('quantity')),occurredAt:at.toISOString(),reason:value('reason'),notes:value('notes')}});ctx.close(true);ctx.render();ctx.toast('Waste recorded and inventory updated.');ctx.refreshAfterSave();}
 catch(error){const target=$('#waste-error');if(target)target.textContent=error.message;else ctx.toast(error.message);}finally{busy=false;b.disabled=false;}}
 return {page,actions:{'waste-new':open,'waste-save':save,'waste-reasons-filter':()=>reasonPicker.open()},changed(el){if(el.dataset.wasteDate!=null){ws.start=$('#waste-start')?.value||'';ws.end=$('#waste-end')?.value||'';ctx.state().page=1;ctx.render();return true;}if(el.dataset.change==='waste-location'){updateLocation();return true;}return false;}};
}
