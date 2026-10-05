import {escape as e,norm} from './model.js';
const chevron='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>';
const searchIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg>';
export function createLocationPicker({locations,current,onChange}){
 let panel=null,query='';
 const rows=()=>locations().slice().sort((a,b)=>a.name.localeCompare(b.name,'en-US',{sensitivity:'base'}));
 const selected=()=>current()==='all'?rows().map(l=>l.id):current()==='none'?[]:[current()];
 const anchor=()=>document.querySelector('[data-action="locations"]');
 function label(){const ids=selected();return ids.length===0?'No Locations':ids.length===rows().length?'All Locations':rows().find(l=>l.id===ids[0])?.name||'No Locations';}
 function trigger(){return `<button type="button" class="location-trigger" data-action="locations" aria-haspopup="dialog" aria-expanded="${!!panel}" aria-label="${e(label())}"><strong>${e(label())}</strong>${chevron}</button>`;}
 function position(){if(!panel||!anchor())return;const r=anchor().getBoundingClientRect(),v=window.visualViewport,left=v?.offsetLeft||0,top=v?.offsetTop||0,width=v?.width||innerWidth,height=v?.height||innerHeight;panel.style.maxHeight=`${height-24}px`;panel.style.left=`${Math.max(left+12,Math.min(r.right-panel.offsetWidth,left+width-panel.offsetWidth-12))}px`;panel.style.top=`${Math.max(top+12,Math.min(r.bottom+8,top+height-panel.offsetHeight-12))}px`;}
 function paintRows(){
  const ids=selected(),all=rows(),matches=all.filter(l=>norm(l.name).includes(norm(query))),every=all.length>0&&ids.length===all.length;
  panel.querySelector('.location-options').innerHTML=`<label class="location-option location-all"><span>${every?'Deselect all':'Select all'}</span><small aria-label="${ids.length} locations selected">${ids.length}</small><input type="checkbox" data-location-all aria-label="${every?'Deselect all':'Select all'}" ${every?'checked':''}></label><div class="location-list">${matches.map(l=>`<label class="location-option"><span>${e(l.name)}</span><input type="checkbox" data-location-id="${e(l.id)}" aria-label="${e(l.name)}" ${ids.includes(l.id)?'checked':''}></label>`).join('')||'<p class="location-no-results" role="status">No locations found.</p>'}</div>`;
  panel.querySelector('[data-location-all]').indeterminate=ids.length>0&&!every;position();
 }
 function close(restore=true){if(!panel)return;panel.remove();panel=null;document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',keydown,true);window.removeEventListener('resize',position);window.visualViewport?.removeEventListener('resize',position);window.visualViewport?.removeEventListener('scroll',position);window.removeEventListener('scroll',position,true);anchor()?.setAttribute('aria-expanded','false');if(restore)anchor()?.focus();}
 function outside(ev){if(!panel.contains(ev.target)&&!anchor()?.contains(ev.target))close(false);}
 function keydown(ev){if(ev.key==='Escape'){ev.preventDefault();ev.stopImmediatePropagation();close();}else if(ev.key==='Tab'){ev.stopImmediatePropagation();const els=[...panel.querySelectorAll('input')],first=els[0],last=els.at(-1);if(ev.shiftKey&&document.activeElement===first){ev.preventDefault();last.focus();}else if(!ev.shiftKey&&document.activeElement===last){ev.preventDefault();first.focus();}}}
 function open(){
  if(panel){close();return;}
  query='';panel=document.createElement('section');panel.className='location-popover';panel.setAttribute('role','dialog');panel.setAttribute('aria-label','Select locations');panel.setAttribute('aria-modal','true');
  panel.innerHTML=`<label class="location-search">${searchIcon}<input type="search" placeholder="Search…" aria-label="Search locations" autocomplete="off"></label><div class="location-options"></div>`;document.body.append(panel);anchor()?.setAttribute('aria-expanded','true');paintRows();
  panel.addEventListener('input',ev=>{if(ev.target.type==='search'){query=ev.target.value;paintRows();}});
  panel.addEventListener('change',ev=>{
   const input=ev.target;if(input.type!=='checkbox')return;const ids=new Set(selected());
   if(input.hasAttribute('data-location-all')){ids.clear();if(input.checked)rows().forEach(l=>ids.add(l.id));}else if(input.checked)ids.add(input.dataset.locationId);else ids.delete(input.dataset.locationId);
   // The workspace has two locations: both, either one, or no locations.
   const value=ids.size===rows().length?'all':ids.size?[...ids][0]:'none';
   const focusId=input.dataset.locationId;onChange(value);paintRows();
   const focus=focusId?[...panel.querySelectorAll('[data-location-id]')].find(el=>el.dataset.locationId===focusId):panel.querySelector('[data-location-all]');focus?.focus();
  });
  document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',keydown,true);window.addEventListener('resize',position);window.visualViewport?.addEventListener('resize',position);window.visualViewport?.addEventListener('scroll',position);window.addEventListener('scroll',position,true);panel.querySelector('input').focus();
 }
 return {trigger,open,close,get isOpen(){return !!panel;}};
}
