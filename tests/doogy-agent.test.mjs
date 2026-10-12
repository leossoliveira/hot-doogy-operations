import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgentService} from '../server/doogy-agent.mjs';
import {createBridgeDispatch} from '../server/doogy-bridge.mjs';
const input={text:'Hello',requestId:'11111111-1111-4111-8111-111111111111'};
test('agent conversations are admin-only and bind session keys to the authenticated actor',async()=>{
 const calls=[];const service=createAgentService(async(method,params)=>{calls.push({method,params});return {messages:[]};});
 await assert.rejects(service.history('staff','a'),/administrators/);assert.equal(calls.length,0);
 await service.history('owner','a');await service.history('admin','b');await service.history('owner','a');
 assert.notEqual(calls[0].params.sessionKey,calls[1].params.sessionKey);assert.equal(calls[0].params.sessionKey,calls[2].params.sessionKey);
});
test('agent send uses chat execution without channel delivery, stable retries and validated input',async()=>{
 const calls=[];const service=createAgentService(async(method,params)=>{calls.push({method,params});return {runId:'run'};});
 await assert.rejects(service.send('owner','a',{...input,text:''}),/message/);assert.equal(calls.length,0);
 await service.send('owner','a',{...input,sessionKey:'agent:main:main'});await service.send('owner','a',input);
 assert.equal(calls[0].method,'chat.send');assert.equal(calls[0].params.deliver,false);assert.notEqual(calls[0].params.sessionKey,'agent:main:main');assert.deepEqual(calls[0],calls[1]);
 await assert.rejects(createAgentService(async()=>({status:'error'})).send('owner','a',input),/confirmed/);
});
test('private agent bridge strips internal history and rejects missing actor',async()=>{
 const dispatch=createBridgeDispatch(async()=>({messages:[{role:'assistant',content:[{type:'thinking',text:'PRIVATE'},{type:'text',text:'Hello'}]}]}));
 await assert.rejects(dispatch({action:'agent-history'}),/user/);
 const history=await dispatch({action:'agent-history',actor:'a'});assert.equal(history.messages[0].text,'Hello');assert.doesNotMatch(JSON.stringify(history),/PRIVATE/);
});
