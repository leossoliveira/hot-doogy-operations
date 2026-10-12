import test from 'node:test';import assert from 'node:assert/strict';import {searchItems,itemSearchTitle,itemSearchCaption} from '../src/item-search.js';
test('item search is empty until typing and matches internal name, SKU and product description without accents',()=>{
 const rows=[{id:'a',name:'Sauce',internalName:'Molho Açai',sku:'123',productDescription:'Frozen fruit sauce'},{id:'b',name:'Paper',internalName:'Wrapper',sku:'456'}];
 assert.equal(searchItems(rows,'').length,0);assert.equal(searchItems(rows,'  ').length,0);for(const q of ['acai','123','frozen'])assert.deepEqual(searchItems(rows,q).map(x=>x.id),['a']);assert.deepEqual(searchItems(rows,'456').map(x=>x.id),['b']);assert.equal(searchItems(rows,'absent').length,0);
});

test("item search label uses internal name and SKU with product description",()=>{const item={internalName:"Wrapper",name:"Vendor paper",sku:"123",productDescription:"Small food wrapper",supplierName:"US Foods"};assert.equal(itemSearchTitle(item),"Wrapper");assert.equal(itemSearchCaption(item),"123 · Small food wrapper · US Foods");assert.equal(itemSearchCaption({name:"Paper"}),"— · Paper · —");});
