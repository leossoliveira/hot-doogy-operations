import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  LOCAL_KEY, loadLocal, saveLocal, money, number, preciseNumber, date, periodSales, safeCsv,
  stockFor, validateOrder, validateTransfer, nextTransferStatus,
} from '../../src/model.js';

const storage = (initial = {}) => {
  const values = new Map(Object.entries(initial));
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};
const order = () => ({ supplierId: 'supplier', locationId: 'sherwood', expectedAt: '2026-10-05', lines: [{ itemId: 'bread', qty: 2 }] });
const transfer = () => ({ fromLocationId: 'sherwood', toLocationId: 'natick', date: '2026-10-05', lines: [{ itemId: 'bread', qty: 2 }] });
const cents = n => Math.round(n * 100);

const snapshot = JSON.parse(await readFile(new URL('../../public/data/snapshot.json', import.meta.url), 'utf8'));
test('real snapshot totals preserve the sales period and both store totals', () => {
  const all = periodSales(snapshot, 'all', 28);
  assert.equal(cents(all.total), 10631164);
  assert.equal(all.current.length, 56);
  assert.equal(all.dates[0], '2026-09-06');
  assert.equal(all.dates.at(-1), '2026-10-03');
  const week = periodSales(snapshot, 'all', 7);
  assert.equal(cents(week.total), 2710647);
  assert.equal(week.quantity, 2934);
  assert.equal(week.factCount, 2730);
  const expected = { NATICK_MALL: 723133, SHERWOOD: 1987514 };
  for (const location of snapshot.locations) {
    const result = periodSales(snapshot, location.id, 7);
    assert.equal(cents(result.total), expected[location.code]);
    assert.ok(result.current.every(row => row.locationId === location.id));
  }
});

test('database timestamps render in New York time without invalid-date failures', () => {
  for (const row of snapshot.orders) {
    for (const key of ['orderedAt', 'expectedAt', 'createdAt']) {
      assert.doesNotThrow(() => date(row[key]));
      if (row[key]) assert.notEqual(date(row[key]), 'Not set');
    }
  }
  assert.equal(date('2026-10-04 01:00:00.123456+00'), date('2026-10-03'));
  assert.equal(date('2026-10-03'), date('2026-10-03T12:00:00-04:00'));
  assert.equal(date(null), 'Not set');
  assert.equal(date('invalid'), 'Not set');
});

test('local state survives persistence without touching the source snapshot or other storage keys', () => {
  const fake = storage({ untouched: 'keep' });
  const local = loadLocal(fake);
  const before = JSON.stringify(snapshot);
  local.orders.push({ id: 'local-order', ...order() });
  local.transfers.push({ id: 'local-transfer', status: 'draft', ...transfer() });
  local.counts.push({ id: 'count', locationId: 'sherwood', createdAt: '2026-10-04T13:00:00Z', lines: [{ rowId: 'row', qty: 3, uom: 'Case' }] });
  saveLocal(local, fake);
  assert.deepEqual(loadLocal(fake), local);
  assert.ok(fake.getItem(LOCAL_KEY));
  assert.equal(fake.getItem('untouched'), 'keep');
  assert.equal(JSON.stringify(snapshot), before);
});
