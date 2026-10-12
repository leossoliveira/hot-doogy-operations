import {escape as e,norm} from './model.js';
export function searchItems(items,query){const q=norm(query).trim();return q?items.filter(item=>norm([item.name,item.internalName,item.sku,item.productDescription].join(' ')).includes(q)).sort((a,b)=>(a.internalName||a.name||'').localeCompare(b.internalName||b.name||'','en',{sensitivity:'base',numeric:true})):[];}
export function createItemSearch(root,{items,onSelect,onQueryChange=()=>{},label='Search items',placeholder='Search by name, internal name or SKU',selected=null,required=false}){
 const id='item-search-'+crypto.randomUUID();let matches=[],active=-1,picked=selected,disabled=false;
 const title=item=>item.internalName||item.name||'',caption=item=>[`SKU ${item.sku||'—'}`,item.productDescription||item.name!==title(item)&&item.name||''].filter(Boolean).join(' · ');
 root.innerHTML=`<div class="inline-item-search"><div class="input-wrap"><i data-lucide="search" class="icon" aria-hidden="true"></i><input type="search" role="combobox" aria-label="${e(label)}" aria-autocomplete="list" aria-expanded="false" aria-controls="${id}" autocomplete="off" placeholder="${e(placeholder)}" value="${e(selected?title(selected):'')}" ${required?'required':''}></div><div id="${id}" class="item-search-options" role="listbox" aria-label="${e(label)} results" hidden></div></div>`;
 const input=root.querySelector('input'),list=root.querySelector('[role=listbox]');
 const close=()=>{list.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');active=-1;};
 const choose=item=>{if(disabled)return;picked=item;input.value=title(item);input.setCustomValidity('');close();onSelect(item);};
 const highlight=()=>{list.querySelectorAll('[role=option]').forEach((el,i)=>el.setAttribute('aria-selected',String(i===active)));const option=list.children[active];if(option){input.setAttribute('aria-activedescendant',option.id);option.scrollIntoView({block:'nearest'});}};
 const render=()=>{const q=input.value.trim();matches=searchItems(items(),q).slice(0,12);active=-1;if(!q){close();list.innerHTML='';return;}list.innerHTML=matches.length?matches.map((item,i)=>`<button type="button" role="option" aria-selected="false" id="${id}-${i}" data-choice="${i}"><strong>${e(title(item))}</strong><small>${e(caption(item))}</small></button>`).join(''):'<p role="status">No items found.</p>';list.hidden=false;input.setAttribute('aria-expanded','true');};
 input.oninput=()=>{picked=null;if(required)input.setCustomValidity('Choose an item from the results.');onQueryChange(input.value);render();};
 input.onfocus=()=>{if(!picked)render();};
 input.onblur=()=>requestAnimationFrame(()=>{if(!root.contains(document.activeElement))close();});
 input.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();return;}if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();if(list.hidden)render();if(matches.length){active=(active+(event.key==='ArrowDown'?1:-1)+matches.length)%matches.length;highlight();}}else if(event.key==='Enter'){event.preventDefault();if(!list.hidden&&matches.length)choose(matches[Math.max(active,0)]);}};
 list.onpointerdown=event=>event.preventDefault();list.onclick=event=>{const option=event.target.closest('[data-choice]');if(option)choose(matches[Number(option.dataset.choice)]);};
 if(required&&!picked)input.setCustomValidity('Choose an item from the results.');
 return {focus:()=>input.focus(),clear(){picked=null;input.value='';close();},setDisabled(value){disabled=value;input.disabled=value;if(value)close();},destroy(){root.innerHTML='';}};
}
