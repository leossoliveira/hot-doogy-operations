import test from 'node:test';import assert from 'node:assert/strict';
import {filterApplications,careersSummary,reviewPayload,availabilityDays,availabilityLines} from '../src/careers-model.js';
import {canViewRoute} from '../src/access.js';
import {careersAPI} from '../server/careers.mjs';
const rows=[
 {id:'a',first_name:'Ana',last_name:'Silva',email:'ana@example.com',phone:'1',city:'Natick',reference:'HD-AAAAAA',status:'new',position:'cook',any_location:false,preferred_location_id:'L1',created_at:'2026-10-15T12:00:00Z',updated_at:'2026-10-15T12:00:00Z',rating:null},
 {id:'b',first_name:'Bruno',last_name:'Costa',email:'bruno@example.com',phone:'2',city:'Framingham',reference:'HD-BBBBBB',status:'hired',position:'manager',any_location:true,preferred_location_id:null,created_at:'2026-09-01T12:00:00Z',updated_at:'2026-10-10T12:00:00Z',reviewed_at:'2026-10-10T12:00:00Z',rating:5},
 {id:'c',first_name:'Carla',last_name:'Dias',email:'carla@example.com',phone:'3',city:'Natick',reference:'HD-CCCCCC',status:'rejected',position:'cook',any_location:false,preferred_location_id:'L2',created_at:'2026-08-01T12:00:00Z',updated_at:'2026-08-02T12:00:00Z',rating:2},
];
test('open filter keeps active pipeline statuses; location filter includes "either location" candidates',()=>{
 assert.deepEqual(filterApplications(rows,{status:'open'}).map(x=>x.id),['a']);
 assert.deepEqual(filterApplications(rows,{status:'all',location:'L1'}).map(x=>x.id),['a','b']);
 assert.deepEqual(filterApplications(rows,{status:'all',position:'cook',query:'carla'}).map(x=>x.id),['c']);
 assert.deepEqual(filterApplications(rows,{status:'all',query:'hd-bbb'}).map(x=>x.id),['b']);
});
test('summary counts new, in-progress, hires in the last 30 days and the week intake',()=>{
 const s=careersSummary(rows,new Date('2026-10-16T12:00:00Z'));
 assert.deepEqual(s,{newCount:1,inProgress:0,hired30:1,receivedWeek:1,total:3});
});
test('review payload sends only changed fields and rejects empty or invalid edits',()=>{
 const current={status:'new',rating:null};
 assert.deepEqual(reviewPayload({id:'11111111-1111-1111-1111-111111111111',version:1,status:'reviewing',rating:4,note:' Call back Monday '},current),{id:'11111111-1111-1111-1111-111111111111',version:1,status:'reviewing',rating:4,note:'Call back Monday'});
 assert.throws(()=>reviewPayload({id:'11111111-1111-1111-1111-111111111111',version:1,status:'new'},current),/Nothing to save/);
 assert.throws(()=>reviewPayload({id:'11111111-1111-1111-1111-111111111111',version:1,rating:9},current),/between 1 and 5/);
 assert.throws(()=>reviewPayload({id:'bad',version:1,status:'hired'},current),/Invalid application/);
});
test('availability helpers keep weekday order',()=>{
 const av=[{day:'fri',from:'16:00',to:'22:00'},{day:'mon',from:'09:00',to:'15:00'}];
 assert.deepEqual(availabilityDays(av),['Mon','Fri']);
 assert.deepEqual(availabilityLines(av),['Monday 09:00–15:00','Friday 16:00–22:00']);
});
test('Careers route and API reject non-administrators before any private data request',async()=>{
 for(const role of ['staff','manager','chef']){
  assert.equal(canViewRoute(role,'hr-careers'),false);
  await assert.rejects(careersAPI({method:'GET'},{},new URL('http://x/api/hr/careers'),{request(){throw Error('must not be called');}},{member:{role},token:'t'}),/administrators only/);
 }
});
test('file download rejects paths outside the application folder',async()=>{
 const url=new URL('http://x/api/hr/careers/11111111-1111-1111-1111-111111111111/files/22222222-2222-2222-2222-222222222222');
 const auth={request:async()=>[{object_path:'other-org/11111111-1111-1111-1111-111111111111/resume-a.pdf',file_name:'r.pdf',mime_type:'application/pdf',size:10}]};
 await assert.rejects(careersAPI({method:'GET'},{},url,auth,{member:{role:'admin'},token:'t'},()=>{throw Error('storage must not be called');}),/File not found/);
});
test('Careers page renders stats, filters and candidate rows from the API response',async()=>{
 const {createCareers}=await import('../src/careers-ui.js');
 const payload={applications:rows.map(a=>({...a,state:'MA',hours_per_week:'flexible',availability:[{day:'mon',from:'09:00',to:'15:00'}]})),files:[],notes:[],events:[]};
 const originalFetch=globalThis.fetch;globalThis.fetch=async()=>({ok:true,json:async()=>payload});
 try{
  const ctx={state:()=>({route:'hr-careers',store:'all'}),data:()=>({locations:[{id:'L1',name:'Sherwood Plaza'},{id:'L2',name:'Natick Mall'}]}),session:()=>({role:'admin'}),render(){},heading:(a,b,c,d)=>`<h1>${b}</h1>${d}`,btn:(text,action)=>`<button data-action="${action}">${text}</button>`,notice:x=>`<p>${x}</p>`,empty:(a,b)=>`<div class="empty">${a}</div>`,openModal(){},close(){},toast(){},icon:()=>''};
  const ui=createCareers(ctx);
  assert.match(ui.page(),/Careers is ready|Loading applications/);
  await ui.actions['careers-refresh']();
  const html=ui.page();
  assert.match(html,/Ana Silva/);assert.match(html,/HD-AAAAAA/);assert.match(html,/class="status amber">New/);assert.doesNotMatch(html,/Carla Dias/,'rejected candidates stay out of the open pipeline');
  ui.changed({dataset:{careersFilter:'status'},value:'all'});
  assert.match(ui.page(),/Carla Dias/);assert.match(ui.page(),/Either location/);
 }finally{globalThis.fetch=originalFetch;}
});

test('overnight availability is shown on its starting day, including Saturday into Sunday',()=>{
 assert.deepEqual(availabilityLines([{day:'sat',from:'23:00',to:'04:00'},{day:'mon',from:'11:00',to:'04:00'}]),['Monday 11:00–04:00 (next day)','Saturday 23:00–04:00 (next day)']);
});
