import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {projectData} from '../../server/live-data.mjs';
import {periodSales} from '../../src/model.js';
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE_PATH).href);
const db=new PGlite(),id=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0'),org=id(1),other=id(2),loc=id(3),hidden=id(4),supplier=id(5);
const schema=JSON.parse(await readFile(new URL('./overview-schema.json',import.meta.url),'utf8'));
await db.exec(`create schema auth;create schema private;create role authenticated;create role anon;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
create function private.mfa_authorized() returns boolean language sql stable as $$select current_setting('test.mfa',true)='yes'$$;
create function private.is_org_member(uuid) returns boolean language sql stable as $$select $1='${org}'::uuid$$;
create function private.is_operations_staff() returns boolean language sql stable as $$select current_setting('test.staff',true)='yes'$$;
grant usage on schema auth,private to authenticated;`);
for(const [table,columns] of Object.entries(schema)){
 const locationClause=table==='locations'?`and id<>'${hidden}'`:/(^|,)location_id uuid/.test(columns)?`and (location_id is null or location_id<>'${hidden}')`:'';
 await db.exec(`create table public.${table}(${columns});alter table public.${table} enable row level security;create policy scoped_read on public.${table} for select to authenticated using(organization_id='${org}' ${locationClause});`);
}
await db.exec(`grant select on all tables in schema public to authenticated;`);
const insert=async(table,row)=>{const keys=Object.keys(row);await db.query(`insert into public.${table} (${keys.join(',')}) values (${keys.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(row));};
for(const [l,name,o] of [[loc,'Visible',org],[hidden,'Hidden',org],[id(6),'Other',other]])await insert('locations',{id:l,organization_id:o,name,active:true});
await insert('suppliers',{id:supplier,organization_id:org,name:'Synthetic supplier'});
for(let i=10;i<13;i++){
 await insert('inventory_items',{id:id(i),organization_id:org,internal_name:'Item',active:i!==12,item_type:i===11?'prepared':'ingredient'});
 await insert('location_inventory_items',{id:id(i+10),organization_id:org,inventory_item_id:id(i),location_id:loc,active:true});
}
await insert('recipes',{id:id(30),organization_id:org,recipe_type:'prep',production_location_id:loc});
for(let i=1;i<=3;i++)await insert('recipe_versions',{id:id(30+i),organization_id:org,recipe_id:id(30),version_number:i,status:i===3?'draft':'active'});
for(let i=0;i<12;i++){
 const order=id(100+i),at=`2026-10-${String(i+1).padStart(2,'0')}T12:00:00Z`;
 await insert('purchase_orders',{id:order,organization_id:org,location_id:loc,supplier_id:supplier,status:i<3?'ordered':'received',created_at:at,ordered_at:at,order_number:String(i)});
 await insert('purchase_order_lines',{id:id(200+i),organization_id:org,purchase_order_id:order,purchase_item_unit_id:id(90),ordered_purchase_qty:2});
 if(i===0||i===11){await insert('purchase_receipts',{id:id(300+i),organization_id:org,purchase_order_id:order,status:'completed',received_at:at,notes:i===11?JSON.stringify({kind:'historical_receipt_confirmation',quantities:[],confirmation:'Synthetic'}):null});await insert('purchase_receipt_lines',{id:id(400+i),organization_id:org,receipt_id:id(300+i),purchase_order_line_id:id(200+i),received_item_unit_id:id(90),quantity_received:2});}
 if(i===1)await insert('invoices',{id:id(500+i),organization_id:org,location_id:loc,supplier_id:supplier,purchase_order_id:order,status:'approved',extraction:{receiving:{status:'received'}}});
}
await insert('purchase_orders',{id:id(900),organization_id:org,location_id:hidden,status:'ordered',created_at:'2026-10-23T12:00:00Z'});
for(let i=0;i<4;i++)await insert('internal_requests',{id:id(600+i),organization_id:org,requesting_location_id:loc,fulfilling_location_id:loc,status:['draft','completed','cancelled','closed_partial'][i]});
await db.exec(`insert into sales_item_facts(id,organization_id,location_id,fact_date,quantity,net_sales,gross_sales,discounts) select gen_random_uuid(),'${org}','${loc}',date '2026-10-01'+(n%20),1,case when n%3=0 then -2 else 10 end,12,2 from generate_series(1,1501)n;`);
await insert('sales_item_facts',{id:id(999),organization_id:org,location_id:hidden,fact_date:'2026-10-20',quantity:999999,net_sales:999999});
await db.exec(await readFile(new URL('../migrations/20261023224329_operational_sales_summary.sql',import.meta.url),'utf8'));
assert.equal((await db.query("select prosecdef from pg_proc where proname='workspace_sales_summary'")).rows[0].prosecdef,false);
assert.equal((await db.query("select has_function_privilege('anon','public.workspace_sales_summary(uuid)','execute') permitted")).rows[0].permitted,false);
await db.exec(`set test.uid='${org}';set test.mfa='yes';set test.staff='no';set role authenticated;`);
const call=async(o=org)=>(await db.query('select public.workspace_sales_summary($1) data',[o])).rows[0].data;
const rows=(await db.query("select jsonb_agg(to_jsonb(t)) rows from sales_item_facts t")).rows[0].rows;
const full=projectData({sales_item_facts:rows}),summary=await call(),fast=projectData({workspace_sales_summary:summary});
assert.equal(summary.daily.length,20);assert.equal(summary.daily.reduce((n,x)=>n+x.factCount,0),1501);
const totals=p=>({total:p.total,quantity:p.quantity,growth:p.growth,factCount:p.factCount});
assert.deepEqual(totals(periodSales(full)),totals(periodSales(fast)));
assert.equal((await call()).signature,summary.signature);
await db.exec('reset role');await db.query('update sales_item_facts set quantity=quantity+1 where id=$1',[rows[0].id]);await db.exec('set role authenticated');
assert.notEqual((await call()).signature,summary.signature);
await assert.rejects(call(other),e=>e.code==='42501');await db.exec("set test.mfa='no'");await assert.rejects(call(),e=>e.code==='42501');
await db.exec(`set test.mfa='yes';set test.staff='yes';reset role;revoke select on sales_item_facts from authenticated;set role authenticated;`);
assert.deepEqual((await call()).daily,[]);
await db.close();console.log('PASS operational sales summary: exact totals, negatives, >1500 facts, content invalidation, RLS/MFA/tenant/Staff/anon isolation.');
