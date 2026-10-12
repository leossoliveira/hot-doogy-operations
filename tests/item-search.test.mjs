import test from 'node:test';import assert from 'node:assert/strict';import {searchItems} from '../src/item-search.js';
test('item search is empty until typing and matches internal name, SKU and product description without accents',()=>{
 const rows=[{id:'a',name:'Sauce',internalName:'Molho Açai',sku:'123',productDescription:'Frozen fruit sauce'},{id:'b',name:'Paper',internalName:'Wrapper',sku:'456'}];
 assert.equal(searchItems(rows,'').length,0);assert.equal(searchItems(rows,'  ').length,0);for(const q of ['acai','123','frozen'])assert.deepEqual(searchItems(rows,q).map(x=>x.id),['a']);assert.deepEqual(searchItems(rows,'456').map(x=>x.id),['b']);assert.equal(searchItems(rows,'absent').length,0);
});
