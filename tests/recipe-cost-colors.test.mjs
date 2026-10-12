import test from 'node:test';import assert from 'node:assert/strict';
import {foodCostTone} from '../src/recipe-cost-ui.js';
test('food cost colors follow displayed percentage boundaries and leave unavailable neutral',()=>{
 for(const [value,tone] of [[0,'good'],[25,'good'],[25.01,'warning'],[25.99,'warning'],[26,'high'],[100,'high'],[25.999,'high'],[null,''],[NaN,'']])assert.equal(foodCostTone(value),tone);
});
