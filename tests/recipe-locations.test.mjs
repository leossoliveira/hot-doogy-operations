import test from 'node:test';
import assert from 'node:assert/strict';
import {recipeLocations} from '../server/recipe-locations.mjs';
const tables={locations:[{id:'a',name:'Natick Mall'},{id:'b',name:'Sherwood Plaza'}],menu_items:[{id:'menu',recipeId:'r'}],modifiers:[{id:'mod',defaultRecipeId:'modifier'}],menu_item_modifier_rules:[],location_menu_items:[{menuItemId:'menu',locationId:'a',active:true},{menuItemId:'menu',locationId:'b',active:false}],pos_modifier_mappings:[{modifierId:'mod',locationId:'b',active:true},{modifierId:'mod',locationId:'b',active:true}]};
test('menu locations exclude inactive links',()=>assert.deepEqual(recipeLocations({id:'r',recipeType:'menu'},tables),[{id:'a',name:'Natick Mall'}]));
test('modifier locations are deduplicated',()=>assert.deepEqual(recipeLocations({id:'modifier',recipeType:'modifier'},tables),[{id:'b',name:'Sherwood Plaza'}]));
test('prep uses production location and unassigned recipes stay unassigned',()=>{assert.equal(recipeLocations({id:'prep',recipeType:'prep',productionLocationId:'b'},tables)[0].id,'b');assert.deepEqual(recipeLocations({id:'unknown',recipeType:'menu'},tables),[]);});
