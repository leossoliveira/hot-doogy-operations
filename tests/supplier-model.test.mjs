import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LOCAL_KEY, loadLocal } from '../src/model.js';
import { supplierItemWithEdits, filterSupplierItems, createSupplierDraft, resolveSupplierPrice, validateSupplierDraft, saveSupplierDraft, restoreSupplierDraft } from '../src/supplier-model.js';

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = '2026-10-04T20:00:00.000Z';
const realCatalog = JSON.parse(await readFile(new URL('../public/data/supplier-catalog.json', import.meta.url), 'utf8'));
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

test('draft and effective row are detached from immutable nested source data', () => {
  const { row } = fixture();
  freeze(row);
  const draft = createSupplierDraft(row);
  draft.units[1].factor = 99;
  draft.stores[0].active = false;
  draft.areas.push({ name: 'Other' });
  assert.equal(row.units[1].factor, 12);
  assert.equal(row.stores[0].active, true);
  assert.equal(row.areas.length, 1);
  const item = supplierItemWithEdits(row);
  item.currentPrices[0].amount = 100;
  assert.equal(row.currentPrices[0].amount, 24);
  assert.equal(item.editedLocally, false);
});

test('shared item changes reach supplier aliases while SKU, brand and association status stay separate', () => {
  const { row, alias } = fixture();
  const local = freeze({
    itemEdits: { [row.itemId]: { name: 'cannot-overwrite', catalogName: 'Shared catalog name', internalName: 'Shared internal name', active: false, supplierId: 'cannot-overwrite' } },
    supplierItemEdits: { [row.supplierItemId]: { sku: 'EDITED', brand: 'Edited brand', supplierActive: false, name: 'Supplier product name', catalogName: 'cannot-overwrite', supplierId: 'cannot-overwrite' } },
  });
  const first = supplierItemWithEdits(row, local), second = supplierItemWithEdits(alias, local);
  assert.equal(first.name, 'Supplier product name');
  assert.equal(second.name, alias.name);
  assert.equal(first.catalogName, 'Shared catalog name');
  assert.equal(second.catalogName, 'Shared catalog name');
  assert.equal(second.internalName, 'Shared internal name');
  assert.equal(first.sku, 'EDITED');
  assert.equal(second.sku, alias.sku);
  assert.equal(first.brand, 'Edited brand');
  assert.equal(second.brand, alias.brand);
  assert.equal(first.supplierActive, false);
  assert.equal(second.supplierActive, true);
  assert.equal(first.supplierId, row.supplierId);
  assert.equal(second.active, false);
  assert.equal(second.editedLocally, true);
});

test('search combines supplier, active store, status and accent-insensitive name, SKU or brand', () => {
  const { row, alias, otherItem } = fixture();
  const inactive = { ...row, supplierItemId: uuid(204), name: 'Inactive', active: false };
  const associationInactive = { ...row, supplierItemId: uuid(205), name: 'Inactive supplier item', supplierActive: false };
  const rows = [row, alias, otherItem, inactive, associationInactive];
  assert.deepEqual(filterSupplierItems(rows, { supplierId: row.supplierId }).map(item => item.supplierItemId), [otherItem.supplierItemId, row.supplierItemId]);
  assert.equal(filterSupplierItems(rows, { supplierId: row.supplierId, storeId: uuid(702) }).length, 0);
  assert.equal(filterSupplierItems(rows, { supplierId: row.supplierId, storeId: uuid(701) }).length, 2);
  assert.equal(filterSupplierItems(rows, { status: 'inactive' }).length, 2);
  assert.equal(filterSupplierItems(rows, { status: 'all' }).length, 5);
  for (const query of ['BÓVINA', 'ALL beef', 'abc-1', 'brand a']) {
    assert.ok(filterSupplierItems(rows, { query }).some(item => item.supplierItemId === row.supplierItemId), query);
  }
});

test('sorting keeps missing brands last in both directions and preserves equal-value order', () => {
  const rows = [
    { name: 'First', brand: null }, { name: 'Second', brand: 'Zulu' }, { name: 'Third', brand: 'Alpha' },
    { name: 'Fourth', brand: 'Alpha' }, { name: 'Fifth', brand: '' },
  ];
  const before = structuredClone(rows);
  assert.deepEqual(filterSupplierItems(rows, { sortKey: 'brand' }).map(row => row.name), ['Third', 'Fourth', 'Second', 'First', 'Fifth']);
  assert.deepEqual(filterSupplierItems(rows, { sortKey: 'brand', direction: 'desc' }).map(row => row.name), ['Second', 'Third', 'Fourth', 'First', 'Fifth']);
  assert.deepEqual(rows, before);
});

test('SKU uniqueness is scoped to supplier and excludes the current supplier item', () => {
  const { row, alias, catalog } = fixture();
  assert.equal(validateSupplierDraft(createSupplierDraft(row), row, catalog), null);
  assert.match(validateSupplierDraft({ ...row, sku: ' abc-2 ' }, row, catalog), /SKU/);
  assert.equal(validateSupplierDraft({ ...row, sku: alias.sku }, row, catalog), null);
  assert.equal(validateSupplierDraft({ ...row, sku: ' ' }, row, catalog), null);
  assert.match(validateSupplierDraft({ ...row, name: '  ' }, row, catalog), /name/);
  assert.match(validateSupplierDraft({ ...row, catalogName: '  ' }, row, catalog), /catalog/);
  assert.match(validateSupplierDraft({ ...row, categoryId: uuid(999) }, row, catalog), /category/);
});

test('price allows unknown or zero but rejects coercion, negative and nonfinite amounts', () => {
  const { row, catalog } = fixture();
  for (const price of ['', '  ', null, 0, '0', '12.345678']) assert.equal(validateSupplierDraft({ ...row, price }, row, catalog), null, String(price));
  for (const price of [-1, '-0.1', '1,25', NaN, Infinity, true, false, [], [1], {}, 'bad']) assert.match(validateSupplierDraft({ ...row, price }, row, catalog), /price/, String(price));
  assert.match(validateSupplierDraft({ ...row, price: 30, priceUnitId: null }, row, catalog), /unit/);
  for (const yieldPercent of [0, '0', 100, '99.25', null, '']) assert.equal(validateSupplierDraft({ ...row, yieldPercent }, row, catalog), null);
  for (const yieldPercent of [-1, 101, Infinity, true]) assert.match(validateSupplierDraft({ ...row, yieldPercent }, row, catalog), /Yield/);
});

test('unit conversions require registered identities, unique units, positive factors and base factor one', () => {
  const { row, catalog } = fixture();
  for (const factor of [0, -1, NaN, Infinity, '', true, [1]]) {
    const draft = createSupplierDraft(row);
    draft.units[1].factor = factor;
    assert.match(validateSupplierDraft(draft, row, catalog), /conversion/);
  }
  const wrongBase = createSupplierDraft(row);
  wrongBase.units[0].factor = 2;
  assert.match(validateSupplierDraft(wrongBase, row, catalog), /base/);
  assert.match(validateSupplierDraft({ ...row, units: [...row.units, row.units[0]] }, row, catalog), /only once/);
  assert.match(validateSupplierDraft({ ...row, units: [...row.units, { id: uuid(999), factor: 1 }] }, row, catalog), /catalog/);
  assert.match(validateSupplierDraft({ ...row, orderingUnitId: catalog.units[2].id }, row, catalog), /saved item units/);
  assert.match(validateSupplierDraft({ ...row, units: row.units.slice(0, 1) }, row, catalog), /saved item units/);
  assert.match(validateSupplierDraft({ ...row, baseUnitId: null }, row, catalog), /base/);
  assert.match(validateSupplierDraft({ ...row, baseUnitId: catalog.units[1].id }, row, catalog), /base/);
});

test('missing original units remain untouched when editing an unrelated field', () => {
  const { row, catalog } = fixture();
  row.receivingUnitId = uuid(998);
  const missingDefinition = { ...catalog, units: catalog.units.filter(unit => unit.id !== row.units[1].id) };
  assert.equal(validateSupplierDraft({ ...row, name: 'Renamed' }, row, missingDefinition), null);
  assert.match(validateSupplierDraft({ ...row, receivingUnitId: uuid(999) }, row, missingDefinition), /saved item units/);
  const changedLegacy = createSupplierDraft(row);
  changedLegacy.units[1].factor = 13;
  assert.match(validateSupplierDraft(changedLegacy, row, missingDefinition), /units from the catalog/);
});

test('save normalizes text, numeric strings and booleans without changing source or read-only type', () => {
  const { row, catalog } = fixture();
  const original = structuredClone(row);
  const draft = createSupplierDraft(row);
  Object.assign(draft, { name: '  Edited name ', internalName: ' ', brand: ' Brand C ', sku: ' SKU-3 ', description: ' desc ', active: 'false', supplierActive: 'true', trackInventory: '0', yieldPercent: '85.5', categoryId: uuid(502), price: '0', type: 'must-not-change' });
  draft.units[1].factor = '15.25';
  const entered = structuredClone(draft);
  freeze(row); freeze(draft);
  const fake = storage();
  fake.setItem('unrelated', 'keep');
  const local = freeze({ ...loadLocal(storage()), orders: [{ id: 'keep-order' }], audit: [{ id: 'old' }] });
  const result = saveSupplierDraft(local, row, draft, catalog, { storage: fake, now });
  assert.deepEqual(row, original);
  assert.deepEqual(draft, entered);
  assert.deepEqual(local.itemEdits, {});
  assert.equal(result.item.name, 'Edited name');
  assert.equal(result.item.productDescription, 'Edited name');
  assert.equal(result.item.catalogName, row.catalogName);
  assert.equal(result.item.internalName, null);
  assert.equal(result.item.brand, 'Brand C');
  assert.equal(result.item.sku, 'SKU-3');
  assert.equal(result.item.description, 'desc');
  assert.equal(result.item.active, false);
  assert.equal(result.item.supplierActive, true);
  assert.equal(result.item.trackInventory, false);
  assert.equal(result.item.yieldPercent, 85.5);
  assert.equal(result.item.categoryName, 'Packaging');
  assert.equal(result.item.type, 'purchased');
  assert.equal(result.item.units[1].factor, 15.25);
  assert.equal(result.item.price, 0);
  assert.equal(result.item.editedLocally, true);
  assert.equal(result.local.audit.length, 2);
  assert.deepEqual(result.local.orders, local.orders);
  assert.deepEqual(JSON.parse(fake.getItem(LOCAL_KEY)), result.local);
  assert.deepEqual(loadLocal(fake), result.local);
  assert.equal(fake.getItem('unrelated'), 'keep');
});

test('changing purchase units updates flags and associations without relabeling a price', () => {
  const { row, alias, catalog } = fixture();
  const draft = createSupplierDraft(row);
  draft.orderingUnitId = row.units[0].id;
  draft.receivingUnitId = row.units[0].id;
  const result = saveSupplierDraft({}, row, draft, catalog, { storage: storage(), now });
  assert.deepEqual(result.item.units.map(unit => [unit.ordering, unit.receiving]), [[true, true], [false, false]]);
  assert.equal(result.item.orderingItemUnitId, row.units[0].itemUnitId);
  assert.equal(result.item.receivingItemUnitId, row.units[0].itemUnitId);
  assert.equal(result.item.priceUnitId, row.priceUnitId);
  assert.equal(result.item.priceUom, 'case');
  assert.equal(result.item.price, 24);
  assert.equal(result.local.supplierItemEdits[row.supplierItemId].pricesByLocation, undefined);
  assert.equal(result.local.itemEdits[row.itemId].orderingUnitId, undefined);
  assert.equal(result.local.itemEdits[row.itemId].receivingUnitId, undefined);
  const otherSupplier = supplierItemWithEdits(alias, result.local);
  assert.equal(otherSupplier.orderingUnitId, alias.orderingUnitId);
  assert.equal(otherSupplier.receivingUnitId, alias.receivingUnitId);
  assert.deepEqual(otherSupplier.units.map(unit => [unit.ordering, unit.receiving]), [[false, false], [true, true]]);
  assert.deepEqual(result.item.stocktakeUnitIds, row.stocktakeUnitIds);
  assert.ok(result.item.units.every(unit => unit.stocktake));
});

test('choosing a single stocktake unit updates all stocktake flags', () => {
  const { row, catalog } = fixture();
  const draft = { ...createSupplierDraft(row), stocktakeUnitId: row.units[0].id };
  const { item } = saveSupplierDraft({}, row, draft, catalog, { storage: storage(), now });
  assert.deepEqual(item.stocktakeUnitIds, [row.units[0].id]);
  assert.deepEqual(item.units.map(unit => unit.stocktake), [true, false]);
});

test('prices stay scoped to supplier and location and retain source provenance', () => {
  const { row, alias, catalog } = fixture();
  const draft = { ...createSupplierDraft(row), price: '30' };
  const first = saveSupplierDraft({}, row, draft, catalog, { storage: storage(), now });
  const locationRow = supplierItemWithEdits({ ...row, priceScope: uuid(701) }, first.local);
  assert.equal(locationRow.price, 30);
  const second = saveSupplierDraft(first.local, locationRow, { ...createSupplierDraft(locationRow), price: '35' }, catalog, { storage: storage(), now });
  assert.equal(supplierItemWithEdits({ ...row, priceScope: uuid(701) }, second.local).price, 35);
  assert.equal(supplierItemWithEdits({ ...row, priceScope: uuid(702) }, second.local).price, 30);
  assert.equal(supplierItemWithEdits(row, second.local).price, 30);
  assert.equal(supplierItemWithEdits(alias, second.local).price, 24);
  assert.deepEqual(second.local.supplierItemEdits[row.supplierItemId].pricesByLocation, { all: { amount: 30, unitId: row.priceUnitId }, [uuid(701)]: { amount: 35, unitId: row.priceUnitId } });
  assert.deepEqual(second.item.currentPrices, row.currentPrices);
  assert.equal(second.item.priceSource, 'local');
  assert.equal(row.currentPrices[0].amount, 24);
  const cleared = saveSupplierDraft(second.local, second.item, { ...createSupplierDraft(second.item), price: '' }, catalog, { storage: storage(), now });
  assert.equal(cleared.item.price, null);
  assert.equal(cleared.local.supplierItemEdits[row.supplierItemId].pricesByLocation[uuid(701)].amount, null);
});

test('failed persistence leaves all existing drafts and audit intact for save and restore', () => {
  const { row, catalog } = fixture();
  const first = saveSupplierDraft({}, row, { ...createSupplierDraft(row), name: 'Saved name' }, catalog, { storage: storage(), now });
  const local = freeze(first.local), before = structuredClone(local);
  const denied = { setItem() { throw new Error('Quota exceeded'); } };
  assert.throws(() => saveSupplierDraft(local, row, { ...createSupplierDraft(row), name: 'Unsaved name' }, catalog, { storage: denied, now }), /Quota exceeded/);
  assert.throws(() => restoreSupplierDraft(local, row, { storage: denied, now }), /Quota exceeded/);
  assert.deepEqual(local, before);
  assert.equal(supplierItemWithEdits(row, local).name, 'Saved name');
});

test('restore removes common and selected supplier edits while preserving other suppliers', () => {
  const { row, alias } = fixture();
  const local = freeze({
    itemEdits: { [row.itemId]: { internalName: 'Shared name' }, unrelated: { internalName: 'Keep' } },
    supplierItemEdits: { [row.supplierItemId]: { sku: 'FIRST', name: 'First supplier name' }, [alias.supplierItemId]: { sku: 'SECOND', name: 'Second supplier name' } },
    audit: [{ id: 'old' }], recipeEdits: { keep: { versionId: 'v1' } },
  });
  const fake = storage();
  const result = restoreSupplierDraft(local, row, { storage: fake, now });
  assert.equal(result.item.name, row.name);
  assert.equal(result.item.sku, row.sku);
  assert.equal(result.item.editedLocally, false);
  assert.equal(result.local.itemEdits[row.itemId], undefined);
  assert.deepEqual(result.local.itemEdits.unrelated, { internalName: 'Keep' });
  assert.equal(result.local.supplierItemEdits[row.supplierItemId], undefined);
  assert.equal(supplierItemWithEdits(alias, result.local).sku, 'SECOND');
  assert.equal(supplierItemWithEdits(alias, result.local).name, 'Second supplier name');
  assert.equal(supplierItemWithEdits(alias, result.local).internalName, alias.internalName);
  assert.deepEqual(result.local.recipeEdits, local.recipeEdits);
  assert.equal(result.local.audit.length, 2);
  assert.deepEqual(JSON.parse(fake.getItem(LOCAL_KEY)), result.local);
  assert.ok(local.itemEdits[row.itemId]);
});

test('registered conversions can be added and removed unless another supplier still uses one', () => {
  const { row, alias, catalog } = fixture();
  const draft = createSupplierDraft(row);
  draft.units.push({ ...catalog.units[2], itemUnitId: null, factor: '6', base: false, ordering: false, receiving: false, stocktake: false });
  const first = saveSupplierDraft({}, row, draft, catalog, { storage: storage(), now });
  assert.equal(first.item.units[2].factor, 6);
  const second = saveSupplierDraft(first.local, first.item, { ...createSupplierDraft(first.item), units: first.item.units.slice(0, 2) }, catalog, { storage: storage(), now });
  assert.equal(second.item.units.length, 2);
  const removal = { ...createSupplierDraft(row), units: row.units.slice(0, 1), orderingUnitId: row.baseUnitId, receivingUnitId: row.baseUnitId, stocktakeUnitId: row.baseUnitId, priceUnitId: row.baseUnitId, price: 2 };
  assert.match(validateSupplierDraft(removal, row, catalog), /another supplier/);
  const effectiveCatalog = { ...catalog, items: catalog.items.map(item => item.supplierItemId === alias.supplierItemId ? { ...item, orderingUnitId: row.baseUnitId, receivingUnitId: row.baseUnitId } : item) };
  assert.equal(validateSupplierDraft(removal, row, effectiveCatalog), null);
});

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

test('price resolution prioritizes explicit store and all-store edits over approved store and global prices', () => {
  const { row } = fixture();
  row.stores[1].active = true;
  row.currentPrices.push({ amount: 28, unitId: row.priceUnitId, uom: 'case', locationId: uuid(701), status: 'approved' });
  row.currentPrices.push({ amount: 999, unitId: row.priceUnitId, uom: 'case', locationId: uuid(702), status: 'pending' });
  assert.equal(resolveSupplierPrice(row, uuid(701)).amount, 28);
  assert.equal(resolveSupplierPrice(row, uuid(702)).amount, 24);
  assert.equal(resolveSupplierPrice(row).varies, true);
  row.pricesByLocation = { all: { amount: 30, unitId: row.priceUnitId } };
  assert.equal(resolveSupplierPrice(row, uuid(701)).amount, 30);
  assert.equal(resolveSupplierPrice(row, uuid(702)).amount, 30);
  assert.equal(resolveSupplierPrice(row).amount, 30);
  assert.equal(resolveSupplierPrice(row).varies, false);
  row.pricesByLocation[uuid(701)] = { amount: 35, unitId: row.priceUnitId };
  assert.equal(resolveSupplierPrice(row, uuid(701)).amount, 35);
  assert.equal(resolveSupplierPrice(row).amount, null);
  assert.equal(resolveSupplierPrice(row).varies, true);
  assert.equal(resolveSupplierPrice(row).local, true);
});

test('unknown store edits override known and zero prices without becoming zero themselves', () => {
  const { row } = fixture();
  row.stores[1].active = true;
  row.pricesByLocation = { all: { amount: 0, unitId: row.priceUnitId }, [uuid(701)]: { amount: null, unitId: row.priceUnitId } };
  assert.equal(resolveSupplierPrice(row, uuid(701)).amount, null);
  assert.equal(resolveSupplierPrice(row, uuid(701)).local, true);
  assert.equal(resolveSupplierPrice(row, uuid(702)).amount, 0);
  assert.equal(resolveSupplierPrice(row).varies, true);
  row.pricesByLocation[uuid(702)] = { amount: null, unitId: row.priceUnitId };
  assert.equal(resolveSupplierPrice(row).amount, null);
  assert.equal(resolveSupplierPrice(row).varies, false);
  row.currentPrices = [{ amount: 100, unitId: row.priceUnitId, locationId: null, status: 'pending' }];
  delete row.pricesByLocation;
  assert.equal(resolveSupplierPrice(row, uuid(701)).amount, null);
  assert.equal(resolveSupplierPrice(row).amount, null);
});

test('all-store prices compare unit IDs and ignore inactive store associations', () => {
  const { row } = fixture();
  row.pricesByLocation = { [uuid(701)]: { amount: 24, unitId: row.units[0].id } };
  assert.equal(resolveSupplierPrice(row).amount, 24);
  assert.equal(resolveSupplierPrice(row).unitId, row.units[0].id);
  assert.equal(resolveSupplierPrice(row).varies, false);
  row.stores[1].active = true;
  assert.equal(resolveSupplierPrice(row).varies, true);
  row.stores[1].locationActive = false;
  assert.equal(resolveSupplierPrice(row).varies, false);
  row.stores = [];
  assert.equal(resolveSupplierPrice(row).amount, 24);
  assert.equal(resolveSupplierPrice(row).unitId, row.priceUnitId);
  assert.equal(resolveSupplierPrice(row, 'global').amount, 24);
});

test('a known price in one active store and a missing price in another is visibly variable', () => {
  const { row } = fixture();
  row.stores[1].active = true;
  row.currentPrices = [{ amount: 0, unitId: row.priceUnitId, uom: 'case', locationId: uuid(701), status: 'approved' }];
  assert.equal(resolveSupplierPrice(row, uuid(701)).amount, 0);
  assert.equal(resolveSupplierPrice(row, uuid(702)).amount, null);
  assert.equal(resolveSupplierPrice(row).varies, true);
});

test('restoring one supplier cannot orphan another supplier using a shared local conversion', () => {
  const { row, alias, catalog } = fixture();
  const draft = createSupplierDraft(row);
  draft.units.push({ ...catalog.units[2], itemUnitId: uuid(603), factor: 6 });
  draft.orderingUnitId = catalog.units[2].id;
  const saved = saveSupplierDraft({}, row, draft, catalog, { storage: storage(), now });
  const before = structuredClone(saved.local);
  let persisted = false;
  assert.throws(() => restoreSupplierDraft(saved.local, alias, { catalog, storage: { setItem() { persisted = true; } }, now }), /another supplier/);
  assert.deepEqual(saved.local, before);
  assert.equal(persisted, false);
  // Stored itemId also protects restores when the caller has no catalog at hand.
  assert.throws(() => restoreSupplierDraft(saved.local, alias, { storage: storage(), now }), /another supplier/);
  const restoredOwner = restoreSupplierDraft(saved.local, row, { catalog, storage: storage(), now });
  assert.equal(restoredOwner.item.orderingUnitId, row.orderingUnitId);
  assert.equal(restoredOwner.local.itemEdits[row.itemId], undefined);
});

test('removing or restoring shared conversions preserves other supplier price references in every location', () => {
  const { row, alias, catalog } = fixture();
  const draft = createSupplierDraft(row);
  draft.units.push({ ...catalog.units[2], itemUnitId: uuid(603), factor: 6 });
  draft.priceUnitId = catalog.units[2].id;
  draft.priceScope = uuid(701);
  draft.price = 12;
  const saved = saveSupplierDraft({}, row, draft, catalog, { storage: storage(), now });
  const effectiveCatalog = { ...catalog, items: catalog.items.map(item => supplierItemWithEdits(item, saved.local)) };
  const effectiveAlias = effectiveCatalog.items.find(item => item.supplierItemId === alias.supplierItemId);
  const removal = createSupplierDraft(effectiveAlias);
  removal.units = removal.units.filter(unit => unit.id !== catalog.units[2].id);
  assert.match(validateSupplierDraft(removal, effectiveAlias, effectiveCatalog), /local pricing by another supplier/);
  assert.throws(() => restoreSupplierDraft(saved.local, alias, { catalog, storage: storage(), now }), /local price/);
  const restoredOwner = restoreSupplierDraft(saved.local, row, { catalog, storage: storage(), now });
  assert.equal(restoredOwner.local.supplierItemEdits[row.supplierItemId], undefined);
  assert.equal(restoredOwner.item.units.some(unit => unit.id === catalog.units[2].id), false);
});
