import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  LOCAL_KEY, loadLocal, saveLocal, money, number, preciseNumber, date, periodSales, safeCsv,
  stockFor, validateOrder, validateTransfer, nextTransferStatus,
} from '../src/model.js';

const snapshot = JSON.parse(await readFile(new URL('../public/data/snapshot.json', import.meta.url), 'utf8'));
const storage = (initial = {}) => {
  const values = new Map(Object.entries(initial));
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};
const order = () => ({ supplierId: 'supplier', locationId: 'sherwood', expectedAt: '2026-10-05', lines: [{ itemId: 'bread', qty: 2 }] });
const transfer = () => ({ fromLocationId: 'sherwood', toLocationId: 'natick', date: '2026-10-05', lines: [{ itemId: 'bread', qty: 2 }] });
const cents = n => Math.round(n * 100);

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

test('sales growth compares adjacent periods and preserves negative adjustments', () => {
  const data = { salesDaily: [
    { date: '2026-09-29', locationId: 'a', netSales: 100, quantity: 10, factCount: 1 },
    { date: '2026-09-30', locationId: 'a', netSales: 100, quantity: 10, factCount: 1 },
    { date: '2026-10-01', locationId: 'a', netSales: 300, quantity: 30, factCount: 1 },
    { date: '2026-10-02', locationId: 'a', netSales: -50, quantity: -5, factCount: 1 },
  ] };
  const result = periodSales(data, 'a', 2);
  assert.equal(result.total, 250);
  assert.equal(result.quantity, 25);
  assert.equal(result.growth, 25);
  assert.equal(money(-67.9), '-$67.90');
  assert.equal(money(null), '—');
});

test('a store with missing dates does not silently move the reporting window backward', () => {
  const data = { salesDaily: [
    { date: '2026-09-25', locationId: 'a', netSales: 500 },
    { date: '2026-10-01', locationId: 'a', netSales: 100 },
    { date: '2026-10-03', locationId: 'b', netSales: 900 },
  ] };
  assert.equal(periodSales(data, 'a', 7).total, 100);
  assert.equal(periodSales(data, 'missing', 7).total, 0);
  assert.equal(periodSales({ salesDaily: [] }, 'all', 7).growth, null);
  assert.equal(periodSales(data, 'all', 0).total, 0);
});

test('purchase validation requires supplier, store, delivery date, and positive item quantities', () => {
  assert.equal(validateOrder(order()), null);
  for (const key of ['supplierId', 'locationId', 'expectedAt']) {
    assert.equal(typeof validateOrder({ ...order(), [key]: '' }), 'string');
  }
  assert.equal(typeof validateOrder({ ...order(), lines: [] }), 'string');
  for (const qty of [0, -1, '', 'abc', Infinity, NaN, null, true, [1]]) {
    assert.equal(typeof validateOrder({ ...order(), lines: [{ itemId: 'bread', qty }] }), 'string', String(qty));
  }
  assert.equal(validateOrder({ ...order(), lines: [{ itemId: 'bread', qty: '1.25' }] }), null);
});

test('transfer validation rejects same-store moves and invalid lines', () => {
  assert.equal(validateTransfer(transfer()), null);
  assert.equal(typeof validateTransfer({ ...transfer(), toLocationId: 'sherwood' }), 'string');
  assert.equal(typeof validateTransfer({ ...transfer(), date: '' }), 'string');
  assert.equal(typeof validateTransfer({ ...transfer(), lines: [] }), 'string');
  assert.equal(typeof validateTransfer({ ...transfer(), lines: [{ itemId: 'bread', qty: -2 }] }), 'string');
  assert.equal(typeof validateTransfer({ ...transfer(), lines: [{ itemId: '', qty: 2 }] }), 'string');
});

test('transfer progression stops after completion and ignores unknown states', () => {
  assert.equal(nextTransferStatus('draft'), 'approved');
  assert.equal(nextTransferStatus('approved'), 'dispatched');
  assert.equal(nextTransferStatus('dispatched'), 'completed');
  for (const state of ['completed', 'cancelled', 'invalid', 'constructor', 'toString', '__proto__', undefined]) {
    assert.equal(nextTransferStatus(state), null);
  }
});

test('database timestamps render in New York time without invalid-date failures', () => {
  for (const row of snapshot.orders) {
    for (const key of ['orderedAt', 'expectedAt', 'createdAt']) {
      assert.doesNotThrow(() => date(row[key]));
      if (row[key]) assert.notEqual(date(row[key]), 'A definir');
    }
  }
  assert.equal(date('2026-10-04 01:00:00.123456+00'), date('2026-10-03'));
  assert.equal(date('2026-10-03'), date('2026-10-03T12:00:00-04:00'));
  assert.equal(date(null), 'A definir');
  assert.equal(date('invalid'), 'A definir');
});

test('CSV neutralizes formulas including leading whitespace and control characters', () => {
  const values = ['=1+1', '+SUM(A1)', '-2+3', '@SUM(A1)', '  =1+1', '\t=1+1', '\r=1+1', '\n=1+1'];
  const csv = safeCsv(values.map(value => ({ value })), [{ label: 'Value', value: 'value' }]);
  for (const value of values) assert.ok(csv.includes('"\'' + value + '"'), JSON.stringify(value));
});

test('CSV preserves numeric credits and escapes embedded quotes, separators, and line breaks', () => {
  const csv = safeCsv([{ name: 'A; "B"\nC', total: -67.9, empty: null }], [
    { label: 'Name', value: 'name' }, { label: 'Total', value: row => row.total }, { label: 'Empty', value: 'empty' },
  ]);
  assert.equal(csv, '\ufeff"Name";"Total";"Empty"\r\n"A; ""B""\nC";"-67.9";""');
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

test('invalid or unavailable browser storage yields a usable empty state', () => {
  const variants = ['{broken', 'null', '[]', '{"orders":null,"counts":"bad","overrides":[]}'];
  for (const value of variants) {
    const local = loadLocal(storage({ [LOCAL_KEY]: value }));
    assert.ok(Array.isArray(local.orders));
    assert.ok(Array.isArray(local.counts));
    assert.deepEqual(local.overrides, {});
    assert.equal(stockFor({ rowId: 'x', locationId: 'a', stockQty: null, stocktakeUom: 'Each' }, local).qty, null);
  }
  assert.deepEqual(loadLocal({ getItem() { throw new Error('Storage denied'); } }).orders, []);
});

test('storage write failure is surfaced rather than reporting an unsaved count as persisted', () => {
  assert.throws(() => saveLocal(loadLocal(storage()), { setItem() { throw new Error('Quota exceeded'); } }), /Quota exceeded/);
});

test('stock counts stay scoped to location and row, latest local count wins, and zero is a valid count', () => {
  const item = { rowId: 'row-sherwood', locationId: 'sherwood', stockQty: null, stocktakeUom: 'Case' };
  const local = loadLocal(storage());
  assert.deepEqual(stockFor(item, local), { qty: null, uom: 'Case', local: false });
  local.counts = [
    { locationId: 'sherwood', createdAt: '2026-10-02T13:00:00Z', lines: [{ rowId: 'row-sherwood', qty: 5, uom: 'Case' }] },
    { locationId: 'natick', createdAt: '2026-10-04T13:00:00Z', lines: [{ rowId: 'row-sherwood', qty: 99, uom: 'Case' }] },
    { locationId: 'sherwood', createdAt: '2026-10-03T13:00:00Z', lines: [{ rowId: 'row-sherwood', qty: 0, uom: 'Each' }] },
    { locationId: 'sherwood', createdAt: '2026-10-04T13:00:00Z', lines: [{ rowId: 'different-row', qty: 88, uom: 'Case' }] },
  ];
  assert.deepEqual(stockFor(item, local), { qty: 0, uom: 'Each', local: true });
  assert.equal(item.stockQty, null);
  const fake = storage();
  saveLocal(local, fake);
  assert.deepEqual(stockFor(item, loadLocal(fake)), { qty: 0, uom: 'Each', local: true });
});

test('historical counts entered later never override a more recent effective conference', () => {
  const item = { rowId: 'bread', locationId: 'sherwood', stockQty: null, stocktakeUom: 'Each' };
  const local = loadLocal(storage());
  local.counts = [
    { locationId: 'sherwood', date: '2026-10-03', moment: 'Após o fechamento', createdAt: '2026-10-03T23:00:00Z', lines: [{ rowId: 'bread', qty: 8, uom: 'Each' }] },
    { locationId: 'sherwood', date: '2026-10-02', moment: 'Após o fechamento', createdAt: '2026-10-04T13:00:00Z', lines: [{ rowId: 'bread', qty: 99, uom: 'Each' }] },
  ];
  assert.equal(stockFor(item, local).qty, 8);
  const fake = storage();
  saveLocal(local, fake);
  assert.equal(stockFor(item, loadLocal(fake)).qty, 8);
});

test('same-day conferences sort opening, operation, closing, then latest correction', () => {
  const item = { rowId: 'bread', locationId: 'sherwood', stockQty: null, stocktakeUom: 'Each' };
  const count = (moment, createdAt, qty) => ({ locationId: 'sherwood', date: '2026-10-03', moment, createdAt, lines: [{ rowId: 'bread', qty, uom: 'Each' }] });
  const local = loadLocal(storage());
  local.counts = [
    count('Após o fechamento', '2026-10-03T23:00:00Z', 5),
    count('Antes da abertura', '2026-10-04T15:00:00Z', 20),
    count('Durante a operação', '2026-10-04T14:00:00Z', 12),
  ];
  assert.equal(stockFor(item, local).qty, 5);
  local.counts.push(count('Após o fechamento', '2026-10-04T13:00:00Z', 6));
  assert.equal(stockFor(item, local).qty, 6);
  local.counts = local.counts.filter(c => c.moment !== 'Após o fechamento');
  assert.equal(stockFor(item, local).qty, 12);
});

test('legacy counts use their creation day in New York and compare timestamps across offsets', () => {
  const item = { rowId: 'bread', locationId: 'sherwood', stockQty: null, stocktakeUom: 'Each' };
  const local = loadLocal(storage());
  local.counts = [
    { locationId: 'sherwood', createdAt: '2026-10-04T01:00:00Z', lines: [{ rowId: 'bread', qty: 30, uom: 'Each' }] },
    { locationId: 'sherwood', date: '2026-10-04', moment: 'Antes da abertura', createdAt: '2026-10-03T20:00:00Z', lines: [{ rowId: 'bread', qty: 40, uom: 'Each' }] },
  ];
  assert.equal(stockFor(item, local).qty, 40);
  local.counts = [
    { locationId: 'sherwood', createdAt: '2026-10-04T13:00:00Z', lines: [{ rowId: 'bread', qty: 1, uom: 'Each' }] },
    { locationId: 'sherwood', createdAt: '2026-10-04T10:00:00-04:00', lines: [{ rowId: 'bread', qty: 2, uom: 'Each' }] },
  ];
  assert.equal(stockFor(item, local).qty, 2);
});

test('quantity formatter retains six decimal places and never rounds tiny nonzero factors to zero', () => {
  assert.equal(preciseNumber(0.002834), '0,002834');
  assert.equal(preciseNumber(0.000001), '0,000001');
  assert.equal(preciseNumber('1234.567891'), '1.234,567891');
  assert.equal(preciseNumber(1.23456789), '1,234568');
  assert.equal(preciseNumber(0), '0');
  assert.equal(preciseNumber(0.0000001), '1E-7');
  assert.equal(preciseNumber(-0.0000001), '-1E-7');
  assert.equal(preciseNumber(NaN), '—');
  assert.equal(preciseNumber(Infinity), '—');
  assert.equal(number(1.234567), '1,23');
  assert.equal(money(1.234567), '$1.23');
});
