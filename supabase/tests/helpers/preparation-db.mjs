import fs from 'node:fs';
export const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
export const org='6013ed02-626a-497c-b951-619069035532',plaza='a74401ec-ce6e-4df4-ad5d-71ce11af4351',mall='d61fa7fe-fbe7-41cd-b45c-6527fae9b6b6';
const read=name=>fs.readFileSync(new URL('../../migrations/'+name,import.meta.url),'utf8');
export async function createPreparationDatabase(){
 const {PGlite}=await import(process.env.PGLITE_MODULE_PATH||'@electric-sql/pglite');const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema private;create schema doogy_operations;
 create type member_role as enum('owner','admin','manager','chef','staff');create type prep_batch_status as enum('planned','in_progress','completed','cancelled');
 create table auth.users(id uuid primary key);create table organizations(id uuid primary key);
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql as $$select '{}'::jsonb$$;
 create function private.mfa_authorized() returns boolean language sql as $$select coalesce(current_setting('test.mfa',true),'')='yes'$$;
 create function private.has_org_role(uuid,member_role[]) returns boolean language sql as $$select auth.uid() is not null and coalesce(current_setting('test.role',true),'owner')=any($2::text[])$$;
 create function private.can_location(uuid) returns boolean language sql as $$select $1='${plaza}'::uuid$$;
 create function private.can_storage(uuid) returns boolean language sql as $$select $1 in ('${id(10)}'::uuid,'${id(11)}'::uuid)$$;
 create function private.is_org_member(uuid) returns boolean language sql as $$select true$$;
 create table locations(id uuid primary key,organization_id uuid,active boolean default true);
 create table storage_areas(id uuid primary key,organization_id uuid,location_id uuid,active boolean default true);
 create table inventory_items(id uuid primary key,organization_id uuid,internal_name text,name text,active boolean default true);
 create table units(id uuid primary key,code text,name text);
 create table inventory_item_units(id uuid primary key,organization_id uuid,inventory_item_id uuid,unit_id uuid,quantity_in_base_unit numeric);
 create table location_inventory_items(inventory_item_id uuid,location_id uuid,active boolean default true,default_storage_area_id uuid,primary key(inventory_item_id,location_id));
 create table inventory_item_storage_areas(inventory_item_id uuid,location_id uuid,storage_area_id uuid,primary key(inventory_item_id,location_id,storage_area_id));
 create table recipes(id uuid primary key,organization_id uuid,name text,output_inventory_item_id uuid,production_location_id uuid,classification text,active boolean default true);
 create table recipe_versions(id uuid primary key,organization_id uuid,recipe_id uuid,status text,yield_quantity numeric,yield_item_unit_id uuid,version_number int);
 create table recipe_components(id uuid primary key,organization_id uuid,recipe_version_id uuid,component_inventory_item_id uuid,component_item_unit_id uuid,quantity numeric,waste_percent numeric default 0,sort_order int default 0,location_id uuid,component_type text default 'ingredient');

 create table hr_team_members(id uuid primary key,organization_id uuid,first_name text,last_name text,status text,location_ids uuid[]);
 create table prep_plans(id uuid primary key,organization_id uuid,location_id uuid);create table prep_plan_items(id uuid primary key,prep_plan_id uuid,inventory_item_id uuid);
 create table inventory_transactions(id uuid primary key default gen_random_uuid(),organization_id uuid,location_id uuid,storage_area_id uuid,inventory_item_id uuid,transaction_type text,quantity_base numeric(18,6),source_type text,source_id uuid,occurred_at timestamptz,created_by uuid);
 create table audit_logs(organization_id uuid,location_id uuid,user_id uuid,action text,entity_type text,entity_id uuid,new_data jsonb);
 create table private.web_commands(command_id uuid primary key,actor uuid,payload jsonb,result jsonb);
 grant usage on schema auth,private to authenticated;
 insert into organizations values('${org}');insert into auth.users values('${id(1)}');
 insert into locations(id,organization_id) values('${plaza}','${org}'),('${mall}','${org}'),('${id(99)}','${id(99)}');
 insert into storage_areas(id,organization_id,location_id) values('${id(10)}','${org}','${plaza}'),('${id(11)}','${org}','${plaza}'),('${id(12)}','${org}','${mall}');
 insert into hr_team_members values('${id(2)}','${org}','Synthetic','Cook','active',array['${plaza}']::uuid[]);
 insert into units values('${id(3)}','unit','Unit');
 insert into inventory_items(id,organization_id,internal_name) values('${id(20)}','${org}','Synthetic Prep'),('${id(21)}','${org}','Synthetic Ingredient'),('${id(22)}','${org}','Synthetic Subprep'),('${id(23)}','${org}','Outside Prep');
 insert into inventory_item_units values('${id(30)}','${org}','${id(20)}','${id(3)}',10),('${id(31)}','${org}','${id(21)}','${id(3)}',2),('${id(32)}','${org}','${id(22)}','${id(3)}',1),('${id(33)}','${org}','${id(23)}','${id(3)}',1);
 insert into location_inventory_items select i.id,l.id,true,case when l.id='${plaza}' then '${id(10)}'::uuid else '${id(12)}'::uuid end from inventory_items i cross join locations l where l.organization_id='${org}';
 insert into inventory_item_storage_areas select inventory_item_id,location_id,default_storage_area_id from location_inventory_items;
 insert into recipes values('${id(40)}','${org}','Synthetic Prep','${id(20)}','${plaza}','prep_recipe',true);
 insert into recipe_versions values('${id(41)}','${org}','${id(40)}','active',2,'${id(30)}',1);
 insert into recipe_components(id,organization_id,recipe_version_id,component_inventory_item_id,component_item_unit_id,quantity,waste_percent,sort_order) values('${id(42)}','${org}','${id(41)}','${id(21)}','${id(31)}',4,0.2,1),('${id(43)}','${org}','${id(41)}','${id(22)}','${id(32)}',3,0,2);
 insert into inventory_transactions(organization_id,location_id,storage_area_id,inventory_item_id,transaction_type,quantity_base) values('${org}','${plaza}','${id(10)}','${id(21)}','initial',10000),('${org}','${plaza}','${id(10)}','${id(22)}','initial',10000);
 `);
 const prep=read('20260912175219_041_048_prep_forecasts_ai.sql');
 await db.exec(prep.slice(prep.indexOf('create table public.prep_batches'),prep.indexOf('-- Original section 45:')));
 await db.exec('alter table prep_batches add column prepared_team_member_id uuid,add column prepared_team_member_name text,add column prepared_assignment_version integer default 0;');
 await db.exec(read('20260923124125_internal_requests_interstore_dispatch_receiving.sql'));
 await db.exec(read('20260923124316_internal_requests_preparation_link_and_unit_precision.sql'));
 // Load the real legacy production branch and real MFA command boundary. Other operation
 // branches are excluded because this fixture intentionally contains no purchasing tables.
 const legacy=read('20261005113923_authenticated_web_operations_and_store_counts.sql');
 const branch=legacy.split(" elsif p_action='production' then")[1].split(" elsif p_action='invoices' then")[0];
 await db.exec(`create function private.web_operation(p_action text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
 #variable_conflict use_variable
 declare org uuid:='${org}';actor uuid:=auth.uid();id uuid;loc uuid;item uuid;area uuid;version_id uuid;quantity numeric;u public.inventory_item_units;
 begin
 if actor is null or not private.has_org_role(org,array['owner','admin','manager','chef']::public.member_role[]) then raise exception 'Access denied' using errcode='42501';end if;
 if p_action='unused' then raise exception 'Unused branch';elsif p_action='production' then ${branch}
 else raise exception 'Unsupported';end if;return jsonb_build_object('id',id,'saved',true);end $$;`);
 const optimized=read('20261005183909_optimize_mfa_read_authorization.sql');
 await db.exec(optimized.slice(optimized.indexOf('CREATE OR REPLACE FUNCTION private.web_command('),optimized.indexOf('CREATE OR REPLACE FUNCTION private.web_preparation_sales(')));
 await db.exec(legacy.slice(legacy.indexOf('create or replace function public.operations_command('),legacy.indexOf('create or replace function private.web_preparation_sales(')));
 await db.exec(read('20261021124641_atomic_preparation_and_whatsapp_service.sql'));
 await db.exec(read('20261022011850_preparation_registered_production_location.sql'));
 return db;
}
