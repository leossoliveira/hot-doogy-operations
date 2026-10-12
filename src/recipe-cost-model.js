import {supplierItemWithEdits, resolveSupplierPrice} from './supplier-model.js';
import {recipeWithEdits} from './recipe-model.js';
import {ingredientItemsWithEdits} from './catalog-overlay.js';

const valid = x => x !== null && x !== undefined && x !== '' && Number.isFinite(Number(x));
const positive = x => valid(x) && Number(x) > 0;
const uniqueValue = values => values.length && values.every(valid) && new Set(values.map(Number)).size === 1 ? Number(values[0]) : null;

// All costs refer to the displayed version and the selected store. Missing inputs
// invalidate the total rather than understating it by summing only priced lines.
export function recipeCost(recipe, locationId, data, local = {}, path = new Set()) {
  const r = recipeWithEdits(recipe, local.recipeEdits);
  const issues = [];
  let ingredients = 0, packaging = 0;
  if (path.has(r.id)) return {total: null, issues: ["Circular prep item reference."]};
  const nextPath = new Set(path).add(r.id);
  const scope = r.type === 'prep' && r.productionLocationId || locationId;
  const items = ingredientItemsWithEdits(data.ingredientItems || [], local);
  const lines = r.components.filter(c => !c.locationId || c.locationId === scope);
  if (!r.componentsLoaded || !lines.length) issues.push("Ingredients are unavailable for this location.");
  for (const c of lines) {
    const item = items.find(i => i.id === c.itemId);
    const name = item?.internalName || c.internalName || c.name || "Ingredient";
    const unit = item?.units?.find(u => u.itemUnitId === c.itemUnitId && u.id === c.uomId);
    if (!item || !positive(unit?.factor) || !positive(c.quantity)) {issues.push(`${name}: quantity or conversion is missing.`); continue;}
    const waste = c.wastePercent ?? 0;
    if (!valid(waste) || waste < 0 || waste >= 1) {issues.push(`${name}: invalid waste value.`); continue;}
    const qty = Number(c.quantity) * Number(unit.factor) / (1 - Number(waste));
    const childId = c.subRecipeId || item.subRecipeId;
    if (childId || item.type === 'prepared') {
      const child = data.recipes.find(x => x.id === childId && (!c.subRecipeVersionId || x.versionId === c.subRecipeVersionId));
      const output = items.find(i => i.id === child?.outputItemId);
      const yieldUnit = output?.units?.find(u => u.itemUnitId === child.yieldItemUnitId);
      if (!child || child.outputItemId !== item.id || !positive(child.yieldQuantity) || !positive(yieldUnit?.factor)) {issues.push(`${name}: recipe or yield has no valid conversion.`); continue;}
      const cost = recipeCost(child, scope, data, local, nextPath);
      if (cost.total == null) {issues.push(...cost.issues.map(issue => `${name} → ${issue}`)); continue;}
      const scale = qty / (Number(child.yieldQuantity) * Number(yieldUnit.factor));
      if (c.kind === 'packaging') packaging += cost.total * scale;
      else {ingredients += cost.ingredients * scale; packaging += cost.packaging * scale;}
    } else {
      const vendors = (data.supplierCatalog?.items || []).map(row => supplierItemWithEdits(row, local)).filter(row => row.itemId === item.id && row.active !== false && row.supplierActive !== false && row.supplierBusinessActive !== false && row.stores?.some(s => s.id === scope && s.active !== false && s.locationActive !== false));
      const costs = vendors.map(row => {
        const price = resolveSupplierPrice(row, scope);
        const priceUnit = row.units.find(u => u.id === price.unitId);
        return valid(price.amount) && price.amount >= 0 && positive(priceUnit?.factor) ? price.amount / Number(priceUnit.factor) : null;
      });
      const baseCost = uniqueValue(costs);
      if (baseCost == null) {issues.push(`${name}: missing approved price or conversion, or supplier costs differ.`); continue;}
      const yieldRatio = item.yieldPercent == null ? 1 : Number(item.yieldPercent) / 100;
      if (!(yieldRatio > 0 && yieldRatio <= 1)) {issues.push(`${name}: invalid ingredient yield.`); continue;}
      const cost = qty * baseCost / yieldRatio;
      if (c.kind === 'packaging') packaging += cost; else ingredients += cost;
    }
  }
  return {total: issues.length ? null : ingredients + packaging, ingredients: issues.length ? null : ingredients, packaging: issues.length ? null : packaging, issues: [...new Set(issues)], locationId: scope};
}

export function costInfo(recipe, locationId, data, local = {}) {
  const cost = recipeCost(recipe, locationId, data, local);
  const meta = data.costInputs || {};
  const menus = (meta.menus || []).filter(m => m.active && m.recipeId === recipe.id);
  const at = Date.parse(meta.extractedAt);
  const currentPrices = (meta.prices || []).filter(p => (!p.locationId || p.locationId === locationId) && Date.parse(p.effectiveFrom) <= at && (!p.effectiveTo || Date.parse(p.effectiveTo) > at));
  let values = menus.map(menu => {
    const prices = currentPrices.filter(p => p.menuItemId === menu.id);
    const scoped = prices.filter(p => p.locationId === locationId);
    return uniqueValue((scoped.length ? scoped : prices).map(p => p.amount));
  });
  let removal = false;
  if (recipe.type === 'modifier') {
    const modifierIds = (data.modifiers || []).filter(m => m.active && m.defaultRecipeId === recipe.id).map(m => m.id);
    const availableMenus = new Set(currentPrices.map(p => p.menuItemId));
    const rules = (data.modifierRules || []).filter(rule => availableMenus.has(rule.menuItemId) && (rule.recipeId === recipe.id || !rule.recipeId && modifierIds.includes(rule.modifierId)));
    values = rules.map(rule => rule.price);
    removal = rules.some(rule => rule.action === 'remove' || /remov/.test(rule.effectType));
  }
  const sellingPrice = uniqueValue(values);
  const itemMap = new Map((data.ingredientItems || []).map(i => [i.id, i]));
  const lines = recipeWithEdits(recipe, local.recipeEdits).components.filter(c => c.kind !== 'packaging' && (!c.locationId || c.locationId === locationId));
  const beverage = recipe.classification === 'beverage' || menus.length && menus.every(m => meta.beverageCategoryIds?.includes(m.categoryId)) || lines.length && lines.every(c => itemMap.get(c.itemId)?.categoryName === 'Beverage');
  const settings = meta.settings?.find(s => s.locationId === locationId);
  const target = beverage ? settings?.beverageTarget : settings?.foodTarget;
  const comparable = cost.total != null && sellingPrice != null && !removal;
  return {...cost, sellingPrice, removal, target: positive(target) ? target : null,
    optimalPrice: cost.total != null && positive(target) && !removal ? cost.ingredients / target : null,
    foodCostPercent: comparable && sellingPrice > 0 ? cost.total / sellingPrice * 100 : null,
    grossProfit: comparable ? sellingPrice - cost.total : null,
    grossMargin: comparable && sellingPrice > 0 ? (sellingPrice - cost.total) / sellingPrice * 100 : null,
    netProfit: null, netMargin: null,
    priceNote: sellingPrice == null ? "Price is not set or varies by menu." : recipe.type === 'modifier' ? "Additional price set in the menu mapping." : "Selling price set for this location.",
  };
}
