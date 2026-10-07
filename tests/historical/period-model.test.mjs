import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { periodSales } from '../../src/model.js';
import { fullDayRange, inclusivePeriodDates, toLocalDateTime, parseLocalDateTime, validatePeriodRange, calculateSalesPeriod } from '../../src/period-model.js';

const cents = value => Math.round(value * 100);
const fact = (id, occurredAt, netSales, locationId = 'a', quantity = 1) => ({ id, occurredAt, locationId, netSales, quantity, grossSales: netSales, discounts: 0, refunds: null, granularity: 'transaction' });
const data = facts => ({ locations: [{ id: 'a', name: 'Store A' }, { id: 'b', name: 'Store B' }], salesPeriods: { meta: { precision: 'transaction', coverageStart: '2026-01-01T05:00:00Z', coverageEndExclusive: '2027-01-01T05:00:00Z' }, facts } });

const snapshot = JSON.parse(await readFile(new URL('../../public/data/snapshot.json', import.meta.url), 'utf8'));
const salesPeriods = JSON.parse(await readFile(new URL('../../public/data/sales-periods.json', import.meta.url), 'utf8'));
const realData = { ...snapshot, salesPeriods };
test('a negative or zero previous total cannot produce a misleading positive growth percentage', () => {
  const source = data([fact('previous', '2026-10-02T15:30:00Z', -3), fact('current', '2026-10-02T16:30:00Z', -6.5)]);
  const range = { start: '2026-10-02T12:00', end: '2026-10-02T13:00' };
  const result = calculateSalesPeriod(source, 'a', range);
  assert.equal(result.total, -6.5);
  assert.equal(result.previousTotal, -3);
  assert.equal(result.currentComplete, true);
  assert.equal(result.previousComplete, true);
  assert.equal(result.growth, null);
  assert.match(result.coverageNotice, /Percentage change is unavailable because the previous period has negative net sales\./);
  source.salesPeriods.facts[0].netSales = 0;
  assert.equal(calculateSalesPeriod(source, 'a', range).growth, null);
  source.salesPeriods.facts[0].netSales = 10;
  assert.equal(calculateSalesPeriod(source, 'a', range).growth, -165);
});

test('batch coverage detects gaps per store and suppresses incomplete comparisons', () => {
  const source = data([fact('a', '2026-10-02T16:00:00Z', 20)]);
  source.salesPeriods.batches = [
    { locationId: 'a', periodStart: '2026-10-02T15:00:00Z', periodEnd: '2026-10-02T17:00:00Z' },
    { locationId: 'b', periodStart: '2026-10-02T15:00:00Z', periodEnd: '2026-10-02T16:30:00Z' },
  ];
  const result = calculateSalesPeriod(source, 'all', { start: '2026-10-02T12:00', end: '2026-10-02T13:00' });
  assert.equal(result.total, 20);
  assert.equal(result.currentComplete, false);
  assert.equal(result.previousComplete, true);
  assert.equal(result.growth, null);
  assert.match(result.coverageNotice, /do not cover the full selected period/);
  assert.equal(calculateSalesPeriod(source, 'a', { start: '2026-10-02T12:00', end: '2026-10-02T13:00' }).currentComplete, true);
});

test('transaction dates and location labels remain correct around local midnight', () => {
  const source = data([fact('last', '2026-10-02T03:59:59Z', 10), fact('first', '2026-10-02T04:00:00Z', 20)]);
  const result = calculateSalesPeriod(source, 'a', { start: '2026-10-01T23:00', end: '2026-10-02T01:00' });
  assert.deepEqual(result.dates, ['2026-10-01', '2026-10-02']);
  assert.deepEqual(result.current.map(row => [row.date, row.netSales, row.locationName]), [['2026-10-01', 10, 'Store A'], ['2026-10-02', 20, 'Store A']]);
  delete source.locations;
  source.salesPeriods.facts.forEach(row => { row.locationName = 'Source store label'; });
  assert.ok(calculateSalesPeriod(source, 'a', { start: '2026-10-01T23:00', end: '2026-10-02T01:00' }).current.every(row => row.locationName === 'Source store label'));
});

test('every real source timestamp was verified and all 56 daily snapshot totals reconcile', () => {
  assert.equal(salesPeriods.facts.length, 10504);
  assert.equal(new Set(salesPeriods.facts.map(fact => fact.id)).size, 10504);
  assert.equal(salesPeriods.meta.validation.sourceRawTimestampMatches, 10504);
  assert.equal(salesPeriods.meta.validation.normalizedTimestampMatches, 10504);
  assert.equal(salesPeriods.meta.validation.localDateMatches, 10504);
  const result = calculateSalesPeriod(realData, 'all', { start: '2026-09-06T00:00', end: '2026-10-04T00:00' });
  assert.equal(result.precision, 'transaction');
  assert.equal(result.currentComplete, true);
  assert.equal(result.previousComplete, false);
  assert.equal(result.growth, null);
  assert.equal(cents(result.total), 10631164);
  assert.equal(result.quantity, 11347);
  assert.equal(result.factCount, 10504);
  assert.equal(result.current.length, 56);
  for (const actual of result.current) {
    const expected = snapshot.salesDaily.find(row => row.date === actual.date && row.locationId === actual.locationId);
    assert.ok(expected);
    for (const field of ['netSales', 'grossSales', 'discounts']) assert.equal(cents(actual[field]), cents(expected[field]), `${actual.date}: ${field}`);
    assert.equal(actual.quantity, expected.quantity);
    assert.equal(actual.factCount, expected.factCount);
    assert.ok(actual.locationName);
  }
});

test('7, 14 and 28 day presets reconcile with the existing dashboard for both stores', () => {
  for (const days of [7, 14, 28]) {
    const start = new Date(Date.parse('2026-10-04T12:00:00Z') - days * 86400000).toISOString().slice(0, 10) + 'T00:00';
    for (const store of ['all', ...snapshot.locations.map(location => location.id)]) {
      const actual = calculateSalesPeriod(realData, store, { start, end: '2026-10-04T00:00' });
      const expected = periodSales(snapshot, store, days);
      assert.equal(cents(actual.total), cents(expected.total));
      assert.equal(actual.quantity, expected.quantity);
      assert.equal(actual.factCount, expected.factCount);
      assert.equal(actual.currentComplete, true);
      if (days < 28) assert.ok(Math.abs(actual.growth - expected.growth) < 0.0000001);
    }
  }
});

test('a real one-hour window agrees with independent SQL sums and its preceding hour', () => {
  const range = { start: '2026-10-02T12:00', end: '2026-10-02T13:00' };
  const all = calculateSalesPeriod(realData, 'all', range);
  assert.equal(cents(all.total), 33796);
  assert.equal(cents(all.previousTotal), 20100);
  assert.equal(all.quantity, 44);
  assert.equal(all.factCount, 41);
  const sherwood = calculateSalesPeriod(realData, 'a74401ec-ce6e-4df4-ad5d-71ce11af4351', range);
  assert.equal(cents(sherwood.total), 28696);
  assert.equal(cents(sherwood.previousTotal), 14450);
  assert.equal(sherwood.quantity, 37);
  assert.equal(sherwood.factCount, 34);
  const natick = calculateSalesPeriod(realData, 'd61fa7fe-fbe7-41cd-b45c-6527fae9b6b6', range);
  assert.equal(cents(natick.total), 5100);
  assert.equal(cents(natick.previousTotal), 5650);
  assert.equal(natick.quantity, 7);
  assert.equal(natick.factCount, 7);
});
