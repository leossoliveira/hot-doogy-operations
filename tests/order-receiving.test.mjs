import test from 'node:test';
import assert from 'node:assert/strict';
import {remainingToReceive,receiptPayload,receiptFormBody} from '../src/order-receiving.js';
import {escape as e} from '../src/model.js';
const line={id:'one',orderedPurchaseQty:10,receivedQuantity:3};
test('receiving only posts selected quantities and records the shortage separately',()=>{
 assert.equal(remainingToReceive(line),7);
 assert.deepEqual(receiptPayload([{line,quantity:2,areaId:'area',reportIssue:true,reason:' Damaged '}]),{lines:[{lineId:'one',quantity:2,areaId:'area'}],issues:[{lineId:'one',quantity:5,reason:'Damaged'}]});
 assert.deepEqual(receiptPayload([{line,quantity:0,reportIssue:true,reason:'Missing'}]),{lines:[],issues:[{lineId:'one',quantity:7,reason:'Missing'}]});
});
test('receiving rejects invalid, excessive, empty and incomplete submissions',()=>{
 for(const quantity of [-1,8,NaN,Infinity])assert.throws(()=>receiptPayload([{line,quantity,areaId:'a'}]));
 assert.throws(()=>receiptPayload([]));
 assert.throws(()=>receiptPayload([{line,quantity:1}]));
 assert.throws(()=>receiptPayload([{line,quantity:0,reportIssue:true,reason:' '} ]));
 assert.throws(()=>receiptPayload([{line,quantity:7,areaId:'a',reportIssue:true,reason:'Missing'}]));
});
test('form scopes receivers and escapes issue and product labels',()=>{
 const html=receiptFormBody({locationId:'store'},[{...line,name:'<script>',reportIssue:true}],[{id:'a',name:'Assigned',locations:['store']},{id:'b',name:'Elsewhere',locations:['other']}],[],{e,number:String});
 assert.match(html,/Assigned/);assert.doesNotMatch(html,/Elsewhere|<script>/);assert.match(html,/&lt;script&gt;/);assert.match(html,/max="7"/);assert.match(html,/maxlength="1000"/);
});
