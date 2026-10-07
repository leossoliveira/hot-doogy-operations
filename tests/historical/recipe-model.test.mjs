import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LOCAL_KEY, loadLocal, saveLocal } from '../../src/model.js';
import { componentFromItem, recipeWithEdits, saveRecipeDraft, validateRecipeComponents } from '../../src/recipe-model.js';

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-10-04T17:00:00.000Z';
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
  const gram = { id: uuid(101), itemUnitId: uuid(201), name: 'Gram', conversionFactor: 1 };
  const each = { id: uuid(102), itemUnitId: uuid(202), name: 'Each', conversionFactor: 1 };
  const sauce = { id: uuid(1), name: 'Sauce', internalName: 'Sauce prep', sku: 'SAUCE', active: true, category: 'Preparations', subRecipeId: uuid(401), units: [gram] };
  const box = { id: uuid(2), name: 'Box', internalName: 'Paper box', active: true, category: 'Packaging', units: [each] };
  const component = {
    ...componentFromItem(sauce, gram, { id: uuid(301), locationId: uuid(501) }),
    quantity: 12.345678, sortOrder: 8, notes: 'Keep refrigerated', wastePercent: 0.025,
    subRecipeId: uuid(401), subRecipeVersionId: uuid(601),
  };
  const recipe = { id: uuid(402), versionId: uuid(602), name: 'Hot dog', componentsLoaded: true, components: [component] };
  return { recipe, catalog: [sauce, box], sauce, box, gram, each, component };
};

const details = JSON.parse(await readFile(new URL('../../public/data/recipe-components.json', import.meta.url), 'utf8'));
const snapshot = JSON.parse(await readFile(new URL('../../public/data/snapshot.json', import.meta.url), 'utf8'));
test('all exported compositions match the selected snapshot versions and registered item units', () => {
  const originalVersions = new Map(snapshot.recipes.map(recipe => [recipe.id, recipe.versionId]));
  assert.equal(details.recipes.length, 144);
  assert.equal(details.recipes.flatMap(recipe => recipe.components).length, 321);
  assert.equal(new Set(details.recipes.map(recipe => recipe.id)).size, 144);
  const units = new Set(details.units.map(unit => unit.id));
  for (const recipe of details.recipes) {
    assert.equal(recipe.versionId, originalVersions.get(recipe.id), recipe.name);
    assert.equal(recipe.componentsLoaded, true, recipe.name);
    assert.equal(validateRecipeComponents(recipe, recipe.components, details.ingredientItems, details.recipes), null, recipe.name);
    for (const component of recipe.components) {
      const item = details.ingredientItems.find(item => item.id === component.itemId);
      assert.ok(item, `${recipe.name}: catalog item exists`);
      assert.ok(item.units.some(unit => unit.id === component.uomId && unit.itemUnitId === component.itemUnitId), `${recipe.name}: unit belongs to item`);
      assert.ok(units.has(component.uomId), `${recipe.name}: actual unit UUID exists`);
      assert.ok(['ingredient', 'packaging'].includes(component.kind), `${recipe.name}: component kind`);
      assert.ok(component.quantity > 0 && Number.isFinite(component.quantity), `${recipe.name}: positive finite quantity`);
      assert.ok(component.wastePercent >= 0 && component.wastePercent < 1, `${recipe.name}: raw waste fraction`);
      if (component.subRecipeId) {
        assert.ok(details.recipes.some(child => child.id === component.subRecipeId && child.outputItemId === component.itemId), `${recipe.name}: preparation output matches`);
        assert.equal(component.subRecipeVersionId, null, `${recipe.name}: no invented version pin`);
      }
    }
  }
  assert.deepEqual(details.recipes.filter(recipe => recipe.components.length === 0).map(recipe => recipe.name).sort(), ['Açaí Smoothie', 'Fountain Soda (Fountain)']);
});

test('actual Bacon Cheddar Doogy can change quantity and retain all exported line metadata', () => {
  const recipe = details.recipes.find(recipe => recipe.id === 'c86577d9-fcdb-4934-899a-1989afa0a046');
  const before = structuredClone(recipe);
  freeze(recipe);
  assert.deepEqual(recipe.components.map(component => [component.internalName, component.quantity, component.uom]), [
    ['All Beef Hot Dog', 1, 'ea'], ['Bacon Bits', 1, 'scoop'], ['Cheddar Sauce 32 oz', 1, 'scoop'], ['Hot Dog Bun (Regular)', 1, 'ea'],
  ]);
  const components = structuredClone(recipe.components);
  components[2].quantity = '1.25';
  const saved = saveRecipeDraft({ recipeEdits: {}, audit: [] }, recipe, components, details.ingredientItems, details.recipes, () => {}, at);
  assert.deepEqual(recipe, before);
  assert.deepEqual(saved.recipeEdits[recipe.id].components, before.components.map((component, index) => ({ ...component, quantity: index === 2 ? 1.25 : component.quantity, sortOrder: index + 1 })));
});

test('actual catalog packaging uses categoryName when adding a recipe component', () => {
  const item = details.ingredientItems.find(item => item.active && item.categoryName === 'Packaging');
  assert.ok(item);
  assert.equal(item.category, undefined);
  const unit = item.units.find(unit => unit.base);
  const component = componentFromItem(item, unit, { id: uuid(999), locationId: null });
  assert.equal(component.kind, 'packaging');
  assert.equal(component.itemUnitId, unit.itemUnitId);
  assert.equal(component.uomId, unit.id);
  const recipe = details.recipes.find(recipe => recipe.name === 'Bacon Cheddar Doogy');
  assert.equal(validateRecipeComponents(recipe, [...recipe.components, component], details.ingredientItems, details.recipes), null);
});
