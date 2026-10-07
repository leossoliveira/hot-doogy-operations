import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LOCAL_KEY, loadLocal } from '../../src/model.js';
import { supplierItemWithEdits, filterSupplierItems, createSupplierDraft, resolveSupplierPrice, validateSupplierDraft, saveSupplierDraft, restoreSupplierDraft } from '../../src/supplier-model.js';

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = '2026-10-04T20:00:00.000Z';
const storage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};
const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const fixture = () => {
  const units = [
    { id: uuid(101), name: 'Each', abbreviation: 'ea' },
    { id: uuid(102), name: 'Case', abbreviation: 'case' },
    { id: uuid(103), name: 'Bag', abbreviation: 'bag' },
  ];
  const row = {
    supplierItemId: uuid(201), itemId: uuid(301), supplierId: uuid(401), supplierName: 'Supplier A',
    name: 'Salsicha bovina', productDescription: 'Salsicha bovina', catalogName: 'Catalog beef sausage', internalName: 'All Beef Hot Dog', description: 'Keep frozen', brand: 'Brand A', sku: 'ABC-1',
    active: true, supplierActive: true, trackInventory: true, type: 'purchased',
    categoryId: uuid(501), categoryName: 'Food', yieldPercent: 95,
    baseUnitId: units[0].id, baseUnitName: 'Each', orderingUnitId: units[1].id, orderingItemUnitId: uuid(602),
    receivingUnitId: units[1].id, receivingItemUnitId: uuid(602), stocktakeUnitId: null, stocktakeUnitIds: [units[0].id, units[1].id],
    units: units.slice(0, 2).map((unit, index) => ({ ...unit, itemUnitId: uuid(601 + index), factor: index ? 12 : 1, base: !index, ordering: Boolean(index), receiving: Boolean(index), stocktake: true })),
    stores: [{ id: uuid(701), name: 'Sherwood', active: true }, { id: uuid(702), name: 'Natick', active: false }],
    areas: [{ id: uuid(801), name: 'Freezer', locationId: uuid(701) }],
    price: 24, priceUnitId: units[1].id, priceUom: 'case', priceSource: 'approved', priceDate: '2026-10-01', priceScope: 'all',
    currentPrices: [{ id: uuid(901), amount: 24, unitId: units[1].id, locationId: null, status: 'approved' }],
  };
  const alias = { ...structuredClone(row), supplierItemId: uuid(202), supplierId: uuid(402), supplierName: 'Supplier B', sku: 'OTHER-1', brand: 'Brand B' };
  const otherItem = { ...structuredClone(row), supplierItemId: uuid(203), itemId: uuid(303), name: 'Bread', sku: 'ABC-2' };
  const catalog = { items: [row, alias, otherItem], units, categories: [{ id: uuid(501), name: 'Food' }, { id: uuid(502), name: 'Packaging' }] };
  return { row, alias, otherItem, catalog };
};

const realCatalog = JSON.parse(await readFile(new URL('../../public/data/supplier-catalog.json', import.meta.url), 'utf8'));
test('all real supplier associations validate without dropping aliases or promoting pending prices', () => {
  assert.equal(realCatalog.items.length, 166);
  assert.equal(new Set(realCatalog.items.map(item => item.supplierItemId)).size, 166);
  assert.equal(new Set(realCatalog.items.map(item => item.itemId)).size, 164);
  assert.equal(filterSupplierItems(realCatalog.items, { status: 'all' }).length, 166);
  let approved = 0, pending = 0;
  for (const row of realCatalog.items) {
    assert.equal(validateSupplierDraft(createSupplierDraft(row), row, realCatalog), null, `${row.supplierName}: ${row.name}`);
    const effective = supplierItemWithEdits(row);
    assert.equal(effective.price, row.price);
    assert.deepEqual(effective.currentPrices, row.currentPrices);
    assert.deepEqual(effective.priceHistory, row.priceHistory);
    for (const price of row.currentPrices) {
      assert.equal(price.status, 'approved');
      assert.ok(row.priceHistory.some(source => source.id === price.id && source.status === 'approved'));
      approved += 1;
    }
    pending += row.priceHistory.filter(price => price.status === 'pending').length;
    const global = row.currentPrices.find(price => price.locationId === null);
    assert.equal(row.price, global?.amount ?? null, row.name);
    for (const unit of row.units) assert.ok(realCatalog.units.some(globalUnit => globalUnit.id === unit.id));
  }
  assert.equal(approved, 163);
  assert.equal(pending, 179);
});

test('actual supplier product name and purchase-unit changes do not leak into another supplier alias', () => {
  const firstRow = realCatalog.items.find(row => realCatalog.items.some(other => other.itemId === row.itemId && other.supplierItemId !== row.supplierItemId));
  const otherRow = realCatalog.items.find(row => row.itemId === firstRow.itemId && row.supplierItemId !== firstRow.supplierItemId);
  const before = structuredClone(firstRow);
  const draft = createSupplierDraft(firstRow);
  draft.name = 'Local supplier description';
  draft.internalName = 'Local shared internal name';
  draft.orderingUnitId = firstRow.baseUnitId;
  const result = saveSupplierDraft({}, firstRow, draft, realCatalog, { storage: storage(), now });
  const other = supplierItemWithEdits(otherRow, result.local);
  assert.equal(result.item.name, 'Local supplier description');
  assert.equal(result.item.productDescription, 'Local supplier description');
  assert.equal(other.name, otherRow.name);
  assert.equal(other.internalName, 'Local shared internal name');
  assert.equal(other.orderingUnitId, otherRow.orderingUnitId);
  assert.equal(other.sku, otherRow.sku);
  assert.equal(other.price, otherRow.price);
  assert.equal(result.item.priceUnitId, firstRow.priceUnitId);
  assert.deepEqual(result.item.priceHistory, firstRow.priceHistory);
  assert.deepEqual(firstRow, before);
});

test('the exported global price scope saves as the all-locations fallback', () => {
  const row = realCatalog.items.find(row => row.price != null);
  assert.equal(row.priceScope, 'global');
  const draft = { ...createSupplierDraft(row), price: String(row.price + 1) };
  const result = saveSupplierDraft({}, row, draft, realCatalog, { storage: storage(), now });
  assert.deepEqual(result.local.supplierItemEdits[row.supplierItemId].pricesByLocation, { all: { amount: row.price + 1, unitId: row.priceUnitId } });
  assert.equal(result.item.price, row.price + 1);
});
