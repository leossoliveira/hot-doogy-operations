import test from 'node:test';
import assert from 'node:assert/strict';
import {persistSupplierChanges} from '../src/supplier-ui.js';
import {configureCommit,saveCloudState} from '../src/cloud.js';

test('Supplier details save before photo changes the record version, then only photo state is committed',async()=>{
 let local={itemPhotos:{}},version=1;
 const next={itemPhotos:{},supplierItemEdits:{item:{name:'Updated'}}},calls=[];let refreshes=0;
 configureCommit(async(state,{refresh=true}={})=>{
  if(refresh)refreshes++;
  if(Object.keys(state.supplierItemEdits).length){assert.equal(version,1);calls.push('details');state.supplierItemEdits={};version++;}
  else {calls.push('photo-state');assert.equal(state.itemPhotos.item.storage,'s3');}
 });
 await persistSupplierChanges({photoDirty:true,photo:{src:'jpeg'},original:{itemId:'item'}},next,{local:()=>local,setLocal:value=>{local=value;}},{
  saveDetails:saveCloudState,
  savePhoto:async()=>{calls.push('upload');version++;return {storage:'s3'};}
 });
 assert.deepEqual(calls,['details','upload','photo-state']);
 assert.equal(local.itemPhotos.item.storage,'s3');
 assert.equal(refreshes,1);
});

test('Failed upload refreshes committed details before retry and preserves the upload error',async()=>{
 const next={itemPhotos:{}},calls=[];
 await assert.rejects(()=>persistSupplierChanges({photoDirty:true,photo:{src:'jpeg'},original:{itemId:'item'}},next,{setLocal(){},local:()=>next},{
  saveDetails:async(state,{refresh=true}={})=>{calls.push(refresh?'refresh':'details');},
  savePhoto:async()=>{calls.push('upload');throw Error('Upload failed');}
 }),/Upload failed/);
 assert.deepEqual(calls,['details','upload','refresh']);
});

test('Details without a photo retain the normal refresh',async()=>{
 const calls=[];
 await persistSupplierChanges({photoDirty:false},{},{setLocal(){}},{saveDetails:async(state,options)=>calls.push(options.refresh),savePhoto:async()=>assert.fail('Unexpected upload')});
 assert.deepEqual(calls,[true]);
});

test('A details conflict prevents the photo upload',async()=>{
 let uploaded=false;
 await assert.rejects(()=>persistSupplierChanges({photoDirty:true}, {}, {setLocal(){}},{saveDetails:async()=>{throw Error('conflict');},savePhoto:async()=>{uploaded=true;}}),/conflict/);
 assert.equal(uploaded,false);
});
