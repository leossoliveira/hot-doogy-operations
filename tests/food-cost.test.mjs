import test from 'node:test';
import assert from 'node:assert/strict';
import {foodCostRows,foodCostPage,sortFoodCostRows} from '../src/food-cost.js';
import {recipeCostFixture} from './fixtures/recipe-cost.mjs';
function fixture(){const {recipe,data}=recipeCostFixture();recipe.name='Test dish';data.locations=[{id:'store',name:'Store'}];data.meta={extractedAt:'2026-10-11T12:00:00Z'};data.costInputs={menus:[{id:'menu',recipeId:recipe.id,active:true,categoryId:'food'}],categories:[{id:'food',name:'Food'}],prices:[{menuItemId:'menu',locationId:'store',amount:20,effectiveFrom:'2026-01-01'}],settings:[{locationId:'store',foodTarget:0.25}]};return data;}
test('cost lists ignore unrelated supplier histories while preserving live price and active edits',()=>{
 const data=fixture();let unrelatedReads=0;
 for(let i=0;i<1000;i++)data.supplierCatalog.items.push({itemId:'unrelated-'+i,get priceHistory(){unrelatedReads++;return [];}});
 assert.equal(foodCostRows(data)[0].cost.total,6);assert.equal(unrelatedReads,0);
 data.supplierCatalog.items[0].currentPrices[0].amount=4;assert.equal(foodCostRows(data)[0].cost.total,12);
 assert.equal(foodCostRows(data,{itemEdits:{ingredient:{active:false}}})[0].cost.total,null);assert.equal(unrelatedReads,0);
});
test('food cost compares complete costs with the fixed 25% target and respects location scope',()=>{const data=fixture();const [r]=foodCostRows(data);assert.equal(r.cost.total,6);assert.equal(r.cost.foodCostPercent,30);assert.equal(r.gap,5);assert.equal(r.status,'above');assert.equal(foodCostRows(data,{},'other').length,0);data.costInputs.settings[0].foodTarget=.3;assert.equal(foodCostRows(data)[0].status,'above');assert.equal(r.optimalPrice,24);assert.equal(r.variance,5);data.costInputs.prices[0].amount=24;assert.equal(foodCostRows(data)[0].status,'within');data.ingredientItems[0].units=[];assert.equal(foodCostRows(data)[0].status,'incomplete');});
test('food cost search and category filtering clamp pagination and exclude prep recipes',()=>{const data=fixture();data.recipes.push({...data.recipes[0],id:'prep',type:'prep'});assert.equal(foodCostRows(data).length,1);const state={store:'all',q:'missing',page:5};const html=foodCostPage(data,{},state,{category:'food',per:25},{heading:()=>'',searchToolbar:()=>'',btn:()=>''});assert.equal(state.page,1);assert.match(html,/No menu items match/);state.q='';const filtered=foodCostPage(data,{},state,{category:'other',per:25},{heading:()=>'',searchToolbar:()=>'',btn:()=>''});assert.match(filtered,/No menu items match/);});

test('status filter includes only matching results and empty recipes are no data',()=>{const data=fixture();data.recipes[0].components=[];assert.equal(foodCostRows(data)[0].status,'incomplete');const html=foodCostPage(data,{}, {store:'all',q:'',page:1},{category:'all',status:'above',per:25},{heading:()=>'',searchToolbar:()=>'',btn:()=>''});assert.match(html,/No menu items match/);});

test('analysis shows direct difference above, below and at the 25% target',()=>{const data=fixture();data.costInputs.prices[0].amount=30;assert.equal(foodCostRows(data)[0].variance,-5);data.costInputs.prices[0].amount=24;assert.equal(foodCostRows(data)[0].variance,0);data.costInputs.prices[0].amount=20;assert.equal(foodCostRows(data)[0].variance,5);});

test('sorting uses numeric percentages, signed analysis and keeps no data last both ways',()=>{const rows=[{recipe:{name:'Z'},cost:{foodCostPercent:9},variance:-16},{recipe:{name:'A'},cost:{foodCostPercent:100},variance:75},{recipe:{name:'B'},cost:{foodCostPercent:null},variance:null}];assert.deepEqual(sortFoodCostRows(rows,'name').map(r=>r.recipe.name),['A','B','Z']);for(const key of ['foodCost','analysis']){assert.deepEqual(sortFoodCostRows(rows,key).map(r=>r.recipe.name),['Z','A','B']);assert.deepEqual(sortFoodCostRows(rows,key,'desc').map(r=>r.recipe.name),['A','Z','B']);}assert.equal(rows[0].recipe.name,'Z');});
