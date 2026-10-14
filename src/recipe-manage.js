// Management tab of a prep recipe: name, use-by shelf life, yield and the prep item's unit conversions.
import {escape as e,preciseNumber} from './model.js';

const unitLabel=u=>u?.name||u?.abbreviation||u?.code||'Unit';
export const useByText=days=>days==null||days===''?'Not set':`${days} ${Number(days)===1?'day':'days'} after prep`;

// Editable copy of the stored values. Units carry the item's current conversions plus any added in the editor.
export function manageState(recipe,item){
  return {
    name:recipe.name||'',
    useByDays:recipe.useByDays??'',
    yieldQuantity:recipe.yieldQuantity??'',
    yieldUnitId:recipe.yieldUomId||'',
    units:(item?.units||[]).map(u=>({unitId:u.unitId||u.id,name:unitLabel(u),factor:u.factor,base:Boolean(u.base),saved:true})),
  };
}

// Only changed keys are returned, so the save command leaves everything else untouched.
export function manageChanges(recipe,item,state){
  const changes={};
  const name=String(state.name??'').trim();
  if(!name)throw Error('Enter a recipe name.');
  if(name.length>120)throw Error('Use a recipe name of up to 120 characters.');
  if(name!==recipe.name)changes.name=name;
  const rawUseBy=String(state.useByDays??'').trim(),useBy=rawUseBy===''?null:Number(rawUseBy);
  if(useBy!==null&&!(Number.isInteger(useBy)&&useBy>=1&&useBy<=365))throw Error('Use by must be a whole number of days from 1 to 365, or blank.');
  if(useBy!==(recipe.useByDays??null))changes.useByDays=useBy;
  if(!item)return changes;
  const units=[];
  for(const u of state.units||[]){
    const factor=Number(u.factor);
    if(String(u.factor??'').trim()===''||!Number.isFinite(factor)||factor<=0)throw Error(`Enter a conversion greater than zero for ${u.name}.`);
    if(u.base&&factor!==1)throw Error('The base unit must stay at 1.');
    const saved=(item.units||[]).find(x=>(x.unitId||x.id)===u.unitId);
    if(!saved||Number(saved.factor)!==factor)units.push({unitId:u.unitId,factor});
  }
  if(units.length)changes.units=units;
  const rawYield=String(state.yieldQuantity??'').trim();
  if(rawYield===''&&recipe.yieldQuantity==null&&!state.yieldUnitId)return changes;
  const quantity=Number(rawYield);
  if(rawYield===''||!Number.isFinite(quantity)||quantity<=0)throw Error('Enter a yield greater than zero.');
  if(!state.yieldUnitId||!(state.units||[]).some(u=>u.unitId===state.yieldUnitId))throw Error('Choose a yield unit with a conversion.');
  if(quantity!==Number(recipe.yieldQuantity)||state.yieldUnitId!==recipe.yieldUomId){changes.yieldQuantity=quantity;changes.yieldUnitId=state.yieldUnitId;}
  return changes;
}

const pair=(label,value)=>`<div class="detail-pair"><small>${label}</small><strong>${value}</strong></div>`;
const field=(label,id,control,hint='')=>`<div class="field"><label for="${id}">${label}</label>${control}${hint?`<small class="field-hint">${hint}</small>`:''}</div>`;

export function manageView(recipe,item,{editing=false,state=null,allUnits=[]}={}){
  const base=item?.baseUnitName||unitLabel((item?.units||[]).find(u=>u.base))||'base unit';
  if(!editing){
    const conversions=(item?.units||[]).filter(u=>!u.base);
    return `<div class="section-title">Management</div><div class="detail-grid recipe-manage-grid">${pair('Recipe name',e(recipe.name))}${pair('Prep item',e(item?.name||'Not linked'))}${pair('Yield',recipe.yieldQuantity==null?'Not specified':`${preciseNumber(recipe.yieldQuantity)} ${e(recipe.yieldUom||'')}`)}${pair('Use by',e(useByText(recipe.useByDays)))}</div>
<div class="section-title">Conversions</div>${item?`<p class="prep-help">Quantity of ${e(base)} in each unit of ${e(item.name)}.</p>${conversions.length?`<div class="table-wrap"><table><thead><tr><th>UNIT</th><th>EQUALS</th></tr></thead><tbody>${conversions.map(u=>`<tr><td>1 ${e(unitLabel(u))}</td><td>${preciseNumber(u.factor)} ${e(base)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">Only the base unit is set up.</p>'}`:'<p class="muted">This recipe has no prep item, so it has no conversions.</p>'}
<p class="prep-help">${Object.hasOwn(recipe,'useByDays')?'Use Edit recipe to change these fields.':'Editing these fields needs a database update that is not applied yet.'}</p>`;
  }
  const s=state,addable=allUnits.filter(u=>!s.units.some(x=>x.unitId===u.id));
  return `<div class="section-title">Management</div><div class="form-grid recipe-manage-form">
${field('Recipe name','recipe-manage-name',`<input id="recipe-manage-name" type="text" required maxlength="120" value="${e(s.name)}" data-recipe-manage="name">`,item?'Also renames the prep item in inventory and prep.':'')}
${field('Use by (days after prep)','recipe-manage-useby',`<input id="recipe-manage-useby" type="number" min="1" max="365" step="1" inputmode="numeric" placeholder="Not set" value="${e(s.useByDays)}" data-recipe-manage="useByDays">`,'Printed on prep labels as the production date plus these days. Leave blank to write it by hand.')}
${item?`${field('Yield quantity','recipe-manage-yield',`<input id="recipe-manage-yield" type="number" min="0" step="any" value="${e(s.yieldQuantity)}" data-recipe-manage="yieldQuantity">`,'Applies to the new version.')}
${field('Yield unit','recipe-manage-yield-unit',`<select id="recipe-manage-yield-unit" data-recipe-manage="yieldUnitId"><option value="">Choose a unit</option>${s.units.map(u=>`<option value="${e(u.unitId)}" ${u.unitId===s.yieldUnitId?'selected':''}>${e(u.name)}</option>`).join('')}</select>`)}`:''}
</div>${item?`<div class="section-title">Conversions</div><p class="prep-help">Quantity of ${e(base)} in each unit of ${e(item.name)}. Changes apply wherever this prep item is counted, transferred or produced.</p>
<div class="catalog-conversions">${s.units.map((u,i)=>`<div class="catalog-conversion-row"><span>1 ${e(u.name)}</span><span>=</span><input type="number" min="0" step="any" value="${e(u.factor)}" data-manage-unit="${i}" aria-label="Conversion for ${e(u.name)}" ${u.base?'readonly':''}><span>${e(base)}</span></div>`).join('')}</div>
${addable.length?`<div class="catalog-add-conversion"><select id="recipe-manage-new-unit" aria-label="Unit for new conversion">${addable.map(u=>`<option value="${e(u.id)}">${e(unitLabel(u))}</option>`).join('')}</select><button class="btn sm" type="button" data-action="recipe-manage-unit-add"><i data-lucide="plus" class="icon" aria-hidden="true"></i>Add</button></div>`:''}`:''}`;
}
