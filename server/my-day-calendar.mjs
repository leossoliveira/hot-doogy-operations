import {randomBytes,createHash} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {ApiError,jsonBody,reply} from './auth.mjs';
export function icloudURL(value){try{const u=new URL(String(value).replace(/^webcal:/,'https:'));if(u.protocol!=='https:'||!/^p\d+-caldav\.icloud\.com$/.test(u.hostname)||u.port||u.username||u.password||u.search||u.hash||!/^\/published\/[A-Za-z0-9/_-]+$/.test(u.pathname)||u.href.length>2048)throw Error();return u.href;}catch{throw new ApiError(400,'Use a published iCloud calendar link.');}}
const escapeICS=s=>String(s).replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
const fold=line=>{let output='',length=0;for(const char of line){const size=Buffer.byteLength(char);if(length+size>75){output+='\r\n ';length=1;}output+=char;length+=size;}return output;};
export function tasksICS(tasks){return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//HOT DOOGY//My Day//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH','X-WR-CALNAME:My Day · My tasks',...tasks.flatMap(t=>{const day=String(t.due_date).slice(0,10),d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+1);return ['BEGIN:VEVENT',`UID:${t.id}@my-day.hotdoogy.com`,`DTSTAMP:${new Date(t.updated_at).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'')}`,`DTSTART;VALUE=DATE:${day.replaceAll('-','')}`,`DTEND;VALUE=DATE:${d.toISOString().slice(0,10).replaceAll('-','')}`,`SUMMARY:${escapeICS(t.title)}`,`DESCRIPTION:${escapeICS('Task status: '+t.status)}`,'TRANSP:TRANSPARENT','END:VEVENT'];}),'END:VCALENDAR'].map(fold).join('\r\n')+'\r\n';}
export async function fetchCalendar(url,fetcher=fetch){
 let response;try{response=await fetcher(icloudURL(url),{redirect:'error',signal:AbortSignal.timeout(12000),headers:{Accept:'text/calendar'}});}catch{throw new ApiError(502,'Unable to reach iCloud. Try again.');}
 if(!response.ok||Number(response.headers.get('content-length')||0)>3*1024*1024)throw new ApiError(502,'iCloud calendar is unavailable or too large.');
 let size=0,chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>3*1024*1024){await response.body.cancel().catch(()=>{});throw new ApiError(413,'iCloud calendar is too large.');}chunks.push(chunk);}return Buffer.concat(chunks).toString('utf8');
}
export function expandCalendar(source,start,end){return new Promise((resolve,reject)=>{const worker=new Worker(new URL('./calendar-worker.mjs',import.meta.url),{workerData:{source,start,end},resourceLimits:{maxOldGenerationSizeMb:64}});const timer=setTimeout(()=>{worker.terminate();reject(new ApiError(502,'Unable to process this calendar.'));},5000);const finish=()=>{clearTimeout(timer);worker.terminate();};worker.once('message',m=>{finish();m.error?reject(new ApiError(502,'Unable to process this calendar.')):resolve(m.events);});worker.once('error',()=>{finish();reject(new ApiError(502,'Unable to process this calendar.'));});worker.once('exit',code=>{if(code!==0){clearTimeout(timer);reject(new ApiError(502,'Unable to process this calendar.'));}});});}
const snapshots=new Map();
export async function calendarAPI(req,res,url,auth,session){
 const rpc=(name,body={})=>auth.request('/rest/v1/rpc/'+name,{token:session.token,method:'POST',body});
 if(url.pathname==='/api/my-day/calendar'&&req.method==='GET'){const c=await rpc('my_day_calendar_config');return reply(res,200,{connected:!!c.icloud_url,feedEnabled:c.feed_enabled});}
 if(url.pathname==='/api/my-day/calendar'&&req.method==='POST'){
  const b=await jsonBody(req,4096);if(!['connect','disconnect','rotate','revoke'].includes(b.action))throw new ApiError(400,'Invalid calendar action.');
  const token=b.action==='rotate'?randomBytes(32).toString('hex'):null,value=b.action==='connect'?icloudURL(b.url):token?createHash('sha256').update(token).digest('hex'):null;
  if(b.action==='connect'){const source=await fetchCalendar(value);await expandCalendar(source,new Date().toISOString().slice(0,10),new Date().toISOString().slice(0,10));}
  await rpc('my_day_calendar_save',{p_action:b.action,p_value:value});snapshots.delete(session.user.id);
  return reply(res,200,{saved:true,...(token?{subscriptionURL:'webcal://management.hotdoogy.com/calendar/my-day/'+token+'.ics'}:{})});
 }
 if(url.pathname==='/api/my-day/calendar/events'&&req.method==='GET'){
  const month=url.searchParams.get('month');if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||'')||Number(month.slice(0,4))<2000||Number(month.slice(0,4))>2100)throw new ApiError(400,'Choose a calendar month.');
  const c=await rpc('my_day_calendar_config');if(!c.icloud_url)return reply(res,200,{events:[],connected:false});
  const cache=snapshots.get(session.user.id);let source;if(cache&&cache.url===c.icloud_url&&Date.now()-cache.at<300000)source=cache.source;else{source=await fetchCalendar(c.icloud_url);if(snapshots.size>100)snapshots.clear();snapshots.set(session.user.id,{url:c.icloud_url,source,at:Date.now()});}
  const a=new Date(month+'-01T12:00:00Z');a.setUTCDate(a.getUTCDate()-a.getUTCDay());const z=new Date(a);z.setUTCDate(z.getUTCDate()+41);
  return reply(res,200,{events:await expandCalendar(source,a.toISOString().slice(0,10),z.toISOString().slice(0,10)),connected:true,updatedAt:new Date().toISOString()});
 }
 throw new ApiError(404,'Calendar page not found.');
}
export async function serveTaskCalendar(req,res,url,auth){const match=url.pathname.match(/^\/calendar\/my-day\/([a-f0-9]{64})\.ics$/);if(!match||!['GET','HEAD'].includes(req.method))throw new ApiError(404,'Calendar not found.');const tasks=await auth.request('/rest/v1/rpc/my_day_calendar_feed',{method:'POST',body:{p_hash:createHash('sha256').update(match[1]).digest('hex')}});res.writeHead(200,{'Content-Type':'text/calendar; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(req.method==='HEAD'?'':tasksICS(tasks));}
