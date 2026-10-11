import test from 'node:test';import assert from 'node:assert/strict';
import {createBridgeDispatch} from '../server/doogy-bridge.mjs';
test('private bridge exposes only conversation operations and sanitized directory',async()=>{
 const calls=[];const dispatch=createBridgeDispatch(async(method,params)=>{calls.push({method,params});return {sessions:[{channel:'whatsapp',key:'chat',kind:'group',origin:{to:'1@g.us'},displayName:'Group',token:'PRIVATE'}]};});
 await assert.rejects(dispatch({action:'config.get'}),/Unsupported/);await assert.rejects(dispatch({action:'exec',command:'bad'}),/Unsupported/);assert.equal(calls.length,0);
 const directory=await dispatch({action:'directory'});assert.equal(directory.rows.length,1);assert.doesNotMatch(JSON.stringify(directory),/PRIVATE/);await dispatch({action:'directory'});assert.equal(calls.length,1);
 await assert.rejects(dispatch({action:'history',id:'unknown'}),/not found/);assert.ok(calls.every(c=>c.method==='sessions.list'));
 await assert.rejects(dispatch({action:'send',id:'default:1@g.us',input:{}}),/sender/);
});
