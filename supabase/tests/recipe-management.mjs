// Validates the recipe management migration in isolated PGlite with synthetic records. Never connects to a remote database.
// Usage: PGLITE_MODULE_PATH=<pglite> node supabase/tests/recipe-management.mjs <recipe management migration>
import fs from 'node:fs';import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE_PATH||'@electric-sql/pglite');const db=new PGlite();
const org='6013ed02-626a-497c-b951-619069035532',other='00000000-0000-0000-0000-0000000000ff',id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
// 2 recipe · 4 ingredient item · 3 its unit · 6 prep output item · 7 base unit row · 8 count unit row · 10 unit "each" · 11 unit "tray" · 12 unit "pan" · 13 another org's unit
await db.exec(`create schema private;create schema auth;create type member_role as enum('owner','admin','manager','chef');create function auth.uid() returns uuid language sql as $$select '${id(1)}'::uuid$$;create function private.has_org_role(uuid,member_role[]) returns boolean language sql as $$select current_setting('test.allowed',true)='yes'$$;create function private.can_location(uuid) returns boolean language sql as $$select true$$;set test.allowed='yes';
create table supplier_items(id uuid);create table purchase_orders(id uuid);create table purchase_order_lines(id uuid);
create table units(id uuid primary key,organization_id uuid);
create table inventory_items(id uuid primary key,organization_id uuid,name text);
create table inventory_item_units(id uuid primary key default gen_random_uuid(),organization_id uuid,inventory_item_id uuid,unit_id uuid,quantity_in_base_unit numeric default 1,is_base_unit boolean default false,is_count_unit boolean default false,check(not is_base_unit or quantity_in_base_unit=1));
create table recipes(id uuid primary key,organization_id uuid,name text,output_inventory_item_id uuid,updated_at timestamptz);create table recipe_versions(id uuid primary key default gen_random_uuid(),organization_id uuid,recipe_id uuid,version_number integer,status text,effective_from timestamptz,effective_to timestamptz,yield_quantity numeric,yield_item_unit_id uuid,notes text,created_by uuid,unique(recipe_id,version_number),check(effective_to is null or effective_from is null or effective_to>effective_from));
create table recipe_components(organization_id uuid,recipe_version_id uuid,component_inventory_item_id uuid,component_item_unit_id uuid,quantity numeric,waste_percent numeric,sort_order integer,notes text,location_id uuid,component_type text);
create table recipe_steps(recipe_version_id uuid,step_number integer,title text,instructions text,media_path text);create table audit_logs(organization_id uuid,user_id uuid,action text,entity_type text,entity_id uuid,new_data jsonb);
insert into units values('${id(10)}',null),('${id(11)}','${org}'),('${id(12)}',null),('${id(13)}','${other}');
insert into inventory_items values('${id(6)}','${org}','Panini Mix');
insert into inventory_item_units(id,organization_id,inventory_item_id,unit_id) values('${id(3)}','${org}','${id(4)}','${id(10)}');
insert into inventory_item_units(id,organization_id,inventory_item_id,unit_id,quantity_in_base_unit,is_base_unit,is_count_unit) values('${id(7)}','${org}','${id(6)}','${id(10)}',1,true,true),('${id(8)}','${org}','${id(6)}','${id(11)}',10,false,true);
insert into recipes values('${id(2)}','${org}','Panini Mix','${id(6)}',null);insert into recipe_versions(id,organization_id,recipe_id,version_number,status,effective_from,yield_quantity,yield_item_unit_id) values('${id(5)}','${org}','${id(2)}',1,'active',now(),50,'${id(7)}');insert into recipe_steps values('${id(5)}',1,'Step','Prepare','');`);
const original=fs.readFileSync('supabase/migrations/20261005113923_authenticated_web_operations_and_store_counts.sql','utf8');await db.exec(original.slice(original.indexOf('create or replace function private.web_operation'),original.indexOf('revoke all on function private.web_operation')));
await db.exec(fs.readFileSync('supabase/migrations/20261012190801_recipe_edits_activate_new_version.sql','utf8'));
const migration=fs.readFileSync(process.argv[2],'utf8');await db.exec(migration);
await assert.rejects(db.exec(migration),/already installed/);
const component={itemId:id(4),itemUnitId:id(3),quantity:9,kind:'ingredient'};
const one=async sql=>(await db.query(sql)).rows[0];
const active=async()=>one("select * from recipe_versions where status='active'");
const recipe=()=>one(`select * from recipes where id='${id(2)}'`);
const versionCount=async()=>Number((await one('select count(*) n from recipe_versions')).n);
const save=async extra=>db.query("select private.web_operation('recipe',$1::jsonb)",[JSON.stringify({id:id(2),expectedVersionId:(await active()).id,components:[component],...extra})]);

// Components-only save keeps every management value, and copies yield and steps.
await save({});let r=await recipe(),v=await active();assert.equal(r.use_by_days,null);assert.equal(r.name,'Panini Mix');assert.equal(v.yield_quantity,'50');assert.equal(v.yield_item_unit_id,id(7));
// Use by
await save({useByDays:3});assert.equal((await recipe()).use_by_days,3);
await save({});assert.equal((await recipe()).use_by_days,3,'absent key keeps the value');
await save({useByDays:null});assert.equal((await recipe()).use_by_days,null,'null clears');
await save({useByDays:4});
// Name renames the recipe and its prep item
await save({name:'  Panini Mix Classic  '});assert.equal((await recipe()).name,'Panini Mix Classic');assert.equal((await one(`select name from inventory_items where id='${id(6)}'`)).name,'Panini Mix Classic');
// Conversions update existing factors and add new units; the base unit stays at 1
await save({units:[{unitId:id(11),factor:12},{unitId:id(12),factor:24}]});
assert.equal((await one(`select quantity_in_base_unit q from inventory_item_units where id='${id(8)}'`)).q,'12');
assert.equal((await one(`select quantity_in_base_unit q from inventory_item_units where inventory_item_id='${id(6)}' and unit_id='${id(12)}'`)).q,'24');
await save({units:[{unitId:id(10),factor:1}]});
// Yield goes to the new version only; earlier versions keep theirs
await save({yieldQuantity:4,yieldUnitId:id(12)});v=await active();assert.equal(v.yield_quantity,'4');assert.equal((await one(`select unit_id from inventory_item_units where id='${v.yield_item_unit_id}'`)).unit_id,id(12));
assert.equal((await one(`select yield_quantity from recipe_versions where id='${id(5)}'`)).yield_quantity,'50');
// A unit added in the same save can become the yield unit
await save({units:[{unitId:id(12),factor:24}],yieldQuantity:2,yieldUnitId:id(12)});
// Rejections roll back the whole save
const before={count:await versionCount(),recipe:await recipe()};
const bad=[[{useByDays:0},/Validade/],[{useByDays:366},/Validade/],[{useByDays:2.5},/Validade/],[{useByDays:'3'},/Validade/],
 [{name:''},/Nome/],[{name:'   '},/Nome/],[{name:'x'.repeat(121)},/Nome/],[{name:5},/Nome/],
 [{units:[{unitId:id(10),factor:2}]},/base/],[{units:[{unitId:id(11),factor:0}]},/Conversão/],[{units:[{unitId:id(13),factor:2}]},/Unidade/],[{units:{}},/Conversões/],
 [{yieldQuantity:0,yieldUnitId:id(10)},/Rendimento/],[{yieldQuantity:3},/rendimento/],[{yieldQuantity:3,yieldUnitId:id(13)},/rendimento/],
 [{name:'Renamed',useByDays:0},/Validade/]];
for(const [extra,error] of bad)await assert.rejects(save(extra),error,JSON.stringify(extra));
assert.equal(await versionCount(),before.count,'rejected saves create no version');assert.deepEqual(await recipe(),before.recipe,'rejected saves change no recipe field');
assert.equal((await one(`select quantity_in_base_unit q from inventory_item_units where id='${id(8)}'`)).q,'12');
await assert.rejects(db.query(`update recipes set use_by_days=0 where id='${id(2)}'`),/recipes_use_by_days_range/);
// Recipes without a prep item cannot take conversions or yield units
await db.exec(`update recipes set output_inventory_item_id=null where id='${id(2)}'`);await assert.rejects(save({units:[{unitId:id(11),factor:2}]}),/sem item/);await assert.rejects(save({yieldQuantity:1,yieldUnitId:id(10)}),/rendimento/);
await db.exec(`update recipes set output_inventory_item_id='${id(6)}' where id='${id(2)}'`);
await db.exec("set test.allowed='no'");await assert.rejects(save({useByDays:5}));await db.exec("set test.allowed='yes'");assert.equal((await recipe()).use_by_days,4);
await db.close();console.log('PASS recipe management: use by, name with prep item, conversions with base guard, per-version yield, unchanged when absent, rollback on invalid input, constraint and role denial');
