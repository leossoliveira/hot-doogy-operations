import test from 'node:test';
import assert from 'node:assert/strict';
import {persistSupplierChanges} from '../src/supplier-ui.js';

test('Supplier details save before photo changes the record version, then only photo state is committed',async()=>{
 let local={itemPhotos:{}},version=1;
 const next={itemPhotos:{},supplierItemEdits:{item:{name:'Updated'}}},calls=[];
 await persistSupplierChanges({photoDirty:true,photo:{src:'jpeg'},original:{itemId:'item'}},next,{local:()=>local,setLocal:value=>{local=value;}},{
  saveDetails:async state=>{
   if(Object.keys(state.supplierItemEdits).length){assert.equal(version,1);calls.push('details');state.supplierItemEdits={};version++;}
   else {calls.push('photo-state');assert.equal(state.itemPhotos.item.storage,'s3');}
  },
  savePhoto:async()=>{calls.push('upload');version++;return {storage:'s3'};}
 });
 assert.deepEqual(calls,['details','upload','photo-state']);
 assert.equal(local.itemPhotos.item.storage,'s3');
});

test('A details conflict prevents the photo upload',async()=>{
 let uploaded=false;
 await assert.rejects(()=>persistSupplierChanges({photoDirty:true}, {}, {setLocal(){}},{saveDetails:async()=>{throw Error('conflict');},savePhoto:async()=>{uploaded=true;}}),/conflict/);
 assert.equal(uploaded,false);
});
