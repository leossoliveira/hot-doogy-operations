import {pathToFileURL,fileURLToPath} from 'node:url';
if(!process.argv[2])throw Error('Pass the path to a locally installed @electric-sql/pglite module.');
const {PGlite}=await import(pathToFileURL(process.argv[2]).href);
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../../',import.meta.url));
const db=new PGlite();
await db.exec(`create schema private;create schema auth;create type public.member_role as enum('owner','admin','manager','chef','staff');
create function auth.uid() returns uuid language sql as $$ select '11111111-1111-4111-8111-111111111111'::uuid $$;
create function private.has_org_role(uuid,public.member_role[]) returns boolean language sql as $$select true$$;
create function private.can_location(uuid) returns boolean language sql as $$select $1='22222222-2222-4222-8222-222222222222'::uuid$$;
create table locations(id uuid,organization_id uuid);create table inventory_item_units(id uuid,inventory_item_id uuid,organization_id uuid,is_count_unit boolean,quantity_in_base_unit numeric);
create table location_inventory_items(inventory_item_id uuid,location_id uuid,active boolean);
create table supplier_items(id uuid);create table purchase_orders(id uuid);create table recipe_versions(id uuid);create table purchase_order_lines(id uuid);
create table audit_logs(organization_id uuid,user_id uuid,action text,entity_type text,entity_id uuid,new_data jsonb);
create table store_count_observations(id uuid,organization_id uuid,location_id uuid,inventory_item_id uuid,item_unit_id uuid,quantity numeric,quantity_base numeric,counted_on date not null,moment text not null check(moment in ('Antes da abertura','Durante a operação','Após o fechamento')),session_id uuid,created_by uuid,created_at timestamptz default now());
insert into locations values('22222222-2222-4222-8222-222222222222','6013ed02-626a-497c-b951-619069035532');
insert into inventory_item_units values('33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','6013ed02-626a-497c-b951-619069035532',true,1);
insert into location_inventory_items values('44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222',true);`);
const original=await readFile(root+'supabase/migrations/20261005113923_authenticated_web_operations_and_store_counts.sql','utf8');
await db.exec(original.slice(original.indexOf('create or replace function private.web_operation'),original.indexOf('revoke all on function private.web_operation')));
await db.exec(await readFile(root+'supabase/migrations/20261008125044_inventory_count_device_completion.sql','utf8'));
await db.exec(await readFile(root+'supabase/migrations/20261008125059_inventory_count_notes_issues.sql','utf8'));

await db.exec(`create role anon;create role authenticated;create table stock_counts(id uuid);create table public.organizations(id uuid primary key);create table auth.users(id uuid primary key);
insert into public.organizations values('6013ed02-626a-497c-b951-619069035532');
insert into auth.users values('11111111-1111-4111-8111-111111111111'),('99999999-9999-4999-8999-999999999999');
alter table public.locations add primary key(id);
alter table public.location_inventory_items add column id uuid default '77777777-7777-4777-8777-777777777777';
create function private.mfa_authorized() returns boolean language sql as $$select true$$;
create function public.operations_current_preparer() returns jsonb language sql as $$select '{"name":"Authenticated Employee"}'::jsonb$$;
insert into inventory_item_units values('33333333-3333-4333-8333-333333333334','44444444-4444-4444-8444-444444444445','6013ed02-626a-497c-b951-619069035532',true,10);
insert into location_inventory_items values('44444444-4444-4444-8444-444444444445','22222222-2222-4222-8222-222222222222',true,'77777777-7777-4777-8777-777777777778');`);
await db.exec(await readFile(root+'supabase/migrations/20261019110004_inventory_count_drafts_and_section_updates.sql','utf8'));
await db.exec(await readFile(root+'supabase/migrations/20261019173433_inventory_count_configured_units.sql','utf8'));
const id='55555555-5555-4555-8555-555555555555',locationId='22222222-2222-4222-8222-222222222222';
let version=0;
const state={notes:'Draft notes',lines:[{rowId:'77777777-7777-4777-8777-777777777777',itemId:'44444444-4444-4444-8444-444444444444',itemUnitId:'33333333-3333-4333-8333-333333333333',section:'Freezer',qty:'3',issue:'Check packaging'},{rowId:'77777777-7777-4777-8777-777777777778',itemId:'44444444-4444-4444-8444-444444444445',itemUnitId:'33333333-3333-4333-8333-333333333334',section:'Dry',qty:''}]};
const call=async p=>(await db.query('select public.save_inventory_count($1::jsonb) result',[JSON.stringify(p)])).rows[0].result;
const request=(action='save',extra={})=>({id,locationId,requestId:crypto.randomUUID(),expectedVersion:version,countOffsetMinutes:240,action,state:structuredClone(state),...extra});
const save=async(action='save',extra={})=>{const result=await call(request(action,extra));version=result.version;return result;};
const quantity=async()=> (await db.query(`select inventory_item_id,quantity,quantity_base,counted_at from store_count_observations where session_id='55555555-5555-4555-8555-555555555555' order by inventory_item_id`)).rows;
let result=await save();assert.equal(result.status,'draft');assert.equal(result.employee_name,'Authenticated Employee');assert.equal((await quantity()).length,0);
assert.equal((await db.query('select state from inventory_count_sessions')).rows[0].state.notes,'Draft notes');
// Notes and blank edits survive a fresh read without publishing stock.
state.notes='Saved before closing';state.lines[0].qty='4';await save();assert.equal((await quantity()).length,0);
await db.query("select private.web_operation('counts',$1::jsonb)",[JSON.stringify({id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',locationId,date:'2026-10-19',moment:'Antes da abertura',employeeName:'Earlier count',lines:[{itemId:state.lines[0].itemId,itemUnitId:state.lines[0].itemUnitId,qty:99}]})]);
const section=request('section',{section:'Freezer'});result=await call(section);version=result.version;
assert.equal(result.status,'draft');assert.equal((await quantity()).length,1);assert.equal(Number((await quantity())[0].quantity),4);
const firstAt=(await quantity())[0].counted_at;assert.equal((await call(section)).version,version);assert.equal((await quantity()).length,1);
// Same UUID cannot replay a different request; stale tabs and foreign locations are denied.
await assert.rejects(call({...section,state:{...section.state,notes:'tampered'}}));
await assert.rejects(call(request('save',{expectedVersion:version-1})));await assert.rejects(call(request('save',{locationId:'66666666-6666-4666-8666-666666666666'})));
await db.exec(`create or replace function auth.uid() returns uuid language sql as $$select '99999999-9999-4999-8999-999999999999'::uuid$$`);
await assert.rejects(call(request()));
await db.exec(`create or replace function auth.uid() returns uuid language sql as $$select '11111111-1111-4111-8111-111111111111'::uuid$$`);
// The editor offers configured units beyond the default count unit.
await db.exec(`insert into inventory_item_units values('33333333-3333-4333-8333-333333333335','44444444-4444-4444-8444-444444444444','6013ed02-626a-497c-b951-619069035532',false,12)`);
state.lines[0].itemUnitId='33333333-3333-4333-8333-333333333335';
await save();await save('section',{section:'Freezer'});
assert.equal(Number((await quantity())[0].quantity_base),48);
// A different item's unit and zero conversion remain invalid; draft survives.
const validState=structuredClone(state);
state.lines[0].itemUnitId=state.lines[1].itemUnitId;await assert.rejects(save());
state.lines=structuredClone(validState.lines);
await db.exec(`update inventory_item_units set quantity_in_base_unit=0 where id='33333333-3333-4333-8333-333333333335'`);
await assert.rejects(save());
await db.exec(`update inventory_item_units set quantity_in_base_unit=12 where id='33333333-3333-4333-8333-333333333335'`);
assert.deepEqual((await db.query('select state from inventory_count_sessions')).rows[0].state,validState);
// A pending edit does not alter stock; completing again replaces only this count's item.
state.lines[0].qty='6';await save();assert.equal(Number((await quantity())[0].quantity),4);
await save('section',{section:'Freezer'});assert.equal((await quantity()).length,1);assert.equal(Number((await quantity())[0].quantity),6);
const editedAt=(await quantity())[0].counted_at;
// Failure partway through completion rolls back all observations and the draft transition.
await db.exec(`create function private.fail_dry() returns trigger language plpgsql as $$begin if new.inventory_item_id='44444444-4444-4444-8444-444444444445'::uuid then raise exception 'synthetic failure';end if;return new;end$$;create trigger fail_dry before insert on store_count_observations for each row execute function private.fail_dry();`);
await assert.rejects(save('complete'));assert.equal((await quantity()).length,1);assert.equal((await db.query('select status from inventory_count_sessions')).rows[0].status,'draft');
await db.exec('drop trigger fail_dry on store_count_observations');
result=await save('complete');assert.equal(result.status,'completed');const rows=await quantity();assert.equal(rows.length,2);assert.equal(Number(rows[1].quantity),0);assert.equal(Number(rows[1].quantity_base),0);assert.equal(rows[0].counted_at.toISOString(),editedAt.toISOString());await assert.rejects(save());
assert.equal(Number((await db.query("select quantity from store_count_observations where session_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'")).rows[0].quantity),99);
// Table writes and anonymous RPC access remain unavailable.
const grants=(await db.query("select has_table_privilege('authenticated','public.inventory_count_sessions','INSERT') can_insert,has_function_privilege('anon','public.save_inventory_count(jsonb)','EXECUTE') anon_execute")).rows[0];assert.equal(grants.can_insert,false);assert.equal(grants.anon_execute,false);
assert.equal((await db.query("select relrowsecurity from pg_class where oid='public.inventory_count_sessions'::regclass")).rows[0].relrowsecurity,true);
// A caller cannot attach a new draft to an older count identity.
await db.query('insert into stock_counts values($1)', ['88888888-8888-4888-8888-888888888888']);
await assert.rejects(call(request('save',{id:'88888888-8888-4888-8888-888888888888',expectedVersion:0})));
// Exercise RLS as the real database role, including MFA and location denial.
await db.exec('grant usage on schema private to authenticated;set role authenticated');
assert.equal((await db.query('select count(*)::integer n from inventory_count_sessions')).rows[0].n,1);
await assert.rejects(db.exec('delete from inventory_count_sessions'));
await db.exec('reset role;create or replace function private.mfa_authorized() returns boolean language sql as $$select false$$;set role authenticated');
assert.equal((await db.query('select count(*)::integer n from inventory_count_sessions')).rows[0].n,0);
await assert.rejects(call(request('save',{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',expectedVersion:0})));
await db.exec('reset role;create or replace function private.mfa_authorized() returns boolean language sql as $$select true$$;create or replace function private.can_location(uuid) returns boolean language sql as $$select false$$;set role authenticated');
assert.equal((await db.query('select count(*)::integer n from inventory_count_sessions')).rows[0].n,0);
await db.exec('reset role');
console.log('PASS: persistent drafts, resume, version/creator/location guards, section inventory, blank zero, retry idempotency, atomic completion and RPC/table permissions.');
await db.close();
