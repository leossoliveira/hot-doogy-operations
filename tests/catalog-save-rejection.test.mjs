import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuth} from '../server/auth.mjs';
import {databaseWriteRejected} from '../server/database-errors.mjs';
import {api} from '../src/cloud.js';
test('safeupdate rejection remains a confirmed rollback through server and client',async()=>{
 const auth=createAuth({fetcher:async()=>Response.json({code:'21000',message:'UPDATE requires a WHERE clause'},{status:400})});
 let failure;
 try{await auth.request('/rest/v1/rpc/catalog_create',{method:'POST',body:{}});}catch(e){failure=e;}
 assert.equal(failure.databaseCode,'21000');assert.equal(databaseWriteRejected(failure.databaseCode),true);
 assert.match(failure.message,/No changes were saved/);
 const original=globalThis.fetch;
 globalThis.fetch=async()=>Response.json({error:failure.message,code:failure.databaseCode,rejected:databaseWriteRejected(failure.databaseCode)},{status:failure.status});
 try{await assert.rejects(api('/api/catalog/create',{}),e=>e.rejected===true&&e.code==='21000');}finally{globalThis.fetch=original;}
 // A lost response remains unknown and must keep the same command identifier.
 assert.equal(databaseWriteRejected(undefined),false);assert.equal(databaseWriteRejected('08006'),false);
});
