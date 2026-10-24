import {MONTHS,PRESETS,compactDateLabel,calendarDate,addDays,storeToday,displayDate,monthDate,calendarDays,presetRange,selectCalendarDate} from './date-picker-model.js';
import {escape as e} from './model.js';
export function dateTriggerContent(start,end=start,time=''){
 return `<span class="hd-date-caption">Date</span>${start||end?`<span class="hd-date-value">${e(compactDateLabel(start,end))}${time?` · ${e(time)}`:''}</span>`:''}<svg class="hd-date-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>`;
}
const arrow=direction=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="${direction==='left'?'m14 6-6 6 6 6':'m10 6 6 6-6 6'}"/></svg>`;
let active=null;
export const isDatePickerOpen=()=>!!active;
const enhanced=new WeakMap();
export function closeDatePicker(restore=true){if(!active)return;const {panel,anchor,cleanup}=active;active=null;cleanup();panel.remove();anchor?.setAttribute('aria-expanded','false');if(restore&&anchor?.isConnected)anchor.focus();}
export function openDatePicker({anchor,start='',end='',range=false,time=null,edge='start',onApply,onClear}){
 closeDatePicker(false);
 const today=storeToday(),initial=calendarDate(start)?start:calendarDate(end)?end:today;
 let selected={start,end:range?end:start,mode:range&&(!start||start!==end)?'range':'single',edge};
 let cursor=initial,year=Number(initial.slice(0,4)),month=Number(initial.slice(5,7))-1,view='days',yearPage=year,preset='custom';
 const panel=document.createElement('section');panel.className='hd-calendar';panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label',range?'Choose a date or date range':'Choose a date');document.body.append(panel);anchor?.setAttribute('aria-expanded','true');
 function position(){const r=anchor?.getBoundingClientRect();if(!r)return;const v=window.visualViewport,margin=12,left=v?.offsetLeft||0,top=v?.offsetTop||0,width=v?.width||innerWidth,height=v?.height||innerHeight;panel.style.maxHeight=`${height-2*margin}px`;const w=panel.offsetWidth,h=panel.offsetHeight;panel.style.left=`${Math.max(left+margin,Math.min(r.left,left+width-w-margin))}px`;panel.style.top=`${Math.max(top+margin,Math.min(r.bottom+8,top+height-h-margin))}px`;}
 function button(label,action,extra='',cls=''){return `<button type="button" class="${cls}" data-cal="${action}" ${extra}>${label}</button>`;}
 function paint(focus){
  panel.innerHTML=`<nav class="hd-calendar-presets" aria-label="Quick dates">${PRESETS.filter(([id])=>range||['today','yesterday'].includes(id)).map(([id,label])=>button(label,'preset',`data-value="${id}" aria-pressed="${preset===id}"`,preset===id?'active':'')).join('')}${button('Custom','custom',`aria-pressed="${preset==='custom'}"`,preset==='custom'?'active':'')}</nav><div class="hd-calendar-main"><header class="hd-calendar-header">${view==='days'?button(arrow('left'),'prev','aria-label="Previous month"','hd-calendar-arrow'):''}${button(`${MONTHS[month]} ${year} <span aria-hidden="true">${view==='days'?'⌄':'⌃'}</span>`,'view',`aria-label="Choose month and year" aria-expanded="${view==='months'}"`,'hd-calendar-title')}${view==='days'?button(arrow('right'),'next','aria-label="Next month"','hd-calendar-arrow'):''}</header>${range?`<div class="hd-calendar-modes" aria-label="Selection mode">${button('Single date','mode','data-value="single" aria-pressed="'+(selected.mode==='single')+'"')}${button('Date range','mode','data-value="range" aria-pressed="'+(selected.mode==='range')+'"')}</div>`:''}${view==='months'?`<div class="hd-calendar-years">${button(arrow('left'),'years-back','aria-label="Previous years"')}${[yearPage-1,yearPage,yearPage+1].map(y=>button(y,'year',`data-value="${y}" aria-pressed="${y===year}"`)).join('')}${button(arrow('right'),'years-next','aria-label="Next years"')}</div><div class="hd-calendar-months">${MONTHS.map((m,i)=>button(m,'month',`data-value="${i}" aria-pressed="${i===month}"`)).join('')}</div>`:`<div class="hd-calendar-weekdays" aria-hidden="true">${['Su','Mo','Tu','We','Th','Fr','Sa'].map(d=>`<span>${d}</span>`).join('')}</div><div class="hd-calendar-days" role="group" aria-label="${MONTHS[month]} ${year}">${calendarDays(year,month).map(value=>{const chosen=value===selected.start||value===selected.end,inside=selected.start&&selected.end&&value>selected.start&&value<selected.end;return button(Number(value.slice(-2)),'day',`data-value="${value}" aria-label="${new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'2-digit',day:'2-digit',year:'numeric'}).format(calendarDate(value))}" aria-pressed="${!!chosen}" ${value===today?'aria-current="date"':''} tabindex="${value===cursor?'0':'-1'}"`,`${Number(value.slice(5,7))-1!==month?'outside ':''}${chosen?'selected ':''}${inside?'in-range ':''}${value===today?'today':''}`);}).join('')}</div>`}<div class="hd-calendar-selection">${range&&selected.mode==='range'?`${button(`<small>Start date</small>${displayDate(selected.start)}`,'edge','data-value="start" aria-pressed="'+(selected.edge==='start')+'"')}${button(`<small>End date (inclusive)</small>${displayDate(selected.end)}`,'edge','data-value="end" aria-pressed="'+(selected.edge==='end')+'"')}`:`<span><small>Selected date</small>${displayDate(selected.start)}</span>`}</div>${time!==null?`<label class="hd-calendar-time">Time (New York)<input type="time" aria-label="Time (New York)" value="${e(time)}" required></label>`:''}<p class="hd-calendar-hint" role="status">${selected.mode==='range'&&selected.start&&!selected.end?'Choose an end date.':range?'Dates include the full day · New York time':'Choose a date, then apply.'}</p><p class="hd-calendar-error" role="alert"></p><footer>${onClear?button('Clear','clear','','hd-calendar-clear'):''}${button('Cancel','cancel')}${button('Apply','apply',selected.start&&selected.end?'':'disabled','hd-calendar-apply')}</footer></div>`;
  position();if(focus)panel.querySelector(focus)?.focus();
 }
 function moveMonth(delta){const d=calendarDate(monthDate(year,month+delta));year=d.getUTCFullYear();month=d.getUTCMonth();cursor=monthDate(year,month);}
 panel.addEventListener('input',ev=>{if(ev.target.type==='time')time=ev.target.value;});
 panel.addEventListener('click',ev=>{
  const target=ev.target.closest('[data-cal]');if(!target)return;const action=target.dataset.cal,value=target.dataset.value;
  if(action==='cancel'){closeDatePicker();return;}
  if(action==='clear'){closeDatePicker();onClear?.();return;}
  if(action==='apply'){
   if(!selected.start||!selected.end)return;
   if(time!==null&&!/^\d{2}:\d{2}$/.test(time)){panel.querySelector('.hd-calendar-error').textContent='Choose a valid time.';return;}
   try{onApply({start:selected.start,end:selected.end,time});closeDatePicker();}catch(error){panel.querySelector('.hd-calendar-error').textContent=error.message;}return;
  }
  if(action==='prev'||action==='next')moveMonth(action==='prev'?-1:1);
  if(action==='view'){view=view==='days'?'months':'days';yearPage=year;if(view==='days')cursor=monthDate(year,month);}
  if(action==='years-back')yearPage-=3;if(action==='years-next')yearPage+=3;
  if(action==='year')year=Number(value);
  if(action==='month'){month=Number(value);view='days';cursor=monthDate(year,month);}
  if(action==='mode'){selected.mode=value;selected.edge='start';if(value==='single')selected.end=selected.start;preset='custom';}
  if(action==='edge'){selected.edge=value;preset='custom';}
  if(action==='custom'){preset='custom';view='days';}
  if(action==='preset'){const p=presetRange(value,today);selected={...p,mode:p.start===p.end?'single':'range',edge:'start'};preset=value;year=Number(p.start.slice(0,4));month=Number(p.start.slice(5,7))-1;cursor=p.start;view='days';}
  if(action==='day'){selected=selectCalendarDate(selected,value);preset='custom';cursor=value;year=Number(value.slice(0,4));month=Number(value.slice(5,7))-1;}
  paint(action==='day'?`[data-cal="day"][data-value="${value}"]`:action==='month'?'[data-cal="view"]':`[data-cal="${action}"]${value?`[data-value="${value}"]`:''}`);
 });
 function keydown(ev){
  if(!active)return;
  if(ev.key==='Escape'){ev.preventDefault();ev.stopImmediatePropagation();closeDatePicker();return;}
  if(ev.key==='Tab'){ev.stopImmediatePropagation();const all=[...panel.querySelectorAll('button:not(:disabled):not([tabindex="-1"]),input')],first=all[0],last=all.at(-1);if(ev.shiftKey&&document.activeElement===first){ev.preventDefault();last.focus();}else if(!ev.shiftKey&&document.activeElement===last){ev.preventDefault();first.focus();}return;}
  const day=ev.target.closest('[data-cal="day"]');if(!day)return;
  const offsets={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7,Home:-calendarDate(day.dataset.value).getUTCDay(),End:6-calendarDate(day.dataset.value).getUTCDay()};
  if(ev.key in offsets)cursor=addDays(day.dataset.value,offsets[ev.key]);else if(['PageUp','PageDown'].includes(ev.key))moveMonth(ev.key==='PageUp'?-1:1);else return;
  ev.preventDefault();ev.stopImmediatePropagation();year=Number(cursor.slice(0,4));month=Number(cursor.slice(5,7))-1;paint(`[data-cal="day"][data-value="${cursor}"]`);
 }
 function outside(ev){if(!panel.contains(ev.target)&&!anchor?.contains(ev.target))closeDatePicker(false);}
 document.addEventListener('keydown',keydown,true);document.addEventListener('pointerdown',outside,true);window.addEventListener('resize',position);window.visualViewport?.addEventListener('resize',position);window.visualViewport?.addEventListener('scroll',position);window.addEventListener('scroll',position,true);
 active={panel,anchor,cleanup(){document.removeEventListener('keydown',keydown,true);document.removeEventListener('pointerdown',outside,true);window.removeEventListener('resize',position);window.visualViewport?.removeEventListener('resize',position);window.visualViewport?.removeEventListener('scroll',position);window.removeEventListener('scroll',position,true);}};
 paint('[data-cal="view"]');
}
export function enhanceDateInputs(root=document){
 if(active&&!active.anchor?.isConnected)closeDatePicker(false);
 for(const source of root.querySelectorAll('input[type="date"],input[type="datetime-local"]')){
  if(enhanced.has(source)){enhanced.get(source)();continue;}
  // A paired end date shares the start date's only visible trigger.
  if(source.dataset.dateStart)continue;
  const end=source.dataset.dateEnd?document.querySelector(source.dataset.dateEnd):null;
  const fields=end?[source,end]:[source];
  const label=source.dataset.dateCaption||(end?'Date':source.labels?.[0]?.textContent.trim()||source.getAttribute('aria-label')||'Date');
  const wrapper=document.createElement('span');wrapper.className='hd-date-field';source.before(wrapper);fields.forEach(input=>wrapper.append(input));
  const trigger=document.createElement('button');trigger.type='button';trigger.className='hd-date-trigger';trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-expanded','false');wrapper.append(trigger);
  function sync(){
   const time=source.type==='datetime-local'&&source.value?new Intl.DateTimeFormat('en-US',{timeZone:'UTC',hour:'numeric',minute:'2-digit'}).format(new Date(source.value+'Z')):'';
   const summary=compactDateLabel(source.value.slice(0,10),end?end.value:source.value.slice(0,10));
   trigger.innerHTML=dateTriggerContent(source.value.slice(0,10),end?end.value:source.value.slice(0,10),time);
   if(source.dataset.dateCaption)trigger.querySelector('.hd-date-caption').textContent=source.dataset.dateCaption;
   trigger.setAttribute('aria-label',`${label}${fields.some(input=>input.value)?`: ${summary}${time?' '+time:''}`:''}`);
   trigger.classList.toggle('empty',!fields.some(input=>input.value));trigger.disabled=fields.some(input=>input.disabled);
  }
  function open(){
   const update=values=>{fields.forEach((input,i)=>{input.value=values[i];});sync();fields.forEach(input=>input.dispatchEvent(new Event('input',{bubbles:true})));fields.forEach(input=>input.dispatchEvent(new Event('change',{bubbles:true})));};
   openDatePicker({anchor:trigger,start:source.value.slice(0,10),end:end?.value,range:!!end,time:source.type==='datetime-local'?(source.value.slice(11,16)||'12:00'):null,
    onApply:({start:a,end:b,time})=>{const values=end?[a,b]:[time!==null?`${a}T${time}`:a];for(let i=0;i<fields.length;i++){if(fields[i].min&&values[i]<fields[i].min||fields[i].max&&values[i]>fields[i].max)throw new Error('Choose a date within the allowed range.');}update(values);},
    onClear:fields.some(x=>x.required)?null:()=>update(fields.map(()=>''))});
  }
  trigger.addEventListener('click',open);
  for(const input of fields){input.classList.add('hd-date-source');input.tabIndex=-1;input.setAttribute('aria-hidden','true');input.addEventListener('focus',open);input.addEventListener('input',sync);input.addEventListener('change',sync);enhanced.set(input,sync);}
  sync();
 }
}
