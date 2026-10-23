import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {TABLES,FACT_COLUMNS} from '../../server/live-data.mjs';
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE_PATH).href);
const db=new PGlite(),org='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
await db.exec(`create schema auth;create schema private;create role authenticated;create role anon;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
create function private.mfa_authorized() returns boolean language sql stable as $$select current_setting('test.mfa',true)='yes'$$;
create function private.is_org_member(uuid) returns boolean language sql stable as $$select $1='${org}'::uuid$$;
grant usage on schema auth,private to authenticated;`);
for(const table of TABLES){
 const extra=table==='sales_item_facts'?FACT_COLUMNS.filter(c=>!['id','organization_id','location_id'].includes(c)).map(c=>c+' text'):table==='inventory_count_sessions'?['created_by uuid','employee_name text','status text','state jsonb','published jsonb','version integer','created_at timestamptz','updated_at timestamptz','completed_at timestamptz']:[];
 await db.exec(`create table public.${table}(id uuid primary key,organization_id uuid,location_id uuid,is_system boolean default false${extra.length?','+extra.join(','):''});
 alter table public.${table} enable row level security;
 create policy user_scope on public.${table} for select to authenticated using((organization_id='${org}' and location_id='${org}')${table==='units'?' or (organization_id is null and is_system)':''});
 insert into public.${table}(id,organization_id,location_id) values ('${org}','${org}','${org}'),('${other}','${other}','${other}'),('33333333-3333-4333-8333-333333333333','${org}','${other}');`);
}
await db.exec(`grant select on all tables in schema public to authenticated;
insert into units(id,is_system) values('44444444-4444-4444-8444-444444444444',true),('55555555-5555-4555-8555-555555555555',false);
insert into inventory_transactions(id,organization_id,location_id) select ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${org}','${org}' from generate_series(1,501)n;
insert into sales_item_facts(id,organization_id,location_id) select ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${org}','${org}' from generate_series(1,1001)n;`);
await db.exec(await readFile(new URL('../migrations/20261021013805_bounded_workspace_read_batches.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../migrations/20261023120837_indexed_workspace_sales_pages.sql',import.meta.url),'utf8'));
assert.equal((await db.query("select prosecdef from pg_proc where proname='workspace_read_batch'")).rows[0].prosecdef,false);
assert.equal((await db.query("select has_function_privilege('anon','public.workspace_read_batch(uuid,text[])','execute') permitted")).rows[0].permitted,false);
await db.exec(`set test.uid='${org}';set test.mfa='yes';set role authenticated;`);
const call=async(tables,organization=org)=>(await db.query('select public.workspace_read_batch($1,$2) data',[organization,tables])).rows[0].data;
for(let i=0;i<TABLES.length;i+=8){
 const tables=TABLES.slice(i,i+8),result=await call(tables);assert.deepEqual(Object.keys(result).sort(),tables.slice().sort());
 for(const table of tables){
  const rows=result[table];assert.ok(rows.length>=1);assert.ok(rows.length<=(table==='sales_item_facts'?1000:500));
  assert.ok(rows.every(row=>row.organization_id===org||table==='units'&&row.organization_id===null));
  assert.ok(rows.every(row=>row.location_id===org||table==='units'&&row.location_id===null));
  assert.deepEqual(rows.map(r=>r.id),rows.map(r=>r.id).sort());
 }
}
assert.equal((await call(['units'])).units.length,2);
assert.equal((await call(['inventory_transactions'])).inventory_transactions.length,500);
assert.equal((await call(['sales_item_facts'])).sales_item_facts.length,1000);
for(const tables of [[],Array(9).fill('locations'),['auth.users'],['invoices; drop table invoices'],[null]])await assert.rejects(call(tables),e=>e.code==='22023');
await assert.rejects(call(['locations'],other),e=>e.code==='42501');
await db.exec("set test.mfa='no';");await assert.rejects(call(['locations']),e=>e.code==='42501');
await db.exec("set test.mfa='yes';set test.uid='';");await assert.rejects(call(['locations']),e=>e.code==='42501');
await db.exec(`reset role;set test.uid='${org}';revoke select on invoices from authenticated;set role authenticated;`);
await assert.rejects(call(['invoices']),e=>e.code==='42501');
await db.close();console.log(`Bounded workspace batches: ${TABLES.length} tables; complete keys, ordered first pages, role/RLS/MFA/tenant isolation, size limits and injection rejection passed.`);
