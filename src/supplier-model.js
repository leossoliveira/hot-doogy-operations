import { norm, saveLocal } from './model.js';

const commonFields = ['internalName', 'description', 'categoryId', 'categoryName', 'active', 'trackInventory', 'baseUnitId', 'baseUnitName', 'stocktakeUnitId', 'stocktakeUnitIds', 'units', 'yieldPercent'];
const vendorFields = ['name', 'productDescription', 'sku', 'brand', 'supplierActive', 'orderingUnitId', 'orderingItemUnitId', 'receivingUnitId', 'receivingItemUnitId'];
const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
const blank = value => value == null || typeof value === 'string' && value.trim() === '';
const numeric = value => ['string', 'number'].includes(typeof value) && !blank(value) && Number.isFinite(Number(value));
const text = value => blank(value) ? null : String(value).trim();
const boolean = value => typeof value === 'string' ? ['true', '1', 'on'].includes(value.toLowerCase().trim()) : Boolean(value);
const pick = (object, fields) => Object.fromEntries(fields.filter(key => own(object, key)).map(key => [key, structuredClone(object[key])]));
const timestamp = now => typeof now === 'function' ? now() : now ?? new Date().toISOString();
const scopeOf = value => value == null || value === 'global' ? 'all' : value;
const vendorUnitReferences = item => [item.orderingUnitId, item.receivingUnitId, ...Object.values(item.pricesByLocation || {}).map(price => price?.unitId)];

export function supplierItemWithEdits(row, local = {}) {
  const shared = local.itemEdits?.[row.itemId];
  const vendor = local.supplierItemEdits?.[row.supplierItemId];
  const item = {
    ...structuredClone(row), ...pick(shared, commonFields), ...pick(vendor, vendorFields),
    editedLocally: Boolean(shared || vendor),
  };
  const stocktakeIds = item.stocktakeUnitIds ?? (item.stocktakeUnitId ? [item.stocktakeUnitId] : null);
  item.units = (item.units || []).map(unit => ({
    ...unit,
    ...(own(item, 'orderingUnitId') ? { ordering: unit.id === item.orderingUnitId } : {}),
    ...(own(item, 'receivingUnitId') ? { receiving: unit.id === item.receivingUnitId } : {}),
    ...(stocktakeIds ? { stocktake: stocktakeIds.includes(unit.id) } : {}),
  }));
  for (const prefix of ['base', 'ordering', 'receiving', 'stocktake']) {
    const unit = item.units.find(unit => unit.id === item[`${prefix}UnitId`]);
    if (unit) {
      item[`${prefix}UnitName`] = unit.name;
      item[`${prefix}Uom`] = unit.abbreviation || unit.name;
      item[`${prefix}ItemUnitId`] = unit.itemUnitId ?? null;
      if (prefix === 'ordering' || prefix === 'receiving') item[`${prefix}Factor`] = unit.factor;
    }
  }
  if (stocktakeIds) item.stocktakeItemUnitIds = stocktakeIds.map(id => item.units.find(unit => unit.id === id)?.itemUnitId).filter(Boolean);
  if (vendor?.pricesByLocation) item.pricesByLocation = structuredClone(vendor.pricesByLocation);
  if (row.priceScope != null) {
    const price = item.pricesByLocation?.[scopeOf(row.priceScope)] ?? item.pricesByLocation?.all;
    if (price) {
      item.price = price.amount;
      item.priceUnitId = price.unitId;
      const unit = item.units?.find(unit => unit.id === price.unitId);
      item.priceUom = unit?.abbreviation || unit?.name || (price.unitId === row.priceUnitId ? row.priceUom : null);
      item.priceSource = 'local';
    }
  }
  return item;
}

export function filterSupplierItems(rows, { supplierId, storeId = 'all', query = '', status = 'active', sortKey = 'name', direction = 'asc' } = {}) {
  const search = norm(query).trim();
  const directionFactor = direction === 'desc' ? -1 : 1;
  const compare = new Intl.Collator("en-US", { sensitivity: 'base', numeric: true });
  return rows.map((row, index) => ({ row, index })).filter(({ row }) => {
    if (supplierId && supplierId !== 'all' && row.supplierId !== supplierId) return false;
    if (storeId !== 'all' && !row.stores?.some(store => store.id === storeId && store.active !== false && store.locationActive !== false)) return false;
    const active = row.active !== false && row.supplierActive !== false;
    if (status === 'active' && !active || status === 'inactive' && active) return false;
    return !search || [row.name, row.internalName, row.sku, row.brand].some(value => norm(value).includes(search));
  }).sort((a, b) => {
    const first = a.row[sortKey], second = b.row[sortKey];
    const firstMissing = blank(first), secondMissing = blank(second);
    if (firstMissing !== secondMissing) return firstMissing ? 1 : -1;
    const result = firstMissing ? 0 : typeof first === 'number' && typeof second === 'number' ? first - second : compare.compare(String(first), String(second));
    return result * directionFactor || a.index - b.index;
  }).map(({ row }) => row);
}

export function createSupplierDraft(row) {
  return structuredClone(row);
}

export function resolveSupplierPrice(row, scope = 'all') {
  const units = row.units || [];
  const approved = (row.currentPrices || []).filter(price => price.status === 'approved');
  const resolveAt = locationId => {
    const local = locationId && row.pricesByLocation?.[locationId] || row.pricesByLocation?.all;
    const source = local || approved.find(price => price.locationId === locationId) || approved.find(price => price.locationId == null);
    const unit = units.find(unit => unit.id === source?.unitId);
    return {
      amount: source && numeric(source.amount) ? Number(source.amount) : null,
      unitId: source?.unitId ?? null,
      uom: (local ? unit?.abbreviation || unit?.name : source?.uom || source?.unitName) ?? null,
      local: Boolean(local),
      date: local ? local.date ?? null : source?.date ?? source?.effectiveAt ?? null,
      unitSource: local ? 'local' : source?.unitSource ?? null,
      locationId: local ? (locationId && row.pricesByLocation?.[locationId] ? locationId : null) : source?.locationId ?? null,
      varies: false,
    };
  };
  const requested = scopeOf(scope);
  if (requested !== 'all') return resolveAt(requested);
  const stores = [...new Set((row.stores || []).filter(store => store.active !== false && store.locationActive !== false).map(store => store.id))];
  if (!stores.length) return resolveAt(null);
  const prices = stores.map(resolveAt), first = prices[0];
  const varies = prices.some(price => price.amount !== first.amount || price.unitId !== first.unitId);
  if (varies) return { amount: null, unitId: null, uom: null, local: prices.some(price => price.local), date: null, unitSource: null, locationId: null, varies: true };
  return {
    ...first, local: prices.some(price => price.local), locationId: null,
    date: prices.every(price => price.date === first.date) ? first.date : null,
    unitSource: prices.every(price => price.unitSource === first.unitSource) ? first.unitSource : null,
  };
}

export function validateSupplierDraft(draft, original, catalog) {
  if (!draft || typeof draft.name !== 'string' || !draft.name.trim()) return "Enter the item name.";
  if (blank(draft.internalName)) return "Enter the internal name.";
  if (text(draft.baseUnitId) !== text(original.baseUnitId)) return "The item’s base unit cannot be changed.";
  if (!Array.isArray(draft.units)) return "The item’s units are invalid.";
  const sku = norm(draft.sku).trim();
  if (sku && (catalog.items || []).some(item => item.supplierId === original.supplierId && item.supplierItemId !== original.supplierItemId && norm(item.sku).trim() === sku)) return "This SKU is already assigned to another item from this supplier.";
  if (!blank(draft.categoryId) && !(catalog.categories || []).some(category => category.id === draft.categoryId)) return "Choose a saved category.";
  if (!blank(draft.price) && (!numeric(draft.price) || Number(draft.price) < 0)) return "Enter a price of zero or more, or leave it blank.";
  if (!blank(draft.yieldPercent) && (!numeric(draft.yieldPercent) || Number(draft.yieldPercent) < 0 || Number(draft.yieldPercent) > 100)) return "Yield must be between 0% and 100%.";
  const globalUnits = new Set((catalog.units || []).map(unit => unit.id));
  const unitIds = new Set();
  for (const unit of draft.units) {
    if (!unit?.id || unitIds.has(unit.id)) return "Each unit can appear only once per item.";
    unitIds.add(unit.id);
    if (!numeric(unit.factor) || Number(unit.factor) <= 0) return "Enter a conversion factor greater than zero for each unit.";
    if ((unit.id === draft.baseUnitId || unit.base) && Number(unit.factor) !== 1) return "The base unit’s conversion factor must be 1.";
    const existing = original.units?.find(existing => existing.id === unit.id);
    const unchangedLegacy = existing && existing.itemUnitId === unit.itemUnitId && Number(existing.factor) === Number(unit.factor);
    if (!globalUnits.has(unit.id) && !unchangedLegacy) return "Choose units from the catalog.";
  }
  for (const field of ['baseUnitId', 'orderingUnitId', 'receivingUnitId', 'stocktakeUnitId', 'priceUnitId']) {
    const id = draft[field];
    if (blank(id)) continue;
    const unchangedMissing = id === original[field] && !original.units?.some(unit => unit.id === id);
    if ((!globalUnits.has(id) || !unitIds.has(id)) && !unchangedMissing && !(unitIds.has(id) && id === original[field])) return "Choose saved item units for ordering, receiving, counting, and pricing.";
  }
  const removedUnits = new Set((original.units || []).filter(unit => !unitIds.has(unit.id)).map(unit => unit.id));
  if ((catalog.items || []).some(item => item.itemId === original.itemId && item.supplierItemId !== original.supplierItemId && vendorUnitReferences(item).some(id => removedUnits.has(id)))) return "A removed unit is still used for ordering, receiving, or local pricing by another supplier of this item.";
  if (own(draft, 'stocktakeUnitIds') && draft.stocktakeUnitId === original.stocktakeUnitId) {
    if (!Array.isArray(draft.stocktakeUnitIds)) return "Invalid count units.";
    if (new Set(draft.stocktakeUnitIds).size !== draft.stocktakeUnitIds.length || draft.stocktakeUnitIds.some(id => !unitIds.has(id) && !(original.stocktakeUnitIds?.includes(id) && !original.units?.some(unit => unit.id === id)))) return "Choose saved item units for counting.";
  }
  const priceChanged = (blank(draft.price) ? null : Number(draft.price)) !== (blank(original.price) ? null : Number(original.price)) || text(draft.priceUnitId) !== text(original.priceUnitId);
  if (priceChanged && !blank(draft.price) && blank(draft.priceUnitId)) return "Choose the unit the price applies to.";
  return null;
}

function normalizedDraft(draft, original, catalog) {
  const result = structuredClone(draft);
  result.name = draft.name.trim();
  result.productDescription = result.name;
  for (const field of ['internalName', 'description', 'sku', 'brand']) if (own(result, field)) result[field] = text(result[field]);
  for (const field of ['active', 'supplierActive', 'trackInventory']) if (own(result, field)) result[field] = boolean(result[field]);
  if (own(result, 'categoryId')) {
    result.categoryId = text(result.categoryId);
    result.categoryName = (catalog.categories || []).find(category => category.id === result.categoryId)?.name ?? null;
  }
  for (const field of ['baseUnitId', 'orderingUnitId', 'receivingUnitId', 'stocktakeUnitId', 'priceUnitId']) if (own(result, field)) result[field] = text(result[field]);
  if (own(result, 'yieldPercent')) result.yieldPercent = blank(result.yieldPercent) ? null : Number(result.yieldPercent);
  result.price = blank(result.price) ? null : Number(result.price);
  if (result.stocktakeUnitId !== original.stocktakeUnitId) result.stocktakeUnitIds = result.stocktakeUnitId ? [result.stocktakeUnitId] : [];
  const stocktakeIds = result.stocktakeUnitIds ?? (result.stocktakeUnitId ? [result.stocktakeUnitId] : []);
  result.units = result.units.map(unit => {
    const registered = (catalog.units || []).find(registered => registered.id === unit.id);
    return {
      ...unit, ...(registered ? { name: registered.name, abbreviation: registered.abbreviation ?? registered.code ?? unit.abbreviation } : {}),
      factor: Number(unit.factor), base: unit.id === result.baseUnitId,
      ordering: unit.id === result.orderingUnitId, receiving: unit.id === result.receivingUnitId, stocktake: stocktakeIds.includes(unit.id),
    };
  });
  for (const [field, association] of [['orderingUnitId', 'orderingItemUnitId'], ['receivingUnitId', 'receivingItemUnitId']]) {
    if (own(result, association)) result[association] = result.units.find(unit => unit.id === result[field])?.itemUnitId ?? (result[field] === original[field] ? original[association] : null);
  }
  return result;
}

export function saveSupplierDraft(local, original, draft, catalog, { storage, now } = {}) {
  const error = validateSupplierDraft(draft, original, catalog);
  if (error) throw new Error(error);
  const item = normalizedDraft(draft, original, catalog);
  const at = timestamp(now);
  const vendor = { ...structuredClone(local.supplierItemEdits?.[original.supplierItemId] || {}), ...pick(item, vendorFields), itemId: original.itemId };
  const amount = item.price;
  const unitId = text(item.priceUnitId);
  if (amount !== (blank(original.price) ? null : Number(original.price)) || unitId !== text(original.priceUnitId)) {
    const scope = scopeOf(draft.priceScope ?? original.priceScope);
    vendor.pricesByLocation = { ...vendor.pricesByLocation, [scope]: { amount, unitId } };
  }
  const next = {
    ...local,
    itemEdits: { ...local.itemEdits, [original.itemId]: pick(item, commonFields) },
    supplierItemEdits: { ...local.supplierItemEdits, [original.supplierItemId]: vendor },
    audit: [{ id: `supplier-item-${original.supplierItemId}-${at}`, text: `Item ${item.name} updated locally at ${original.supplierName || 'supplier'}`, at }, ...(local.audit || [])],
  };
  // Do not expose a new state until browser persistence has succeeded.
  saveLocal(next, storage);
  return { local: next, item: supplierItemWithEdits({ ...original, priceScope: scopeOf(draft.priceScope ?? original.priceScope) }, next) };
}

export function restoreSupplierDraft(local, row, { storage, now, catalog } = {}) {
  const originalUnits = new Set((row.units || []).map(unit => unit.id));
  const removedUnits = new Set((local.itemEdits?.[row.itemId]?.units || []).filter(unit => !originalUnits.has(unit.id)).map(unit => unit.id));
  const aliases = new Set((catalog?.items || []).filter(item => item.itemId === row.itemId).map(item => item.supplierItemId));
  const wouldOrphanAlias = Object.entries(local.supplierItemEdits || {}).some(([id, edit]) => id !== row.supplierItemId && (edit.itemId === row.itemId || aliases.has(id)) && vendorUnitReferences(edit).some(unitId => removedUnits.has(unitId)));
  if (wouldOrphanAlias) throw new Error("Unable to restore: another supplier of this item still uses a local conversion. Update that supplier’s ordering, receiving, or local price unit first.");
  const itemEdits = { ...local.itemEdits }, supplierItemEdits = { ...local.supplierItemEdits };
  delete itemEdits[row.itemId];
  delete supplierItemEdits[row.supplierItemId];
  const at = timestamp(now);
  const next = {
    ...local, itemEdits, supplierItemEdits,
    audit: [{ id: `supplier-item-restore-${row.supplierItemId}-${at}`, text: `Original details for ${row.name} restored locally`, at }, ...(local.audit || [])],
  };
  saveLocal(next, storage);
  return { local: next, item: supplierItemWithEdits(row, next) };
}
