import test from 'node:test';import assert from 'node:assert/strict';
import {countItems} from '../src/count-filter.js';
import {countEntry} from '../src/units.js';
const purchased={id:'food',rowId:'food-store',name:'Bread',type:'purchased',supplierId:'supplier',locationId:'store',areaName:'Kitchen',active:true,locationActive:true};
const prep={...purchased,id:'prep',rowId:'prep-store',name:'Recipe output',internalName:'Cheese sauce',type:'prepared',supplierId:null,units:[{id:'oz',name:'oz',factor:1,stocktake:true},{id:'lb',name:'lb',factor:16}]};
const items=[prep,purchased,{...prep,rowId:'other-store',locationId:'other'},{...prep,rowId:'inactive',active:false},{...prep,rowId:'disabled-store',locationActive:false}];
test('count defaults to purchased items and optionally includes active prep within location and area',()=>{
 assert.deepEqual(countItems(items,{locationId:'store'}).map(x=>x.id),['food']);
 assert.deepEqual(countItems(items,{locationId:'store',includePrep:true}).map(x=>x.id),['food','prep']);
 assert.equal(countItems(items,{locationId:'store',includePrep:true,areas:['Freezer']}).length,0);
 assert.equal(countItems(items,{locationId:'store',includePrep:true,areas:[]}).length,0);
});
test('prep is independent of supplier selection and remains searchable and countable',()=>{
 const rows=countItems(items,{locationId:'store',includePrep:true,suppliers:['another'],query:'cheese'});
 assert.equal(rows.length,1);assert.equal(rows[0].name,'Cheese sauce');
 assert.equal(countItems(items,{locationId:'store',includePrep:true,suppliers:[]}).length,1);
 assert.equal(countItems(items,{locationId:'store',includePrep:false,suppliers:[]}).length,0);
 assert.equal(countItems(items,{locationId:'store',includePrep:true,specific:'prep-store'}).length,1);
 const entry=countEntry(rows[0],2,'lb');assert.equal(entry.itemId,'prep');assert.equal(entry.qty,32);assert.equal(entry.itemUnitId,'oz');
 assert.equal(prep.name,'Recipe output');
});
