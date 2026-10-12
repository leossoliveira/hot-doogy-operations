import test from 'node:test';import assert from 'node:assert/strict';
import {effectiveProfile} from '../src/permission-profiles.js';
import {requireProfileRequest,requireProfileCommand} from '../server/permission-profiles.mjs';
import {laborCostPercent} from '../src/hr-model.js';
test('labor percentage uses matching inclusive dates and location and handles missing/zero sales',()=>{
 const facts=[{date:'2026-10-01',locationId:'a',netSales:100},{date:'2026-10-02',locationId:'a',netSales:200},{date:'2026-10-03',locationId:'a',netSales:900},{date:'2026-10-01',locationId:'b',netSales:1000}];
 assert.equal(laborCostPercent(6000,facts,{start:'2026-10-01',end:'2026-10-02',location:'a'}),20);
 assert.equal(laborCostPercent(0,facts),0);assert.equal(laborCostPercent(6000,[]),null);assert.equal(laborCostPercent(6000,[{netSales:0}]),null);assert.equal(laborCostPercent(6000,[{netSales:null}]),null);
});
test('profiles restrict app endpoints and every batch operation without elevating base roles',()=>{
 const p=effectiveProfile('manager',{inventory:{view:true,write:false},purchasing:{view:false,write:false}});
 assert.throws(()=>requireProfileRequest(p,'GET','/api/invoices/x'));assert.throws(()=>requireProfileRequest(p,'PUT','/api/photos/items/x'));requireProfileRequest(p,'GET','/api/inventory/count-notes');
 assert.throws(()=>requireProfileCommand(p,{action:'batch',payload:{changes:[{action:'counts'}]}}));
 assert.throws(()=>requireProfileCommand(p,{action:'batch',payload:{changes:[{action:'recipe'},{action:'orders'}]}}));
 assert.equal(effectiveProfile('staff',{hr:{view:true,write:true}}).hr.view,false);
 assert.equal(effectiveProfile('manager',{overview:{view:false,write:false}}).overview.view,true);
});
