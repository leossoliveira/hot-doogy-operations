import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuth} from '../server/auth.mjs';
import {databaseWriteRejected} from '../server/database-errors.mjs';
import {preparationPages} from '../server/preparation-pages.mjs';
test('business conflicts stop calculation after one request and return 409',async()=>{
 let calls=0;
 const auth=createAuth({fetcher:async()=>{calls++;return {ok:false,status:409,json:async()=>({code:'PT409',message:'The recipe catalog changed. Restart the calculation.'})};}});
 await assert.rejects(async()=>{for await(const part of preparationPages(auth,{token:'test'},'operations_preparation_sales_page'))void part;},e=>e.status===409&&e.databaseCode==='PT409');
 assert.equal(calls,1);assert.equal(databaseWriteRejected('PT409'),true);
});
