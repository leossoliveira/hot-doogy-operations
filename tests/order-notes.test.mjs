import test from 'node:test';import assert from 'node:assert/strict';import {Readable} from 'node:stream';import {editOrder} from '../server/order-edit.mjs';
const id='00000000-0000-0000-0000-000000000010',session={member:{role:'manager'},token:'test-token'};
const payload={number:'DRAFT',expectedUpdatedAt:'2026-10-12T12:00:00Z',lines:[]};
const request=body=>Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]),{method:'POST'});
const response=()=>({writeHead(){},end(){}});
test('draft notes API sends text and empty notes, preserves compatibility for older requests',async()=>{
 for(const notes of ['Arrival window\nSecond line','',undefined]){let sent;await editOrder(request({...payload,...(notes===undefined?{}:{notes})}),response(),new URL(`http://localhost/api/orders/${id}/edit`),{request:async(path,options)=>{sent={path,body:options.body};return {saved:true};}},session);assert.equal(sent.path,notes===undefined?'/rest/v1/rpc/edit_order_details':'/rest/v1/rpc/edit_order_details_with_notes');if(notes!==undefined)assert.equal(sent.body.p_notes,notes);else assert.equal('p_notes' in sent.body,false);}
});
test('draft notes API rejects invalid or excessive notes before writing',async()=>{for(const notes of [null,123,{},'x'.repeat(4001)]){let calls=0;await assert.rejects(editOrder(request({...payload,notes}),response(),new URL(`http://localhost/api/orders/${id}/edit`),{request:async()=>{calls++;}},session),{status:400});assert.equal(calls,0);}});
