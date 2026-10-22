import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE_PATH).href);
const db=new PGlite(),org='6013ed02-626a-497c-b951-619069035532';
const tables=['public.menu_items','public.location_menu_items','public.pos_item_mappings','public.pos_modifier_mappings','public.modifiers','public.menu_item_modifier_rules','public.recipes','public.recipe_versions','public.recipe_components','public.inventory_item_units','public.inventory_items','public.locations','private.modifier_recipe_contexts','private.combo_selection_options','private.menu_sales_consumption_policies','public.units'];
await db.exec(`create schema private;create role anon;create role authenticated;create role service_role;create sequence private.hash_calls;`);
for(const table of tables)await db.exec(`create table ${table}(id integer primary key,value text);insert into ${table} values(1,'initial');`);
await db.exec(`create function private.restaurant_catalog_signature(uuid) returns text language sql stable as $$select nextval('private.hash_calls')::text$$;
create function private.preparation_sales_page(p_after uuid,p_limit integer,p_signature text,p_start date,p_end date,p_location uuid,p_scoped boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare org uuid:='${org}';signature text;deadline timestamptz;processed integer:=0;f record;begin
 signature := private.restaurant_catalog_signature(org);
 deadline := clock_timestamp()+interval '1 second';
 for f in select s.id from public.menu_items s order by s.id limit p_limit+1 loop
 if processed>=p_limit or clock_timestamp()>deadline then exit;end if;processed:=processed+1;
 end loop;return jsonb_build_object('processed',processed,'signature',signature);end $$;`);
await db.exec(await readFile(new URL('../migrations/20261022143712_cache_preparation_catalog_signatures.sql',import.meta.url),'utf8'));
const signature=async()=>(await db.query('select private.preparation_catalog_signature($1) value',[org])).rows[0].value;
const calls=async()=>Number((await db.query('select last_value from private.hash_calls')).rows[0].last_value);
assert.equal(await signature(),'1');assert.equal(await signature(),'1');assert.equal(await calls(),1);
let mutations=0;
for(const table of tables){
 for(const sql of [`insert into ${table} values(2,'new')`,`update ${table} set value='changed' where id=2`,`delete from ${table} where id=2`,`truncate ${table}`]){
  const before=await calls();await db.exec(sql);await signature();assert.equal(await calls(),before+1);await signature();assert.equal(await calls(),before+1);mutations++;
 }
}
// Invalidations roll back with catalog edits, preserving the previously valid hash.
const before=await signature();await db.exec('begin;insert into public.units values(9,\'rollback\');rollback;');assert.equal(await signature(),before);
// The hash algorithm itself is also part of the key.
await db.exec(`create or replace function private.restaurant_catalog_signature(uuid) returns text language sql stable as $$select 'new-engine-'||nextval('private.hash_calls')::text$$;`);
assert.ok((await signature()).startsWith('new-engine-'));
for(const role of ['anon','authenticated','service_role']){
 assert.equal((await db.query(`select has_table_privilege('${role}','private.preparation_catalog_signatures','select') allowed`)).rows[0].allowed,false);
 assert.equal((await db.query(`select has_function_privilege('${role}','private.preparation_catalog_signature(uuid)','execute') allowed`)).rows[0].allowed,false);
}
await db.exec('insert into public.menu_items select n,\'stress\' from generate_series(1,100)n;');
const page=(await db.query('select private.preparation_sales_page(null,250,null,null,null,null,false) value')).rows[0].value;
assert.equal(page.processed,64);
await db.close();console.log(JSON.stringify({passed:true,sourceTables:tables.length,mutationInvalidations:mutations,checks:'hash reuse, INSERT/UPDATE/DELETE/TRUNCATE invalidation, rollback, engine changes, permissions, 64-row cap'}));
