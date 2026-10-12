import test from 'node:test';import assert from 'node:assert/strict';
import {filterTasks,monthCells,shiftMonth,recurringDates} from '../src/my-day-model.js';
import {effectiveProfile,routeModule} from '../src/permission-profiles.js';
import {requireStaffRequest} from '../server/staff-access.mjs';
import {requireProfileRequest} from '../server/permission-profiles.mjs';
test('task filters combine period, location, status, priority and assignees',()=>{const rows=[{title:'B',due_date:'2026-10-12',location_id:'a',assignee_id:'one',priority:'high',status:'todo'},{title:'A',due_date:'2026-10-10',location_id:'a',assignee_id:'two',priority:'normal',status:'done'}];assert.deepEqual(filterTasks(rows,{from:'2026-10-12',to:'2026-10-12',location:'a',assignees:['one','two'],priority:'high',status:'todo'}),[rows[0]]);assert.equal(filterTasks(rows,{location:'b'}).length,0);assert.equal(filterTasks(rows)[0].title,'A');});
test('staff can read My Day and post status but cannot save task definitions',()=>{assert.doesNotThrow(()=>requireStaffRequest('staff','GET','/api/my-day'));assert.doesNotThrow(()=>requireStaffRequest('staff','POST','/api/my-day/status'));assert.throws(()=>requireStaffRequest('staff','POST','/api/my-day/save'));});
test('My Day permission overrides apply to every subroute and API',()=>{assert.equal(routeModule('my-day-procedures'),'my-day');const profile=effectiveProfile('staff',{'my-day':{view:true,write:false}});assert.doesNotThrow(()=>requireProfileRequest(profile,'GET','/api/my-day'));assert.throws(()=>requireProfileRequest(profile,'POST','/api/my-day/status'));});

test('board and procedure detail render persisted content as escaped text',async()=>{
 const {createMyDay}=await import('../src/my-day-ui.js');const oldFetch=globalThis.fetch;
 const task={id:'task-1',title:'<img src=x onerror=alert(1)>',description:'Instructions',status:'todo',priority:'urgent',due_date:'2026-10-12',location_id:'loc',assignee_id:'person',version:1};
 globalThis.fetch=async()=>({ok:true,json:async()=>({tasks:[task],team:[{id:'person',first_name:'Alice',last_name:'Cook',status:'active',location_ids:['loc']}],procedures:[{id:'proc-1',title:'<script>bad</script>',steps:'First step\nSecond step',purpose:'Purpose',verification:'Check',status:'published',location_id:'loc',updated_at:'2026-10-12'}]})});
 const oldDocument=globalThis.document;globalThis.document={querySelector:()=>null,addEventListener(){}};let route='my-day',modal;const ui=createMyDay({state:()=>({route,store:'all'}),session:()=>({role:'owner'}),data:()=>({locations:[{id:'loc',name:'Kitchen'}]}),render(){},heading:()=>'',btn:(text)=>text,icon:()=>'',notice:x=>x,empty:x=>x,openModal:(...args)=>modal=args});
 try{await ui.actions['my-day-refresh']();const html=ui.page();assert.match(html,/Alice Cook/);assert.match(html,/&lt;img/);assert.ok(!html.includes('<img src=x'));ui.actions['my-day-task']({dataset:{id:'task-1'}});assert.match(modal[0],/^&lt;img/);ui.actions['my-day-procedure']({dataset:{id:'proc-1'}});assert.equal(modal[0],'&lt;script&gt;bad&lt;/script&gt;');assert.match(modal[1],/<li>First step<\/li><li>Second step<\/li>/);route='my-day-tasks';assert.match(ui.page(),/TASK/);}finally{globalThis.fetch=oldFetch;globalThis.document=oldDocument;}
});

test('calendar weeks and recurring dates stay stable across months and daylight saving',()=>{assert.equal(monthCells('2026-02').length,28);assert.equal(monthCells('2026-10')[0],'2026-09-27');assert.equal(shiftMonth('2026-12',1),'2027-01');assert.deepEqual(recurringDates('2028-01-31','2028-04-30','monthly'),['2028-01-31','2028-02-29','2028-03-31','2028-04-30']);assert.deepEqual(recurringDates('2026-10-09','2026-10-13','weekdays'),['2026-10-09','2026-10-12','2026-10-13']);assert.deepEqual(recurringDates('2026-03-07','2026-03-09','daily'),['2026-03-07','2026-03-08','2026-03-09']);assert.equal(recurringDates('2026-01-01','2028-01-01','daily').length,0);});

test('dragging a card persists destination status with its version, and failures keep the old status',async()=>{
 const {createMyDay}=await import('../src/my-day-ui.js');const oldFetch=globalThis.fetch,oldDocument=globalThis.document;
 const handlers={},requests=[],messages=[];let reject=false;
 const task={id:'00000000-0000-0000-0000-000000000001',title:'Task',status:'todo',priority:'normal',due_date:'2026-10-12',location_id:'loc',assignee_id:'person',version:4};
 globalThis.document={addEventListener:(name,fn)=>handlers[name]=fn,querySelector:()=>null,querySelectorAll:()=>[]};
 globalThis.fetch=async(url,options)=>{if(options?.method==='POST'){requests.push(JSON.parse(options.body));if(reject)return {ok:false,status:409,json:async()=>({error:'Record changed'})};task.status=requests.at(-1).payload.status;task.version++;return {ok:true,json:async()=>({})};}return {ok:true,json:async()=>({tasks:[{...task}],procedures:[],team:[]})};};
 const ui=createMyDay({state:()=>({route:'my-day',store:'all'}),session:()=>({role:'owner'}),data:()=>({locations:[]}),render(){},heading:()=>'',btn:x=>x,icon:()=>'',notice:x=>x,empty:x=>x,toast:x=>messages.push(x)});
 const card={dataset:{dayCard:task.id},classList:{add(){}}},column={dataset:{dayColumn:'doing'},classList:{add(){}}};
 const start=()=>handlers.dragstart({target:{closest:selector=>selector==='[data-day-card]'?card:null},dataTransfer:{setData(){}},preventDefault(){}});
 const drop=()=>handlers.drop({target:{closest:()=>column},preventDefault(){}});
 try{await ui.actions['my-day-refresh']();start();drop();await new Promise(r=>setTimeout(r,10));assert.equal(requests.length,1);assert.deepEqual(requests[0],{id:task.id,version:4,payload:{status:'doing'}});assert.equal(task.status,'doing');
 reject=true;column.dataset.dayColumn='done';start();drop();await new Promise(r=>setTimeout(r,10));assert.equal(task.status,'doing');assert.ok(messages.some(x=>/Record changed/.test(x)));
 }finally{globalThis.fetch=oldFetch;globalThis.document=oldDocument;}
});
