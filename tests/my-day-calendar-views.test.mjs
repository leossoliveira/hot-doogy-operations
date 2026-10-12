import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarDays,navigateCalendar,taskOnDay,renderCalendar} from '../src/my-day-calendar-view.js';
import {tasksICS} from '../server/my-day-calendar.mjs';
test('calendar navigation handles leap years, month ends and crossing weeks',()=>{
 assert.equal(calendarDays('2028-06-15','year').length,366);
 assert.deepEqual(calendarDays('2026-11-01','week'),['2026-11-01','2026-11-02','2026-11-03','2026-11-04','2026-11-05','2026-11-06','2026-11-07']);
 assert.equal(navigateCalendar('2028-02-29','year',1),'2029-02-28');
 assert.equal(navigateCalendar('2026-01-31','month',1),'2026-02-28');
 assert.equal(navigateCalendar('2026-12-31','day',1),'2027-01-01');
});
test('multi-day schedules include overlapping days but exclude midnight end',()=>{
 const task={starts_at:'2026-10-12T23:00:00',ends_at:'2026-10-14T00:00:00',due_date:'2026-10-15'};
 assert.ok(taskOnDay(task,'2026-10-12'));assert.ok(taskOnDay(task,'2026-10-13'));assert.equal(taskOnDay(task,'2026-10-14'),false);assert.equal(taskOnDay(task,'2026-10-15'),false);
 assert.ok(taskOnDay({due_date:'2026-10-15'},'2026-10-15'));
});
test('all views render events and year exposes day navigation without unsafe titles',()=>{
 const options={rows:[{id:'one',title:'<script>bad</script>',status:'todo',due_date:'2026-10-12'}],events:[],day:'2026-10-12',today:'2026-10-12',person:()=>'<unsafe>',button:(label)=>label,error:''};
 for(const view of ['day','week','month']){const html=renderCalendar({...options,view});assert.match(html,/&lt;script&gt;/);assert.ok(!html.includes('<script>'));}
 const year=renderCalendar({...options,view:'year'});assert.match(year,/data-day="2026-10-12"/);assert.match(year,/has-events/);
});
test('task subscription preserves UTC start and end while legacy tasks stay all day',()=>{
 const task={id:'one',title:'Task',status:'todo',due_date:'2026-10-12',updated_at:'2026-10-12T00:00:00Z',starts_at:'2026-10-12T13:00:00+00:00',ends_at:'2026-10-12T14:30:00+00:00'};
 assert.match(tasksICS([task]),/DTSTART:20261012T130000Z\r\nDTEND:20261012T143000Z/);
 assert.match(tasksICS([{...task,starts_at:null,ends_at:null}]),/DTSTART;VALUE=DATE:20261012/);
});
