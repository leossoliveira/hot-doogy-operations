import test from 'node:test';
import assert from 'node:assert/strict';
import {inventoryWithEdits,ingredientItemsWithEdits,supplierOrderItems} from '../src/catalog-overlay.js';

function fixture(){
  const units=[
    {id:'each',itemUnitId:'item-each',name:'Each',factor:1,base:true,ordering:false,receiving:false,stocktake:true},
    {id:'case',itemUnitId:'item-case',name:'Case',factor:12,base:false,ordering:true,receiving:true,stocktake:false},
  ];
  const stores=[{id:'sherwood',active:true,locationActive:true},{id:'natick',active:false,locationActive:true}];
  const first={id:'vendor-a',supplierItemId:'vendor-a',itemId:'item',name:'Vendor A description',catalogName:'Catalog item',sku:'SKU-A',supplierId:'a',supplierName:'A',active:true,supplierActive:true,supplierBusinessActive:true,baseUnitId:'each',orderingUnitId:'case',receivingUnitId:'case',stocktakeUnitId:'each',stocktakeUnitIds:['each'],units,stores};
  const second={...structuredClone(first),id:'vendor-b',supplierItemId:'vendor-b',name:'Vendor B description',sku:'SKU-B',supplierId:'b',supplierName:'B',orderingUnitId:'each',receivingUnitId:'each'};
  const catalog={items:[first,second]};
  const inventory=[{id:'item',rowId:'item-sherwood',supplierItemId:'vendor-a',supplierId:'a',name:'Catalog item',sku:'SKU-A',locationId:'sherwood',locationName:'Sherwood',locationActive:true,active:true,areaId:'shelf',areaName:'Shelf',stores:[{id:'sherwood'}],areas:[{id:'shelf'}],stockQty:null,stockVerified:false,units:units.map(u=>({...u,id:u.itemUnitId})),orderingUom:'Case',stocktakeUom:'Each'}];
  const ingredients=[{id:'item',name:'Catalog item',sku:'recipe-sku',active:true,baseUomId:'each',units:structuredClone(units)}];
  return {units,catalog,inventory,ingredients};
}

test('unmodified catalog rows retain object identity',()=>{
  const f=fixture();
  assert.equal(inventoryWithEdits(f.inventory,f.catalog,{})[0],f.inventory[0]);
  assert.equal(ingredientItemsWithEdits(f.ingredients,{})[0],f.ingredients[0]);
});

test('shared inventory edits still load when the supplier catalog could not be fetched',()=>{
  const f=fixture();
  f.inventory[0].category='Other';
  const local={itemEdits:{item:{internalName:'Offline edit',categoryName:'Food',units:f.units,stocktakeUnitId:'case',stocktakeUnitIds:['case']}}};
  const [row]=inventoryWithEdits(f.inventory,null,local);
  assert.equal(row.name,'Offline edit');assert.equal(row.category,'Food');assert.equal(row.stocktakeUom,'Case');assert.equal(row.units[0].id,'item-each');assert.equal(row.rowId,'item-sherwood');
  assert.deepEqual(supplierOrderItems(null,f.inventory,local,{locationId:'sherwood',supplierId:'a'}),[]);
});

test('shared edits propagate name, activity and conversions without changing inventory identity or location',()=>{
  const f=fixture(),before=JSON.stringify(f);
  const local={itemEdits:{item:{internalName:'New internal name',categoryName:'Food',active:false,stocktakeUnitId:'case',stocktakeUnitIds:['case'],units:f.units.map(u=>({...u,factor:u.id==='case'?24:u.factor}))}}};
  const [row]=inventoryWithEdits(f.inventory,f.catalog,local);
  assert.equal(row.id,'item');assert.equal(row.rowId,'item-sherwood');assert.equal(row.name,'New internal name');assert.equal(row.internalName,'New internal name');assert.equal(row.active,false);assert.equal(row.categoryName,'Food');
  assert.equal(row.stockQty,null);assert.equal(row.locationId,'sherwood');assert.equal(row.areaName,'Shelf');
  assert.equal(row.units.find(u=>u.id==='item-case').factor,24);assert.equal(row.units.find(u=>u.id==='item-case').unitId,'case');assert.equal(row.stocktakeUom,'Case');
  assert.equal(JSON.stringify(f),before);
  row.units[0].factor=99;
  assert.equal(f.units[0].factor,1);assert.equal(local.itemEdits.item.units[0].factor,1);
});

test('recipe ingredients apply shared fields with global unit IDs and preserve recipe SKU',()=>{
  const f=fixture();
  const local={itemEdits:{item:{internalName:'New name',active:false,baseUnitId:'each',units:f.units.map(u=>({...u,factor:u.id==='case'?30:u.factor})),stocktakeUnitId:'case',stocktakeUnitIds:['case']}},supplierItemEdits:{'vendor-a':{name:'Vendor-only name',sku:'CHANGED',orderingUnitId:'each'}}};
  const [row]=ingredientItemsWithEdits(f.ingredients,local);
  assert.equal(row.name,'New name');assert.equal(row.active,false);assert.equal(row.sku,'recipe-sku');assert.equal(row.baseUomId,'each');
  assert.equal(row.units.find(u=>u.id==='case').factor,30);assert.equal(row.units.find(u=>u.id==='case').itemUnitId,'item-case');assert.equal(row.stocktakeUom,'Case');
  assert.equal(row.units.find(u=>u.id==='case').ordering,true);
});

test('supplier edits apply only to the inventory association that owns them',()=>{
  const f=fixture();
  const local={supplierItemEdits:{'vendor-a':{sku:'UPDATED-A',orderingUnitId:'each',receivingUnitId:'each'},'vendor-b':{sku:'UPDATED-B',orderingUnitId:'case'}}};
  const [row]=inventoryWithEdits(f.inventory,f.catalog,local);
  assert.equal(row.sku,'UPDATED-A');assert.equal(row.orderingUom,'Each');assert.equal(row.units.find(u=>u.id==='item-each').ordering,true);
  assert.equal(row.name,'Catalog item');
});

test('new orders include the selected supplier alias even when inventory references another supplier',()=>{
  const f=fixture(),before=JSON.stringify(f);
  const local={supplierItemEdits:{'vendor-b':{sku:'B-LOCAL',name:'B local product',orderingUnitId:'each'}}};
  const [row]=supplierOrderItems(f.catalog,f.inventory,local,{locationId:'sherwood',supplierId:'b'});
  assert.equal(row.id,'item');assert.equal(row.rowId,'item-sherwood');assert.equal(row.supplierItemId,'vendor-b');assert.equal(row.supplierId,'b');assert.equal(row.name,'B local product');assert.equal(row.sku,'B-LOCAL');assert.equal(row.orderingUom,'Each');
  assert.equal(row.units.find(u=>u.id==='item-each').ordering,true);assert.equal(row.units.find(u=>u.id==='item-case').ordering,false);assert.equal(row.stockQty,null);assert.equal(row.areaName,'Shelf');assert.equal(JSON.stringify(f),before);
});

test('new order choices reject inactive items, vendor associations and store links',()=>{
  const f=fixture(),scope={locationId:'sherwood',supplierId:'a'};
  assert.equal(supplierOrderItems(f.catalog,f.inventory,{itemEdits:{item:{active:false}}},scope).length,0);
  assert.equal(supplierOrderItems(f.catalog,f.inventory,{supplierItemEdits:{'vendor-a':{supplierActive:false}}},scope).length,0);
  assert.equal(supplierOrderItems(f.catalog,[{...f.inventory[0],locationActive:false}],{},scope).length,0);
  assert.equal(supplierOrderItems(f.catalog,[{...f.inventory[0],locationId:'natick'}],{},{...scope,locationId:'natick'}).length,0);
  f.catalog.items[0].supplierBusinessActive=false;
  assert.equal(supplierOrderItems(f.catalog,f.inventory,{},scope).length,0);
});
