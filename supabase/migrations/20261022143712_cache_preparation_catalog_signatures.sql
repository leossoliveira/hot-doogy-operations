-- Reuse the exact existing catalog hash across pages. Every source table in
-- restaurant_catalog_signature invalidates this private derived cache atomically.
create table private.preparation_catalog_signatures(
 organization_id uuid primary key,signature text,engine_md5 text,generation bigint not null default 0
);
alter table private.preparation_catalog_signatures enable row level security;
revoke all on private.preparation_catalog_signatures from public,anon,authenticated,service_role;

create function private.invalidate_preparation_catalog_signature() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 update private.preparation_catalog_signatures set signature=null,generation=generation+1;
 return null;
end $$;
revoke all on function private.invalidate_preparation_catalog_signature() from public,anon,authenticated,service_role;

do $$
declare target text;
begin
 foreach target in array array['public.menu_items','public.location_menu_items','public.pos_item_mappings',
 'public.pos_modifier_mappings','public.modifiers','public.menu_item_modifier_rules','public.recipes',
 'public.recipe_versions','public.recipe_components','public.inventory_item_units','public.inventory_items',
 'public.locations','private.modifier_recipe_contexts','private.combo_selection_options',
 'private.menu_sales_consumption_policies','public.units'] loop
 execute format('create trigger preparation_catalog_signature_changed after insert or update or delete or truncate on %s for each statement execute function private.invalidate_preparation_catalog_signature()',target::regclass);
 end loop;
end $$;

create function private.preparation_catalog_signature(p_org uuid) returns text
language plpgsql set search_path='' as $$
declare cached private.preparation_catalog_signatures%rowtype; engine text; fresh text;
begin
 engine:=md5(pg_get_functiondef('private.restaurant_catalog_signature(uuid)'::regprocedure));
 select * into cached from private.preparation_catalog_signatures where organization_id=p_org;
 if cached.signature is not null and cached.engine_md5=engine then return cached.signature;end if;
 -- Establish the row before computing so concurrent catalog edits cannot miss
 -- invalidation of a newly introduced organization's cache entry.
 insert into private.preparation_catalog_signatures(organization_id) values(p_org) on conflict do nothing;
 select * into cached from private.preparation_catalog_signatures where organization_id=p_org;
 fresh:=private.restaurant_catalog_signature(p_org);
 update private.preparation_catalog_signatures set signature=fresh,engine_md5=engine
 where organization_id=p_org and generation=cached.generation;
 return fresh;
end $$;
revoke all on function private.preparation_catalog_signature(uuid) from public,anon,authenticated,service_role;
-- Seed the existing organization without changing the catalog or invalidating
-- any per-sale evaluations. This is the same hash used before this migration.
select private.preparation_catalog_signature('6013ed02-626a-497c-b951-619069035532');

do $$
declare definition text;
begin
 definition:=pg_get_functiondef('private.preparation_sales_page(uuid,integer,text,date,date,uuid,boolean)'::regprocedure);
 if position('signature := private.restaurant_catalog_signature(org);' in definition)=0
 or position('deadline := clock_timestamp()+interval ''1 second'';' in definition)=0
 or position('order by s.id limit p_limit+1' in definition)=0
 or position('if processed>=p_limit or' in definition)=0 then
 raise exception 'Unexpected preparation page definition';end if;
 definition:=replace(definition,'signature := private.restaurant_catalog_signature(org);','signature := private.preparation_catalog_signature(org);');
 definition:=replace(definition,'deadline := clock_timestamp()+interval ''1 second'';','deadline := clock_timestamp()+interval ''250 milliseconds'';');
 definition:=replace(definition,'order by s.id limit p_limit+1','order by s.id limit least(p_limit,64)+1');
 definition:=replace(definition,'if processed>=p_limit or','if processed>=least(p_limit,64) or');
 execute definition;
end $$;
