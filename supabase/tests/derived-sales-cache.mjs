import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE_PATH).href);
const db=new PGlite(),id='11111111-1111-4111-8111-111111111111';
await db.exec(`create schema private;create role anon;create role authenticated;create role service_role;
create table sales_import_batches(id uuid primary key,organization_id uuid,location_id uuid,period_start date,period_end date);
create table sales_import_rows(id uuid primary key,batch_id uuid references sales_import_batches,raw_data jsonb);
create table private.restaurant_sale_cache(source_row_id uuid primary key references sales_import_rows,catalog_signature text not null,raw_signature text not null,evaluation jsonb not null);
revoke all on private.restaurant_sale_cache from public,anon,authenticated;
create table public.locations(id uuid primary key);insert into public.locations values('${id}');
create function private.can_location(uuid) returns boolean language sql stable as $$select $1='${id}'::uuid and current_setting('test.location',true) is distinct from 'no'$$;
create sequence private.evaluations;
create function private.restaurant_evaluate_sale(p_row uuid) returns jsonb language plpgsql as $$begin
 perform nextval('private.evaluations');return (select raw_data from public.sales_import_rows where id=p_row);end$$;
create function private.restaurant_evaluate_cached(p_row uuid,signature text) returns jsonb language sql stable as $$select raw_data from public.sales_import_rows where id=p_row$$;
create function private.web_preparation_sales(integer,integer) returns jsonb language plpgsql security definer set search_path='' as $$declare signature text:='catalog-a';begin
 if current_setting('test.allowed',true)<>'yes' then raise exception 'denied' using errcode='42501';end if;
 return (select private.restaurant_evaluate_cached(f.source_row_id,signature) from (select '${id}'::uuid source_row_id,'${id}'::uuid location_id)f where private.can_location(f.location_id));end$$;
create function private.preparation_usage_period(date,date,uuid,integer,integer) returns jsonb language plpgsql security definer set search_path='' as $$declare signature text:='catalog-a';begin
 if current_setting('test.allowed',true)<>'yes' then raise exception 'denied' using errcode='42501';end if;
 return (select private.restaurant_evaluate_cached(f.source_row_id,signature) from (select '${id}'::uuid source_row_id,'${id}'::uuid location_id)f where private.can_location(f.location_id));end$$;
grant usage on schema private to authenticated;
insert into sales_import_batches values('${id}','${id}','${id}','2026-01-01','2026-01-02');
insert into sales_import_rows values('${id}','${id}','{"usage":[{"quantity_base":3}]}');`);
const definitions=()=>db.query("select proname,pg_get_functiondef(oid) definition from pg_proc where proname in ('web_preparation_sales','preparation_usage_period') order by proname");
const before=(await definitions()).rows;
await db.exec(await readFile(new URL('../migrations/20261021021507_refresh_derived_sales_cache.sql',import.meta.url),'utf8'));
assert.deepEqual((await definitions()).rows,before.map(r=>({...r,definition:r.definition.replace('private.restaurant_evaluate_cached(f.source_row_id,signature)','private.restaurant_evaluate_refresh_cache(f.source_row_id,signature)').replace('private.can_location(f.location_id)','f.location_id in (select allowed_location.id from public.locations allowed_location where private.can_location(allowed_location.id))')})));
for(const role of ['anon','authenticated'])assert.equal((await db.query(`select has_function_privilege('${role}','private.restaurant_evaluate_refresh_cache(uuid,text)','execute') allowed`)).rows[0].allowed,false);
const evaluate=async(signature='catalog-a')=>(await db.query('select private.restaurant_evaluate_refresh_cache($1,$2) value',[id,signature])).rows[0].value;
const calls=async()=>Number((await db.query('select last_value from private.evaluations')).rows[0].last_value);
const original=await evaluate();assert.deepEqual(await evaluate(),original);assert.equal(await calls(),1);
assert.deepEqual(await evaluate('catalog-b'),original);assert.equal(await calls(),2);
await db.exec(`update sales_import_rows set raw_data='{"usage":[{"quantity_base":7}]}'`);
assert.equal((await evaluate('catalog-b')).usage[0].quantity_base,7);assert.equal(await calls(),3);
for(const column of ['organization_id','location_id','period_start','period_end']){
 const value=column.endsWith('_id')?'22222222-2222-4222-8222-222222222222':'2026-02-01';
 const previous=await calls();await db.exec(`update sales_import_batches set ${column}='${value}'`);
 await evaluate('catalog-b');assert.equal(await calls(),previous+1);await evaluate('catalog-b');assert.equal(await calls(),previous+1);
}
await db.exec("set test.allowed='no';set role authenticated;");
await assert.rejects(db.query('select private.web_preparation_sales(0,25)'),e=>e.code==='42501');
await assert.rejects(db.query('select private.preparation_usage_period(null,null,null,0,25)'),e=>e.code==='42501');
await assert.rejects(evaluate(),e=>e.code==='42501');
await db.exec("set test.allowed='yes';");
assert.equal((await db.query('select private.web_preparation_sales(0,25) value')).rows[0].value.usage[0].quantity_base,7);
assert.equal((await db.query('select private.preparation_usage_period(null,null,null,0,25) value')).rows[0].value.usage[0].quantity_base,7);
await db.exec("set test.location='no';");
assert.equal((await db.query('select private.web_preparation_sales(0,25) value')).rows[0].value,null);
assert.equal((await db.query('select private.preparation_usage_period(null,null,null,0,25) value')).rows[0].value,null);
await db.exec('reset role');
assert.equal((await db.query('select count(*)::int n from sales_import_rows')).rows[0].n,1);
assert.equal((await db.query('select count(*)::int n from private.restaurant_sale_cache')).rows[0].n,1);
await db.close();console.log('Derived sales cache: reuse, catalog/raw/batch invalidation, unchanged endpoint guards and restricted cache access passed.');
