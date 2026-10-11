import test from 'node:test';
import assert from 'node:assert/strict';
import {compactDateLabel,calendarDate,calendarDays,monthDate,addDays,storeToday,displayDate,presetRange,selectCalendarDate} from '../src/date-picker-model.js';
import {fullDayRange,inclusivePeriodDates,parseLocalDateTime} from '../src/period-model.js';

test('presets respect Sunday-start weeks and completed prior periods',()=>{
 const today='2026-10-05';
 const expected={today:['2026-10-05','2026-10-05'],yesterday:['2026-10-04','2026-10-04'],'this-week':['2026-10-04','2026-10-05'],'last-week':['2026-09-27','2026-10-03'],'this-month':['2026-10-01','2026-10-05'],'last-month':['2026-09-01','2026-09-30'],'this-year':['2026-01-01','2026-10-05'],'last-year':['2025-01-01','2025-12-31']};
 for(const [key,[start,end]] of Object.entries(expected))assert.deepEqual(presetRange(key,today),{start,end});
 assert.deepEqual(presetRange('last-month','2024-03-01'),{start:'2024-02-01',end:'2024-02-29'});
 assert.deepEqual(presetRange('last-month','2026-01-01'),{start:'2025-12-01',end:'2025-12-31'});
 assert.deepEqual(presetRange('this-week','2026-10-04'),{start:'2026-10-04',end:'2026-10-04'});
});
test('calendar validates dates, rolls across year boundaries, and formats US dates',()=>{
 assert.equal(calendarDate('2026-02-29'),null);assert.ok(calendarDate('2024-02-29'));
 assert.equal(monthDate(2026,-1),'2025-12-01');assert.equal(monthDate(2026,12),'2027-01-01');
 assert.equal(addDays('2024-02-28',1),'2024-02-29');assert.equal(displayDate('2026-10-05'),'10/05/2026');assert.equal(displayDate(''),'mm/dd/yyyy');
 const days=calendarDays(2024,1);assert.equal(days[0],'2024-01-28');assert.equal(days.at(-1),'2024-03-09');assert.equal(new Set(days).size,42);assert.ok(days.includes('2024-02-29'));
});
test('today uses New York even when UTC and local dates differ',()=>{
 assert.equal(storeToday(new Date('2026-10-05T03:59:00Z')),'2026-10-04');
 assert.equal(storeToday(new Date('2026-10-05T04:00:00Z')),'2026-10-05');
});
test('single dates, same-day periods, reverse and cross-month selections',()=>{
 let s=selectCalendarDate({mode:'range',edge:'start',start:'',end:''},'2026-10-05');assert.equal(s.end,'');assert.equal(s.edge,'end');
 s=selectCalendarDate(s,'2026-09-29');assert.equal(s.start,'2026-09-29');assert.equal(s.end,'2026-10-05');
 s=selectCalendarDate(s,'2026-10-01');assert.equal(s.end,'');
 s=selectCalendarDate(s,'2026-10-01');assert.equal(s.start,s.end);
 s=selectCalendarDate({...s,mode:'single'},'2026-12-31');assert.equal(s.start,'2026-12-31');assert.equal(s.end,s.start);
});
test('selected dates retain inclusive full days across daylight saving changes',()=>{
 for(const [date,hours] of [['2026-03-08',23],['2026-11-01',25]]){
  const selected=selectCalendarDate({mode:'single'},date),range=fullDayRange(selected.start,selected.end);
  assert.equal((parseLocalDateTime(range.end)-parseLocalDateTime(range.start))/3600000,hours);
  assert.deepEqual(inclusivePeriodDates(range),{start:date,end:date});
 }
});

test('compact date selections always include a four-digit year',()=>{
 assert.equal(compactDateLabel('2026-10-05','2026-10-05'),'10/05/2026');
 assert.equal(compactDateLabel('2025-12-31','2026-01-02'),'12/31/2025 – 01/02/2026');
});
