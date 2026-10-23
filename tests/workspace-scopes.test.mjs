import test from 'node:test';
import assert from 'node:assert/strict';
import {readTables,TABLES,projectData} from '../server/live-data.mjs';
import {CATALOG_TABLES,tablesForScope} from '../server/workspace-scopes.mjs';
import {createWorkspaceReader} from '../server/workspace-read.mjs';
import {routeScope,scopeCovers,refreshScope} from '../src/workspace-scope.js';
import {operationsFixture} from './fixtures/save-refresh.mjs';

test('bootstrap reads locations only; catalog omits sales and operational histories',async()=>{
 for(const scope of ['bootstrap','catalog']){
  const calls=[];const auth={request:async(path,{body,token})=>{calls.push(path);assert.equal(token,'actor');assert.equal(path,'/rest/v1/rpc/workspace_read_batch');return Object.fromEntries(body.p_tables.map(table=>[table,table==='locations'?[{id:'location',name:'Store'}]:[]]));}};
  const raw=await readTables(auth,'actor','owner',{batch:true,scope});
  assert.equal(projectData(raw).locations[0].name,'Store');
  assert.equal(calls.length,scope==='bootstrap'?1:4);
  for(const table of ['sales_item_facts','inventory_transactions','purchase_orders','stock_count_lines'])assert.deepEqual(raw[table],[]);
 }
});
test('catalog preserves complete editable fields, prices, conversions and recipe references',()=>{
 const raw=operationsFixture(3),full=projectData(raw),catalog=projectData(Object.fromEntries(CATALOG_TABLES.map(table=>[table,raw[table]||[]])));
 assert.deepEqual({...catalog.supplierCatalog,meta:null},{...full.supplierCatalog,meta:null});
 assert.deepEqual(catalog.recipes,full.recipes);
});
test('invalid scopes read nothing and Staff scope cannot request purchasing rows',async()=>{
 let calls=0;await assert.rejects(readTables({request(){calls++;}},'actor','owner',{batch:true,scope:'anything'}),e=>e.status===400);assert.equal(calls,0);
 const seen=[];await readTables({request:async(path,{body})=>{seen.push(...body.p_tables);return Object.fromEntries(body.p_tables.map(table=>[table,[]]));}},'staff','staff',{batch:true,scope:'catalog'});
 assert.ok(!seen.includes('invoices'));assert.ok(!seen.includes('invoice_lines'));assert.deepEqual(tablesForScope('full',TABLES),TABLES);
});
test('scope is part of in-flight identity; bootstrap cannot satisfy a history request',async()=>{
 const scopes=[],reader=createWorkspaceReader({read:async(a,t,r,scope)=>{scopes.push(scope);return {scope};}}),session={token:'t',member:{role:'owner'}};
 const [bootstrap,full]=await Promise.all([reader.read({},session,'bootstrap'),reader.read({},session,'full')]);
 assert.equal(bootstrap.scope,'bootstrap');assert.equal(full.scope,'full');assert.deepEqual(scopes,['bootstrap','full']);
});
test('overview uses an independent dashboard scope; incomplete scopes cannot render history',()=>{
 assert.equal(routeScope('overview'),'overview');assert.equal(routeScope('suppliers'),'catalog');
 for(const route of ['inventory','invoices','purchases','sales','recipes','reports'])assert.equal(routeScope(route),'full');
 assert.equal(scopeCovers('bootstrap','catalog'),false);assert.equal(scopeCovers('catalog','full'),false);assert.equal(scopeCovers('full','bootstrap'),true);assert.equal(refreshScope('full','catalog'),'full');
});

test('overview and catalog never cover each other',()=>{assert.equal(scopeCovers('overview','catalog'),false);assert.equal(scopeCovers('catalog','overview'),false);assert.equal(scopeCovers('overview','full'),false);assert.equal(scopeCovers('full','overview'),true);assert.equal(refreshScope('overview','catalog'),'catalog');});
test('overview reads a single scoped RPC, never history pages',async()=>{const calls=[];const result={locations:[],overview_sales_daily:[]};const raw=await readTables({request:async(path,options)=>{calls.push(path);assert.equal(options.token,'actor');assert.ok(options.body.p_organization_id);return result;}},'actor','owner',{scope:'overview'});assert.equal(raw,result);assert.deepEqual(calls,['/rest/v1/rpc/overview_dashboard_read']);});
