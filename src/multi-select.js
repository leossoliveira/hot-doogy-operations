import {escape as e,norm} from './model.js';
const chevron='<svg class="hd-date-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>';

// Reuses the compact Date trigger and the searchable checkbox popover styling.
export function createMultiSelect({action,label,rows,current,onChange,allSummary='',beforeOpen=()=>{}}){
 let panel=null,query='';
 const anchor=()=>document.querySelector(`[data-action="${action}"]`);
 const selected=()=>current()==='all'?rows().map(x=>x.id):current();
 function trigger(){
  const ids=selected(),all=current()==='all',summary=all?allSummary:ids.length===0?'None':ids.length===1?rows().find(x=>x.id===ids[0])?.name||'1 selected':`${ids.length} selected`;
  return `<button type="button" class="hd-date-trigger" data-action="${action}" aria-haspopup="dialog" aria-expanded="${!!panel}" aria-label="${e(label)}: ${e(summary||'All')}"><span class="hd-date-caption">${e(label)}</span>${summary?`<span class="hd-date-value">${e(summary)}</span>`:''}${chevron}</button>`;
 }
 function position(){
  if(!panel)return;if(!anchor()){close(false);return;}
  const r=anchor().getBoundingClientRect(),v=window.visualViewport,left=v?.offsetLeft||0,top=v?.offsetTop||0,width=v?.width||innerWidth,height=v?.height||innerHeight;
  panel.style.maxHeight=`${height-24}px`;
  panel.style.left=`${Math.max(left+12,Math.min(r.left,left+width-panel.offsetWidth-12))}px`;
  panel.style.top=`${Math.max(top+12,Math.min(r.bottom+8,top+height-panel.offsetHeight-12))}px`;
 }
 function paint(){
  const ids=selected(),all=rows(),every=all.length>0&&all.every(x=>ids.includes(x.id)),matches=all.filter(x=>norm(x.name).includes(norm(query)));
  panel.querySelector('.location-options').innerHTML=`<label class="location-option location-all"><span>${every?'Deselect all':'Select all'}</span><small>${ids.length}</small><input type="checkbox" data-multi-all aria-label="${every?'Deselect all':'Select all'}" ${every?'checked':''}></label><div class="location-list">${matches.map(x=>`<label class="location-option"><span>${e(x.name)}</span><input type="checkbox" data-multi-id="${e(x.id)}" aria-label="${e(x.name)}" ${ids.includes(x.id)?'checked':''}></label>`).join('')||'<p class="location-no-results" role="status">No matches found.</p>'}</div>`;
  panel.querySelector('[data-multi-all]').indeterminate=ids.length>0&&!every;position();
 }
 function close(restore=true){
  if(!panel)return;panel.remove();panel=null;
  document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',keydown,true);
  window.removeEventListener('resize',position);window.removeEventListener('scroll',position,true);
  window.visualViewport?.removeEventListener('resize',position);window.visualViewport?.removeEventListener('scroll',position);
  anchor()?.setAttribute('aria-expanded','false');if(restore)anchor()?.focus();
 }
 function outside(ev){if(panel&&!panel.contains(ev.target)&&!anchor()?.contains(ev.target))close(false);}
 function keydown(ev){
  if(ev.key==='Escape'){ev.preventDefault();ev.stopImmediatePropagation();close();}
  if(ev.key==='Tab'){
   ev.stopImmediatePropagation();const els=[...panel.querySelectorAll('input,button')],first=els[0],last=els.at(-1);
   if(ev.shiftKey&&document.activeElement===first){ev.preventDefault();last.focus();}
   else if(!ev.shiftKey&&document.activeElement===last){ev.preventDefault();first.focus();}
  }
 }
 function open(){
  if(panel){close();return;}beforeOpen();query='';
  panel=document.createElement('section');panel.className='location-popover invoice-multi-popover';panel.setAttribute('role','dialog');panel.setAttribute('aria-label',`Select ${label.toLowerCase()}`);panel.setAttribute('aria-modal','true');
  panel.innerHTML=`<label class="location-search"><input type="search" placeholder="Search…" aria-label="Search ${label.toLowerCase()}" autocomplete="off"></label><div class="location-options"></div><footer><button type="button" class="btn sm" data-multi-done>Done</button></footer>`;
  document.body.append(panel);anchor()?.setAttribute('aria-expanded','true');paint();
  panel.querySelector('[data-multi-done]').addEventListener('click',()=>close());
  panel.addEventListener('input',ev=>{if(ev.target.type==='search'){query=ev.target.value;paint();}});
  panel.addEventListener('change',ev=>{
   const input=ev.target;if(input.type!=='checkbox')return;const ids=new Set(selected()),focusId=input.dataset.multiId;
   if(input.hasAttribute('data-multi-all')){ids.clear();if(input.checked)rows().forEach(x=>ids.add(x.id));}
   else if(input.checked)ids.add(focusId);else ids.delete(focusId);
   const value=rows().every(x=>ids.has(x.id))?'all':[...ids];onChange(value);paint();
   const focus=focusId?[...panel.querySelectorAll('[data-multi-id]')].find(x=>x.dataset.multiId===focusId):panel.querySelector('[data-multi-all]');focus?.focus();
  });
  document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',keydown,true);
  window.addEventListener('resize',position);window.addEventListener('scroll',position,true);
  window.visualViewport?.addEventListener('resize',position);window.visualViewport?.addEventListener('scroll',position);
  panel.querySelector('input').focus();
 }
 return {trigger,open,close,get isOpen(){return !!panel;}};
}
