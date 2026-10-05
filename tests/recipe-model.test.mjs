import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LOCAL_KEY, loadLocal, saveLocal } from '../src/model.js';
import { componentFromItem, recipeWithEdits, saveRecipeDraft, validateRecipeComponents } from '../src/recipe-model.js';

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-10-04T17:00:00.000Z';
const details = JSON.parse(await readFile(new URL('../public/data/recipe-components.json', import.meta.url), 'utf8'));
const snapshot = JSON.parse(await readFile(new URL('../public/data/snapshot.json', import.meta.url), 'utf8'));
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

test('editing quantities preserves recipe metadata and the immutable source and form', () => {
  const { recipe, catalog } = fixture();
  const original = structuredClone(recipe);
  freeze(recipe);
  const components = structuredClone(recipe.components);
  components[0].quantity = '7.000123';
  const entered = structuredClone(components);
  freeze(components);
  const local = freeze({ recipeEdits: {}, orders: [{ id: 'existing-order' }], audit: [{ id: 'old-audit' }] });
  let persisted;
  const saved = saveRecipeDraft(local, recipe, components, catalog, [], value => { persisted = value; }, at);
  const effective = recipeWithEdits(recipe, saved.recipeEdits);
  assert.deepEqual(recipe, original);
  assert.deepEqual(components, entered);
  assert.deepEqual(local.recipeEdits, {});
  assert.equal(saved, persisted);
  assert.equal(effective.components[0].quantity, 7.000123);
  assert.equal(effective.components[0].sortOrder, 1);
  assert.deepEqual(effective.components[0], { ...original.components[0], quantity: 7.000123, sortOrder: 1 });
  assert.equal(effective.editedLocally, true);
  assert.equal(effective.editedAt, at);
  assert.equal(effective.staleLocalEdit, false);
  assert.equal(saved.audit.length, 2);
  assert.deepEqual(saved.orders, local.orders);
  assert.notEqual(effective.components[0], components[0]);
});

test('adding and removing items saves the full edited composition with real unit identities', () => {
  const { recipe, catalog, box, each } = fixture();
  const added = componentFromItem(box, each, { id: uuid(302), locationId: uuid(502) });
  assert.deepEqual({ itemId: added.itemId, itemUnitId: added.itemUnitId, uomId: added.uomId, kind: added.kind, locationId: added.locationId }, {
    itemId: box.id, itemUnitId: each.itemUnitId, uomId: each.id, kind: 'packaging', locationId: uuid(502),
  });
  const first = saveRecipeDraft({ recipeEdits: {}, audit: [] }, recipe, [...recipe.components, added], catalog, [], () => {}, at);
  const second = saveRecipeDraft(first, recipe, [{ ...added, quantity: 2 }], catalog, [], () => {}, at);
  assert.equal(first.recipeEdits[recipe.id].components.length, 2);
  assert.deepEqual(second.recipeEdits[recipe.id].components.map(c => [c.itemId, c.quantity, c.sortOrder]), [[box.id, 2, 1]]);
  assert.equal(recipe.components.length, 1);
  assert.equal(recipe.components[0].itemId, catalog[0].id);
});

test('removing every ingredient is a valid saved empty composition', () => {
  const { recipe, catalog } = fixture();
  assert.equal(validateRecipeComponents(recipe, [], catalog), null);
  const saved = saveRecipeDraft({ recipeEdits: {} }, recipe, [], catalog, [], () => {}, at);
  const effective = recipeWithEdits(recipe, saved.recipeEdits);
  assert.deepEqual(effective.components, []);
  assert.equal(effective.editedLocally, true);
  assert.equal(recipe.components.length, 1);
});

test('quantities must be finite positive numbers and cannot coerce booleans or objects', () => {
  const { recipe, catalog, component } = fixture();
  for (const quantity of [0, -1, '', '  ', 'abc', '1,5', null, undefined, true, false, [], [1], {}, NaN, Infinity, -Infinity, 'Infinity']) {
    assert.equal(typeof validateRecipeComponents(recipe, [{ ...component, quantity }], catalog), 'string', String(quantity));
  }
  for (const quantity of [1, 0.000001, '1.25', ' 2.5 ', '1e-7']) {
    assert.equal(validateRecipeComponents(recipe, [{ ...component, quantity }], catalog), null, String(quantity));
  }
});

test('unit membership requires the registered itemUnitId and uomId pair', () => {
  const { recipe, catalog, component, gram, each } = fixture();
  for (const changes of [
    { itemUnitId: each.itemUnitId, uomId: each.id },
    { itemUnitId: gram.itemUnitId, uomId: each.id },
    { itemUnitId: each.itemUnitId, uomId: gram.id },
    { itemUnitId: gram.itemUnitId, uomId: 'Gram' },
    { itemUnitId: null, uomId: gram.id },
  ]) {
    assert.match(validateRecipeComponents(recipe, [{ ...component, ...changes }], catalog), /unidade cadastrada/);
  }
  assert.equal(validateRecipeComponents(recipe, [{ ...component, quantity: 2 }], catalog), null);
});

test('legacy units remain editable without permitting another item to borrow them', () => {
  const { recipe, catalog, component, box } = fixture();
  const withoutLegacyUnit = catalog.map(item => ({ ...item, units: item.id === component.itemId ? [] : item.units }));
  assert.equal(validateRecipeComponents(recipe, [{ ...component, quantity: 3 }], withoutLegacyUnit), null);
  assert.match(validateRecipeComponents(recipe, [{ ...component, itemId: box.id }], withoutLegacyUnit), /unidade cadastrada/);
  assert.match(validateRecipeComponents(recipe, [{ ...component, id: uuid(999) }], withoutLegacyUnit), /unidade cadastrada/);
});

test('invalid items, duplicate rows and inactive new items never reach persistence', () => {
  const { recipe, catalog, component, box, each } = fixture();
  const invalidCompositions = [
    null,
    [{ ...component, id: null }],
    [component, { ...component }],
    [{ ...component, itemId: uuid(999) }],
    [{ ...component, kind: 'unknown' }],
  ];
  let persisted = 0;
  for (const components of invalidCompositions) {
    assert.throws(() => saveRecipeDraft({ recipeEdits: {} }, recipe, components, catalog, [], () => { persisted += 1; }, at));
  }
  const inactiveCatalog = catalog.map(item => ({ ...item, active: false }));
  assert.equal(validateRecipeComponents(recipe, [component], inactiveCatalog), null);
  assert.match(validateRecipeComponents(recipe, [componentFromItem(box, each, { id: uuid(303) })], inactiveCatalog), /inativos/);
  assert.equal(persisted, 0);
});

test('editing is blocked until a version and its components have been loaded', () => {
  const { recipe, catalog, component } = fixture();
  for (const changes of [{ versionId: null }, { versionId: '' }, { componentsLoaded: false }, { componentsLoaded: undefined }]) {
    assert.match(validateRecipeComponents({ ...recipe, ...changes }, [component], catalog), /composição desta versão/);
  }
});

test('local drafts apply only to the matching recipe version and flag stale drafts', () => {
  const { recipe, component } = fixture();
  const draft = { versionId: recipe.versionId, components: [{ ...component, quantity: 9 }], updatedAt: at };
  assert.equal(recipeWithEdits(recipe, { [recipe.id]: draft }).components[0].quantity, 9);
  const nextVersion = { ...recipe, versionId: uuid(603) };
  const stale = recipeWithEdits(nextVersion, { [recipe.id]: draft });
  assert.deepEqual(stale.components, recipe.components);
  assert.equal(stale.staleLocalEdit, true);
  assert.equal(stale.editedLocally, false);
  assert.equal(stale.editedAt, null);
  const otherRecipe = { ...recipe, id: uuid(403) };
  assert.equal(recipeWithEdits(otherRecipe, { [recipe.id]: draft }).editedLocally, false);
  assert.equal(recipeWithEdits(recipe, { [recipe.id]: { ...draft, components: 'invalid' } }).staleLocalEdit, true);
  assert.deepEqual(recipeWithEdits({ id: uuid(404) }).components, []);
});

test('recipe edits survive saveLocal and loadLocal with metadata and other local work', () => {
  const { recipe, catalog, component } = fixture();
  const fake = storage();
  fake.setItem('unrelated', 'keep');
  const local = loadLocal(fake);
  local.orders.push({ id: 'order-to-keep' });
  const saved = saveRecipeDraft(local, recipe, [{ ...component, quantity: '3.75' }], catalog, [], value => saveLocal(value, fake), at);
  const restored = loadLocal(fake);
  assert.deepEqual(restored, saved);
  assert.equal(restored.recipeEdits[recipe.id].components[0].wastePercent, 0.025);
  assert.equal(recipeWithEdits(recipe, restored.recipeEdits).components[0].quantity, 3.75);
  assert.equal(fake.getItem('unrelated'), 'keep');
  assert.equal(JSON.parse(fake.getItem(LOCAL_KEY)).recipeEdits[recipe.id].versionId, recipe.versionId);
});

test('failed persistence leaves prior drafts, source recipe and audit unchanged', () => {
  const { recipe, catalog, component } = fixture();
  const local = saveRecipeDraft({ recipeEdits: {}, audit: [] }, recipe, [{ ...component, quantity: 4 }], catalog, [], () => {}, at);
  const before = structuredClone(local);
  freeze(local);
  assert.throws(() => saveRecipeDraft(local, recipe, [], catalog, [], () => { throw new Error('Quota exceeded'); }, at), /Quota exceeded/);
  assert.deepEqual(local, before);
  assert.equal(recipeWithEdits(recipe, local.recipeEdits).components[0].quantity, 4);
  assert.equal(recipe.components[0].quantity, 12.345678);
});

const preparations = () => {
  const items = [1, 2, 3, 4].map(n => ({ id: uuid(n), name: `Prep ${n}`, active: true, category: 'Preparations', units: [{ id: uuid(100), itemUnitId: uuid(200 + n), name: 'Gram' }] }));
  const line = n => componentFromItem(items[n - 1], items[n - 1].units[0], { id: uuid(300 + n) });
  const recipes = items.map((item, index) => ({ id: uuid(400 + index), versionId: uuid(600 + index), name: item.name, outputItemId: item.id, componentsLoaded: true, components: [] }));
  return { catalog: items, recipes, line };
};

test('preparation cycles resolve component item IDs through recipe outputItemId', () => {
  const { catalog, recipes, line } = preparations();
  recipes[1].components = [line(3)];
  recipes[2].components = [line(1)];
  assert.match(validateRecipeComponents(recipes[0], [line(1)], catalog, recipes), /circular/);
  assert.match(validateRecipeComponents(recipes[0], [line(2)], catalog, recipes), /circular/);
  recipes[2].components = [];
  assert.equal(validateRecipeComponents(recipes[0], [line(2)], catalog, recipes), null);
  // A shared descendant in two independent branches is not a cycle.
  recipes[1].components = [line(4)];
  recipes[2].components = [line(4)];
  assert.equal(validateRecipeComponents(recipes[0], [line(2), line(3)], catalog, recipes), null);
});

test('cycle validation considers current local drafts and ignores stale drafts', () => {
  const { catalog, recipes, line } = preparations();
  const [first, second] = recipes;
  const edits = { [second.id]: { versionId: second.versionId, components: [line(1)] } };
  assert.match(validateRecipeComponents(first, [line(2)], catalog, recipes, edits), /circular/);
  edits[second.id].versionId = uuid(999);
  assert.equal(validateRecipeComponents(first, [line(2)], catalog, recipes, edits), null);
  second.components = [line(1)];
  edits[second.id] = { versionId: second.versionId, components: [] };
  assert.equal(validateRecipeComponents(first, [line(2)], catalog, recipes, edits), null);
});

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
