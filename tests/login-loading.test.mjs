import test from 'node:test';
import assert from 'node:assert/strict';
import {queueSalesSummary,salesSignature} from '../server/sales-summary.mjs';
import {createLoginUI} from '../src/login-ui.js';

test('slow sales computation never blocks workspace data and only starts once',async()=>{
 const raw={sales_item_facts:[]},session={};let finish,calls=0;
 const options={calculate:async()=>{calls++;await new Promise(r=>finish=r);session.salesSummary={signature:salesSignature(raw),result:{rows:[],days:[]}};}};
 assert.equal(queueSalesSummary({},session,raw,options).status,'loading');
 await Promise.resolve();assert.equal(calls,1);
 assert.equal(queueSalesSummary({},session,raw,options).status,'loading');assert.equal(calls,1);
 finish();await session.salesJob;
 assert.equal(queueSalesSummary({},session,raw,options).status,'ready');assert.equal(calls,1);
});
test('failed calculation is reported independently and retried with backoff',async()=>{
 const raw={},session={};let calls=0,clock=0;const options={now:()=>clock,calculate:async()=>{calls++;throw Error('timeout');}};
 queueSalesSummary({},session,raw,options);await session.salesJob;
 assert.equal(queueSalesSummary({},session,raw,options).status,'error');assert.equal(calls,1);
 clock=61000;assert.equal(queueSalesSummary({},session,raw,options).status,'loading');await session.salesJob;assert.equal(calls,2);
});
test('login shows loading progress and prevents duplicate submissions',async()=>{
 const oldFetch=globalThis.fetch,oldDocument=globalThis.document;let finish,count=0;const feedback={};
 const button={disabled:false,innerHTML:'Sign in'},form={id:'login-form',reportValidity:()=>true,dataset:{loginMode:'login'},email:{value:'test@example.invalid'},password:{value:'test-only'},querySelector:()=>button};
 globalThis.document={querySelector:()=>feedback};globalThis.fetch=async()=>{count++;return {ok:true,json:async()=>({user:{email:'test@example.invalid'}})};};
 try{const ui=createLoginUI({onLogin:()=>new Promise(r=>finish=r)});const waiting=ui.submit(form);await new Promise(r=>setImmediate(r));assert.equal(button.textContent,'Opening your workspace…');assert.match(feedback.textContent,/You’re signed in/);await ui.submit(form);assert.equal(count,1);finish();await waiting;assert.equal(button.disabled,false);}finally{globalThis.fetch=oldFetch;globalThis.document=oldDocument;}
});
