import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { periodSales } from '../src/model.js';
import { fullDayRange, inclusivePeriodDates, toLocalDateTime, parseLocalDateTime, validatePeriodRange, calculateSalesPeriod } from '../src/period-model.js';

const cents = value => Math.round(value * 100);
const fact = (id, occurredAt, netSales, locationId = 'a', quantity = 1) => ({ id, occurredAt, locationId, netSales, quantity, grossSales: netSales, discounts: 0, refunds: null, granularity: 'transaction' });
const data = facts => ({ locations: [{ id: 'a', name: 'Store A' }, { id: 'b', name: 'Store B' }], salesPeriods: { meta: { precision: 'transaction', coverageStart: '2026-01-01T05:00:00Z', coverageEndExclusive: '2027-01-01T05:00:00Z' }, facts } });

test('New York date-time parsing is explicit about timezone and independent from device timezone', () => {
  assert.equal(new Date(parseLocalDateTime('2026-10-04T12:30')).toISOString(), '2026-10-04T16:30:00.000Z');
  assert.equal(new Date(parseLocalDateTime('2026-01-04T12:30')).toISOString(), '2026-01-04T17:30:00.000Z');
  assert.equal(toLocalDateTime('2026-10-04T03:59:22Z'), '2026-10-03T23:59');
  assert.equal(toLocalDateTime('2026-10-04T04:00:00Z'), '2026-10-04T00:00');
  assert.equal(toLocalDateTime('2026-10-04T04:00:00Z', 'UTC'), '2026-10-04T04:00');
  assert.equal(toLocalDateTime(null), '');
  assert.equal(toLocalDateTime('invalid'), '');
});

test('date-time parsing rejects impossible dates, ambiguous fall hours and missing spring hours', () => {
  for (const value of ['2026-02-29T12:00', '2026-02-30T12:00', '2026-13-01T12:00', '2026-00-01T12:00', '2026-10-00T12:00', '2026-10-01T24:00', '2026-10-01T12:60', '2026-10-01', '2026-10-01T12:00:00', '2026-03-08T02:30', '2026-11-01T01:30', '', null]) {
    assert.ok(Number.isNaN(parseLocalDateTime(value)), String(value));
  }
  assert.ok(Number.isFinite(parseLocalDateTime('2024-02-29T12:00')));
  assert.equal(new Date(parseLocalDateTime('2026-03-08T03:00')).toISOString(), '2026-03-08T07:00:00.000Z');
  assert.equal(new Date(parseLocalDateTime('2026-11-01T02:00')).toISOString(), '2026-11-01T07:00:00.000Z');
});

test('range validation requires both real endpoints and a strictly positive interval', () => {
  assert.equal(validatePeriodRange({ start: '2026-10-01T12:00', end: '2026-10-01T13:00' }), null);
  for (const range of [{}, { start: '2026-10-01T12:00' }, { start: '2026-10-01T12:00', end: '2026-10-01T12:00' }, { start: '2026-10-01T13:00', end: '2026-10-01T12:00' }, { start: '2026-11-01T01:30', end: '2026-11-01T03:00' }]) {
    assert.equal(typeof validatePeriodRange(range), 'string');
    assert.throws(() => calculateSalesPeriod(data([]), 'all', range));
  }
});

test('transaction windows include the start and exclude the end, retaining seconds and credits', () => {
  const source = data([
    fact('before', '2026-10-02T15:59:59Z', 100),
    fact('start', '2026-10-02T16:00:00Z', 20),
    fact('last', '2026-10-02T16:59:59Z', -5, 'a', -1),
    fact('end', '2026-10-02T17:00:00Z', 200),
    fact('other-store', '2026-10-02T16:30:00Z', 50, 'b', 2),
  ]);
  const before = structuredClone(source);
  const result = calculateSalesPeriod(source, 'a', { start: '2026-10-02T12:00', end: '2026-10-02T13:00' });
  assert.equal(result.total, 15);
  assert.equal(result.quantity, 0);
  assert.equal(result.factCount, 2);
  assert.equal(result.previousTotal, 100);
  assert.equal(result.growth, -85);
  assert.equal(result.current[0].refunds, null);
  assert.equal(result.current[0].locationName, 'Store A');
  assert.equal(result.previous[0].locationName, 'Store A');
  assert.equal(result.range.endExclusive, true);
  assert.deepEqual(source, before);
  assert.equal(calculateSalesPeriod(source, 'all', { start: '2026-10-02T12:00', end: '2026-10-02T13:00' }).total, 65);
});

test('previous windows have the same elapsed duration across daylight saving changes', () => {
  const result = calculateSalesPeriod(data([]), 'all', { start: '2026-03-08T00:00', end: '2026-03-09T00:00' });
  assert.equal(result.range.startUtc, '2026-03-08T05:00:00.000Z');
  assert.equal(result.range.endUtc, '2026-03-09T04:00:00.000Z');
  assert.equal(result.range.previousStartUtc, '2026-03-07T06:00:00.000Z');
  assert.equal(result.range.previousEndUtc, result.range.startUtc);
  assert.equal(Date.parse(result.range.endUtc) - Date.parse(result.range.startUtc), Date.parse(result.range.previousEndUtc) - Date.parse(result.range.previousStartUtc));
});

test('daily fallback supports complete local days and refuses to estimate partial-day sales', () => {
  const source = { locations: [{ id: 'a', name: 'Store A' }], salesDaily: [
    { date: '2026-10-01', locationId: 'a', netSales: 50, quantity: 5, factCount: 4 },
    { date: '2026-10-02', locationId: 'a', netSales: 100, quantity: 10, factCount: 8 },
  ] };
  const result = calculateSalesPeriod(source, 'a', { start: '2026-10-02T00:00', end: '2026-10-03T00:00' });
  assert.equal(result.precision, 'day');
  assert.equal(result.total, 100);
  assert.equal(result.previousTotal, 50);
  assert.equal(result.growth, 100);
  assert.equal(result.current[0].locationName, 'Store A');
  assert.throws(() => calculateSalesPeriod(source, 'a', { start: '2026-10-02T08:00', end: '2026-10-02T17:00' }), /daily totals only/);
});

test('a daily source cannot fabricate the prior 23-hour comparison across spring DST', () => {
  const source = { salesDaily: [
    { date: '2026-03-07', locationId: 'a', netSales: 50 }, { date: '2026-03-08', locationId: 'a', netSales: 100 },
  ] };
  const result = calculateSalesPeriod(source, 'a', { start: '2026-03-08T00:00', end: '2026-03-09T00:00' });
  assert.equal(result.total, 100);
  assert.equal(result.growth, null);
  assert.deepEqual(result.previous, []);
  assert.match(result.coverageNotice, /daylight saving transition/);
});

test('inclusive date controls preserve last-minute sales and exclude next-day midnight',()=>{
  const range=fullDayRange('2026-10-03','2026-10-03');
  assert.deepEqual(range,{start:'2026-10-03T00:00',end:'2026-10-04T00:00'});
  assert.deepEqual(inclusivePeriodDates(range),{start:'2026-10-03',end:'2026-10-03'});
  const result=calculateSalesPeriod(data([fact('start','2026-10-03T04:00:00Z',1),fact('last','2026-10-04T03:59:59Z',2),fact('outside','2026-10-04T04:00:00Z',100)]),'a',range);
  assert.equal(result.total,3);assert.equal(result.factCount,2);
  assert.throws(()=>fullDayRange('2026-10-04','2026-10-03'));
  assert.throws(()=>fullDayRange('2026-02-30','2026-03-01'));
});
test('full-day date controls respect New York daylight-saving transitions',()=>{
  for(const [date,hours] of [['2026-03-08',23],['2026-11-01',25]]){
    const range=fullDayRange(date,date);assert.equal((parseLocalDateTime(range.end)-parseLocalDateTime(range.start))/3600000,hours);assert.equal(inclusivePeriodDates(range).end,date);
  }
});
