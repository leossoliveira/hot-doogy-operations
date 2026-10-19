import test from 'node:test';
import assert from 'node:assert/strict';
import {saveCloudPhoto} from '../src/photo-storage.js';

test('Photo upload sends JPEG bytes without fetching a data URL blocked by CSP',async()=>{
 const original=globalThis.fetch,calls=[],bytes=Uint8Array.of(255,216,0,128,255,217);
 const saved={storage:'s3',src:'/api/photos/items/test'};
 globalThis.fetch=async(url,options)=>{
  calls.push({url,options});
  if(url==='/api/photos')return Response.json({token:'session'});
  assert.equal(url,'/api/photos/items/test');
  assert.equal(options.method,'PUT');
  assert.equal(options.headers['X-Photo-Token'],'session');
  assert.equal(options.headers['Content-Type'],'image/jpeg');
  assert.equal(options.body.type,'image/jpeg');
  assert.deepEqual(new Uint8Array(await options.body.arrayBuffer()),bytes);
  return Response.json(saved);
 };
 try{
  assert.deepEqual(await saveCloudPhoto('items','test',{src:`data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`}),saved);
  assert.equal(calls.length,2);
  await assert.rejects(()=>saveCloudPhoto('items','test',{src:'data:image/png;base64,AAAA'}),/Select a new photo/);
  assert.equal(calls.length,2);
 }finally{globalThis.fetch=original;}
});
