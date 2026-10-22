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
test('waste loss value: purchased items use supplier price without ingredient yield, prep items use recipe cost per yield', async () => {
  const {itemQuantityValue} = await import('../src/recipe-cost-model.js');
  const {recipe, data} = recipeCostFixture();
  const each = {id: 'each', itemUnitId: 'item-each', factor: 1, name: 'Each'};
  data.ingredientItems[0].units.push({id: 'case', itemUnitId: 'item-case', factor: 12, name: 'Case'});
  data.ingredientItems[0].yieldPercent = 50;
  assert.equal(itemQuantityValue({itemId: 'ingredient', itemUnitId: 'item-case', quantity: 1, locationId: 'store'}, data), 24, '1 case = 12 × $2, yield not applied');
  // Prep item: its recipe uses 3 ingredients ($6) and yields 2 trays; 1 tray wasted = $3.
  const prep = {...recipe, id: 'prep-recipe', type: 'prep', outputItemId: 'prep', yieldQuantity: 2, yieldItemUnitId: 'prep-tray'};
  data.recipes.push(prep);
  data.ingredientItems[0].yieldPercent = null;
  data.ingredientItems.push({id: 'prep', name: 'Prep', type: 'prepared', subRecipeId: 'prep-recipe', units: [{id: 'tray', itemUnitId: 'prep-tray', factor: 1, name: 'Tray'}]});
  assert.equal(itemQuantityValue({itemId: 'prep', itemUnitId: 'prep-tray', quantity: 1, locationId: 'store'}, data), 3);
  assert.equal(itemQuantityValue({itemId: 'ingredient', itemUnitId: 'item-each', quantity: 1, locationId: 'elsewhere'}, data), null, 'no price at that store');
  assert.equal(itemQuantityValue({itemId: 'ingredient', itemUnitId: 'missing', quantity: 1, locationId: 'store'}, data), null, 'unknown unit');
  assert.equal(each.factor, 1);
});
test('waste uses latest approved available supplier cost, while recipe costing remains strict',async()=>{
 const {itemQuantityValue}=await import('../src/recipe-cost-model.js');const {data,recipe}=recipeCostFixture();
 data.supplierCatalog.items[0].currentPrices[0].date='2026-09-12';
 const other=structuredClone(data.supplierCatalog.items[0]);other.supplierItemId='other';other.currentPrices[0].amount=6;other.currentPrices[0].date='2026-09-20';data.supplierCatalog.items.push(other);
 const input={itemId:'ingredient',itemUnitId:'item-each',quantity:2,locationId:'store',pricePolicy:'latest-approved'};
 assert.equal(itemQuantityValue(input,data),12);assert.equal(recipeCost(recipe,'store',data).total,null);
 other.currentPrices[0].status='pending';assert.equal(itemQuantityValue(input,data),4,'pending price never used');
 other.currentPrices[0].status='approved';other.currentPrices[0].locationId='other-store';assert.equal(itemQuantityValue(input,data),4,'supplier without a price here does not block available price');
 other.currentPrices[0].locationId='store';other.currentPrices[0].date='2026-09-12';assert.equal(itemQuantityValue(input,data),null,'conflicting prices on same date remain unknown');
});
test('waste converts case and box supplier prices to each, scoped to each location',async()=>{
 const {itemQuantityValue}=await import('../src/recipe-cost-model.js');const {data}=recipeCostFixture();
 const item=data.ingredientItems[0];item.units.push({id:'box',itemUnitId:'box-unit',factor:12},{id:'case',itemUnitId:'case-unit',factor:96});
 data.supplierCatalog.items=[
  {itemId:item.id,supplierItemId:'case-vendor',units:item.units,stores:[{id:'store'},{id:'second'}],currentPrices:[{amount:38.75,unitId:'case',locationId:null,status:'approved',date:'2026-09-12'}]},
  {itemId:item.id,supplierItemId:'box-vendor',units:item.units,stores:[{id:'store'},{id:'second'}],currentPrices:[{amount:6.99,unitId:'box',locationId:'store',status:'approved',date:'2026-09-20'}]}
 ];
 const input={itemId:item.id,itemUnitId:'box-unit',quantity:1,locationId:'store',pricePolicy:'latest-approved'};
 assert.equal(itemQuantityValue(input,data),6.99);
 assert.equal(itemQuantityValue({...input,itemUnitId:'item-each',quantity:24,locationId:'second'},data),38.75/4);
});
