import {parentPort,workerData} from 'node:worker_threads';
import ICAL from './vendor/ical/ical.js';
export function calendarEvents(source,start,end){
 const root=new ICAL.Component(ICAL.parse(source));if(root.name!=='vcalendar')throw Error('Invalid calendar');
 for(const zone of root.getAllSubcomponents('vtimezone'))ICAL.TimezoneService.register(zone.getFirstPropertyValue('tzid'),new ICAL.Timezone(zone));
 const components=root.getAllSubcomponents('vevent'),events=[],exceptions=new Map();if(components.length>5000)throw Error('Calendar is too large');
 for(const c of components){if(c.hasProperty('recurrence-id')){const uid=c.getFirstPropertyValue('uid');if(!exceptions.has(uid))exceptions.set(uid,[]);exceptions.get(uid).push(c);}}
 let iterations=0;const dayFormat=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
 const day=d=>dayFormat.format(d);
 for(const c of components){if(c.hasProperty('recurrence-id')||!c.hasProperty('dtstart')||c.getFirstPropertyValue('status')==='CANCELLED')continue;
  const event=new ICAL.Event(c);for(const ex of exceptions.get(event.uid)||[])event.relateException(new ICAL.Event(ex));
  const iterator=event.iterator();let next;
  while((next=iterator.next())){if(++iterations>60000)throw Error('Calendar recurrence is too large');const details=event.getOccurrenceDetails(next),item=details.item;
   const allDay=details.startDate.isDate,begin=details.startDate.toJSDate(),finish=details.endDate.toJSDate(),first=allDay?details.startDate.toString().slice(0,10):day(begin),last=allDay?details.endDate.toString().slice(0,10):day(new Date(Math.max(begin.getTime(),finish.getTime()-1)));
   if(first>end)break;if(last<start||item.component.getFirstPropertyValue('status')==='CANCELLED')continue;
   let display=first<start?start:first,limit=allDay?last:last+'x';
   for(let days=0;display<=end&&display<limit&&days<370;days++){
    events.push({id:`${event.uid}:${next}:${display}`,title:String(item.summary||'iCloud event').slice(0,300),day:display,start:begin.toISOString(),end:finish.toISOString(),allDay});if(events.length>1500)throw Error('Too many calendar events');
    const d=new Date(display+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+1);display=d.toISOString().slice(0,10);
   }
   if(!event.isRecurring())break;
  }
 }
 return events.sort((a,b)=>a.start.localeCompare(b.start));
}
if(parentPort){try{parentPort.postMessage({events:calendarEvents(workerData.source,workerData.start,workerData.end)});}catch{parentPort.postMessage({error:true});}}
