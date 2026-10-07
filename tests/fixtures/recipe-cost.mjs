// Synthetic records only. Prices and quantities are chosen for hand-checkable totals.
export function recipeCostFixture() {
  const unit = {id: 'each', itemUnitId: 'item-each', factor: 1, name: 'Each'};
  const recipe = {id: 'recipe', versionId: 'v1', type: 'menu', componentsLoaded: true, components: [{itemId: 'ingredient', itemUnitId: unit.itemUnitId, uomId: unit.id, quantity: 3, kind: 'ingredient'}]};
  const data = {
    recipes: [recipe],
    ingredientItems: [{id: 'ingredient', name: 'Test ingredient', type: 'purchased', units: [unit]}],
    supplierCatalog: {items: [{supplierItemId: 'supplier-item', itemId: 'ingredient', units: [unit], stores: [{id: 'store', active: true}], currentPrices: [{amount: 2, unitId: 'each', locationId: 'store', status: 'approved'}]}]},
  };
  return {recipe, data};
}
