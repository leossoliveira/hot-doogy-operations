import test from 'node:test';import assert from 'node:assert/strict';
import {assignmentMessage,sendAssignment,dispatchTaskNotifications} from '../server/my-day-whatsapp.mjs';
import {createBridgeDispatch} from '../server/doogy-bridge.mjs';
const id='00000000-0000-0000-0000-000000000001';
test('assignment summary uses first name, plain task title, US due date and completion time',()=>{
 const message=assignmentMessage({name:'Leonardo Oliveira',title:'Stock Check',scope:'Suppliers: US Foods, EB Express e Prep Recipes.',location:'Natick Mall',due_date:'2026-10-12',starts_at:'2026-10-12T09:30',ends_at:'2026-10-12T10:00',occurrences:3,last_due:'2026-10-14'});
 assert.equal(message,'Olá, Leonardo!\n\nNova tarefa atribuída:\n\nStock Check\nSuppliers: US Foods, EB Express e Prep Recipes.\n\nLocal: Natick Mall\n\nPrazo: 10/12/2026 · 10:00 AM');assert.ok(message.length<2400);
 assert.doesNotMatch(message,/HOT DOOGY|Início:|Fim:|Nova York|https?:\/\//);
});
test('OpenClaw sends only to a validated direct number using a stable assignment key',async()=>{
 const calls=[];const input={id,phone:'+12025550123',message:'New task'};const call=async(...args)=>{calls.push(args);return {messageId:'fake'};};
 assert.deepEqual(await sendAssignment(input,call),{messageId:'fake'});await sendAssignment(input,call);
 assert.equal(calls[0][0],'send');assert.equal(calls[0][1].agentId,'main');assert.equal(calls[0][1].accountId,'default');assert.equal(calls[0][1].channel,'whatsapp');assert.equal(calls[0][1].to,input.phone);assert.equal(calls[0][1].idempotencyKey,calls[1][1].idempotencyKey);
 await assert.rejects(sendAssignment({...input,phone:'group@g.us'},call));await assert.rejects(sendAssignment(input,async()=>({ok:true})),/not confirmed/);
 const bridge=createBridgeDispatch(call);assert.deepEqual(await bridge({action:'task-assignment',input}),{messageId:'fake'});
});
test('staff cannot start the assignment dispatcher',async()=>{
 let calls=0;await dispatchTaskNotifications({request:async()=>calls++},{user:{id},member:{role:'staff'}});assert.equal(calls,0);
});
