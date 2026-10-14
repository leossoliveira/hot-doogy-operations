import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sortFoodCostRows} from '../src/food-cost.js';

test('food cost ordena por nome em ordem alfabética', () => {
  const rows = [{recipe: {name: 'Hot Dog'}}, {recipe: {name: 'Batata'}}, {recipe: {name: 'Cebola'}}];
  const resultado = sortFoodCostRows(rows, 'name').map(r => r.recipe.name);
  assert.deepEqual(resultado, ['Batata', 'Cebola', 'Hot Dog']);
});
