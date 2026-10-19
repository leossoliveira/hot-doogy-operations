import test from 'node:test';
import assert from 'node:assert/strict';
import {saveInventoryDraft} from '../server/inventory-count.mjs';
import {databaseErrorMessage} from '../server/database-errors.mjs';
import {createAuth} from '../server/auth.mjs';
test('count validation travels through provider translation as a definitive actionable rejection',async()=>{
 const auth=createAuth({fetcher:async()=>({ok:false,status:400,json:async()=>({code:'P0001',message:'Invalid count item or unit'})})});
 await assert.rejects(saveInventoryDraft(auth,{token:'synthetic'},{state:{}}),error=>error.status===422&&/Review the selected units/.test(error.message));
});
test('count version conflicts describe counts, preserve edits and never refer to invoices',async()=>{
 const auth=createAuth({fetcher:async()=>({ok:false,status:400,json:async()=>({code:'40001',message:'Count changed in another window. Reopen it from History.'})})});
 await assert.rejects(saveInventoryDraft(auth,{token:'synthetic'},{}),error=>error.status===409&&/local edits are preserved/.test(error.message)&&!error.message.includes('invoice'));
});
test('unknown provider failures remain ambiguous; private details are not exposed',async()=>{
 const auth=createAuth({fetcher:async()=>({ok:false,status:500,json:async()=>({code:'XX000',message:'private table detail'})})});
 await assert.rejects(saveInventoryDraft(auth,{token:'synthetic'},{}),error=>error.status===502&&!error.message.includes('private table'));
 assert.ok(!databaseErrorMessage({code:'P0001',message:'private table detail'}).includes('private table'));
});
