// Recipe edits are version-bound local drafts. Never mutate the read-only snapshot.
export function recipeWithEdits(recipe, edits = {}) {
  const draft = edits[recipe.id];
  const matching = draft && draft.versionId === recipe.versionId && Array.isArray(draft.components);
  return {
    ...recipe,
    components: matching ? draft.components : recipe.components || [],
    editedLocally: Boolean(matching),
    editedAt: matching ? draft.updatedAt : null,
    staleLocalEdit: Boolean(draft && !matching),
  };
}

export function componentFromItem(item, unit, {id, locationId = null} = {}) {
  return {
    id, itemId: item.id, itemUnitId: unit.itemUnitId, uomId: unit.id,
    name: item.name, internalName: item.internalName, sku: item.sku || null,
    quantity: 1, uom: unit.abbreviation || unit.name, uomName: unit.name, unitFactor: unit.factor ?? null,
    kind: (item.categoryName || item.category) === 'Packaging' ? 'packaging' : 'ingredient',
    notes: null, wastePercent: 0, locationId, sortOrder: 0,
    subRecipeId: item.subRecipeId || null, subRecipeVersionId: null,
  };
}

export function validateRecipeComponents(recipe, components, catalog, recipes = [], edits = {}) {
  if (!recipe.componentsLoaded || !recipe.versionId) return "Load this version’s ingredients before editing.";
  if (!Array.isArray(components)) return "The ingredient list is invalid.";
  const existing = new Map((recipe.components || []).map(c => [c.id, c]));
  const ids = new Set();
  for (const c of components) {
    if (!c?.id || ids.has(c.id)) return "The recipe has a duplicate line.";
    ids.add(c.id);
    if (!['number', 'string'].includes(typeof c.quantity) || String(c.quantity).trim() === '' || !Number.isFinite(Number(c.quantity)) || Number(c.quantity) <= 0) {
      return "Enter a quantity greater than zero for each item.";
    }
    const item = catalog.find(i => i.id === c.itemId);
    if (!item) return "An item was not found in the catalog.";
    const unit = item.units?.find(u => u.itemUnitId === c.itemUnitId && u.id === c.uomId);
    const original = existing.get(c.id);
    // Preserve legacy units when unchanged; do not invent or silently replace conversions.
    const legacyUnit = original && original.itemId === c.itemId && original.itemUnitId === c.itemUnitId && original.uomId === c.uomId;
    if (!unit && !legacyUnit) return `Choose a saved unit for ${item.name}.`;
    if (!original && !item.active) return "Inactive items cannot be added to the recipe.";
    if (!['ingredient', 'packaging'].includes(c.kind) && c.kind !== original?.kind) return "Invalid component type.";
  }
  const byOutput = new Map(recipes.filter(r => r.outputItemId).map(r => [r.outputItemId, r]));
  const visit = (r, path) => {
    if (path.has(r.id)) return true;
    const nextPath = new Set(path).add(r.id);
    const lines = r.id === recipe.id ? components : recipeWithEdits(r, edits).components;
    return lines.some(c => {
      const child = byOutput.get(c.itemId);
      return child ? visit(child, nextPath) : false;
    });
  };
  if (visit(recipe, new Set())) return "These ingredients create a circular reference between prep items. Remove the item that refers back to this recipe.";
  return null;
}

export function saveRecipeDraft(local, recipe, components, catalog, recipes, storage, at = new Date().toISOString()) {
  const error = validateRecipeComponents(recipe, components, catalog, recipes, local.recipeEdits || {});
  if (error) throw new Error(error);
  const normalized = components.map((c, index) => ({...structuredClone(c), quantity: Number(c.quantity), sortOrder: index + 1}));
  const next = {
    ...local,
    recipeEdits: {...(local.recipeEdits || {}), [recipe.id]: {recipeId: recipe.id, versionId: recipe.versionId, updatedAt: at, components: normalized}},
    audit: [{id: `recipe-${recipe.id}-${at}`, text: `Ingredients for ${recipe.name} updated locally`, at}, ...(local.audit || [])],
  };
  // Commit state only after persistence succeeds, so a quota error cannot pretend to save.
  storage(next);
  return next;
}
