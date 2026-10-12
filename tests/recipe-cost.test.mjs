import test from 'node:test';
import assert from 'node:assert/strict';
import {recipeCost,costInfo} from '../src/recipe-cost-model.js';
import {recipeCostFixture} from './fixtures/recipe-cost.mjs';
test('synthetic ingredient cost preserves the source and applies quantity and waste', () => {
  const {recipe, data} = recipeCostFixture();
  const before = structuredClone(data);
  assert.equal(recipeCost(recipe, 'store', data).total, 6);
  assert.deepEqual(data, before);
  const withWaste = structuredClone(recipe); withWaste.components[0].wastePercent = 0.25;
  assert.equal(recipeCost(withWaste, 'store', data).total, 8);
});
test('missing conversion and ambiguous supplier prices produce unknown cost', () => {
  const {recipe, data} = recipeCostFixture();
  const other = structuredClone(data.supplierCatalog.items[0]);
  other.supplierItemId = 'other'; other.currentPrices[0].amount = 4;
  data.supplierCatalog.items.push(other);
  assert.equal(recipeCost(recipe, 'store', data).total, null);
  data.supplierCatalog.items.pop(); data.ingredientItems[0].units = [];
  assert.equal(recipeCost(recipe, 'store', data).total, null);
});
test('empty recipes and circular preparation references cannot appear free', () => {
  const {recipe, data} = recipeCostFixture();
  assert.equal(recipeCost({...recipe, components: []}, 'store', data).total, null);
  assert.equal(recipeCost(recipe, 'store', data, {}, new Set([recipe.id])).total, null);
});

test('optimal price divides ingredient cost by target and passes packaging through at cost',()=>{
 const {recipe,data}=recipeCostFixture();recipe.components.push({...recipe.components[0],quantity:1,kind:'packaging'});data.costInputs={settings:[{locationId:'store',foodTarget:.25}]};
 const x=costInfo(recipe,'store',data);assert.equal(x.ingredients,6);assert.equal(x.packaging,2);assert.equal(x.total,8);assert.equal(x.optimalPrice,26);
 data.costInputs.settings[0].foodTarget=0;assert.equal(costInfo(recipe,'store',data).optimalPrice,null);
});
