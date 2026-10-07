create table if not exists public.recipe_production_locations (
 organization_id uuid not null references public.organizations(id),
 recipe_id uuid not null references public.recipes(id) on delete cascade,
 location_id uuid not null references public.locations(id),
 primary key(recipe_id,location_id)
);
alter table public.recipe_production_locations enable row level security;
revoke all on public.recipe_production_locations from anon,authenticated;
grant select on public.recipe_production_locations to authenticated;
create policy recipe_locations_read on public.recipe_production_locations for select to authenticated using (private.is_org_member(organization_id) and private.mfa_authorized() and private.can_location(location_id));
create trigger recipe_locations_scope before insert or update on public.recipe_production_locations for each row execute function private.validate_relationship_scope();
insert into public.recipe_production_locations(organization_id,recipe_id,location_id) select organization_id,id,production_location_id from public.recipes where production_location_id is not null on conflict do nothing;
-- Atomic recipe registration. Existing table write permissions remain unchanged.
create or replace function private.recipe_create(p_payload jsonb,p_command_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 org uuid:='6013ed02-626a-497c-b951-619069035532'; actor uuid:=auth.uid(); p jsonb:=p_payload;
 previous private.web_commands%rowtype; canonical jsonb; result jsonb;
 recipe uuid; version uuid; output_item uuid; yield_unit uuid; base_unit uuid; loc uuid; locs uuid[]; category uuid; menu uuid;
 typ text:=p->>'type'; classification public.recipe_classification; stat public.recipe_status;
 qty numeric; waste numeric; yield_qty numeric; price numeric; x jsonb; item uuid; item_unit uuid; seq integer:=0;
begin
 if actor is null or not private.mfa_authorized() or not private.has_org_role(org,array['owner','admin','manager','chef']::public.member_role[]) then raise exception 'Recipe access denied' using errcode='42501';end if;
 if p_command_id is null or jsonb_typeof(p) is distinct from 'object' or typ is null or typ not in ('menu','prep','modifier') then raise exception 'Invalid recipe request';end if;
 canonical:=jsonb_build_object('kind','recipe','payload',p);
 perform pg_advisory_xact_lock(hashtextextended(p_command_id::text,0));
 select * into previous from private.web_commands where command_id=p_command_id;
 if found then
  if previous.actor<>actor or previous.payload<>canonical then raise exception 'Command ID already used';end if;
  return previous.result;
 end if;
 if nullif(btrim(p->>'name'),'') is null or length(p->>'name')>200 then raise exception 'Enter a recipe name (up to 200 characters)';end if;
 perform pg_advisory_xact_lock(hashtextextended(org::text||':recipe:'||lower(btrim(p->>'name')),0));
 if exists(select 1 from public.recipes where organization_id=org and lower(btrim(name))=lower(btrim(p->>'name'))) then raise exception 'A recipe with this name already exists';end if;
 stat:=(p->>'status')::public.recipe_status;
 if stat is null or stat not in ('draft','active') then raise exception 'Choose Draft or Active';end if;
 classification:=case typ when 'prep' then 'prep_recipe'::public.recipe_classification when 'modifier' then 'modifier_recipe'::public.recipe_classification else (p->>'classification')::public.recipe_classification end;
 if classification is null or (typ='menu' and classification not in ('dish_recipe','beverage')) then raise exception 'Invalid classification';end if;
 if jsonb_typeof(p->'locationIds') is distinct from 'array' then raise exception 'Invalid production locations';end if;
 select coalesce(array_agg(distinct value::uuid),'{}'::uuid[]) into locs from jsonb_array_elements_text(p->'locationIds');
 if typ='prep' and cardinality(locs)=0 then raise exception 'Select at least one production location';end if;
 foreach loc in array locs loop
  if loc is null or not private.can_location(loc) or not exists(select 1 from public.locations where id=loc and organization_id=org and active) then raise exception 'Select authorized production locations';end if;
 end loop;
 loc:=locs[1];
 yield_qty:=(p->>'yieldQuantity')::numeric;
 if yield_qty is null or yield_qty<=0 or yield_qty>100000000 then raise exception 'Enter a positive, finite yield';end if;
 if jsonb_typeof(p->'components') is distinct from 'array' or jsonb_array_length(p->'components')>300 or jsonb_typeof(p->'steps') is distinct from 'array' or jsonb_array_length(p->'steps')>100 then raise exception 'Invalid ingredients or instructions';end if;
 if stat='active' and jsonb_array_length(p->'components')=0 and not(typ='modifier' and coalesce(p->>'effect','')='none') then raise exception 'Active recipes need ingredients or packaging';end if;
 if typ='prep' then
  if p->>'outputItemId'='new' then
   base_unit:=(p->>'outputUnitId')::uuid;category:=(p->>'categoryId')::uuid;
   if not exists(select 1 from public.units where id=base_unit and (organization_id is null or organization_id=org)) or not exists(select 1 from public.inventory_categories where id=category and organization_id=org) then raise exception 'Select an output unit and inventory category';end if;
   insert into public.inventory_items(organization_id,internal_name,item_type,category_id,base_unit_id,description) values(org,btrim(p->>'name'),'prepared',category,base_unit,p->>'description') returning id into output_item;
   insert into public.inventory_item_units(organization_id,inventory_item_id,unit_id,quantity_in_base_unit,is_base_unit,is_count_unit) values(org,output_item,base_unit,1,true,true) returning id into yield_unit;
   insert into public.location_inventory_items(organization_id,inventory_item_id,location_id) select org,output_item,unnest(locs);
  else
   output_item:=nullif(p->>'outputItemId','')::uuid;yield_unit:=nullif(p->>'yieldItemUnitId','')::uuid;
   perform 1 from public.inventory_items where id=output_item and organization_id=org and item_type='prepared' and active for update;
   if not found or exists(select 1 from public.recipes where output_inventory_item_id=output_item) then raise exception 'Choose an available prepared item without an existing recipe';end if;
   if not exists(select 1 from public.inventory_item_units where id=yield_unit and inventory_item_id=output_item and organization_id=org) then raise exception 'Output unit does not belong to the prepared item';end if;
   if exists(select 1 from unnest(locs) l where not exists(select 1 from public.location_inventory_items where inventory_item_id=output_item and location_id=l and active)) then raise exception 'The prepared item is not assigned to this production location';end if;
  end if;
 end if;
 insert into public.recipes(organization_id,name,recipe_type,classification,output_inventory_item_id,production_location_id,description) values(org,btrim(p->>'name'),typ::public.recipe_type,classification,output_item,loc,p->>'description') returning id into recipe;
 insert into public.recipe_production_locations(organization_id,recipe_id,location_id) select org,recipe,unnest(locs);
 insert into public.recipe_versions(organization_id,recipe_id,version_number,status,yield_quantity,yield_item_unit_id,notes,created_by,effective_from) values(org,recipe,1,stat,yield_qty,yield_unit,p->>'notes',actor,case when stat='active' then now() end) returning id into version;
 for x in select value from jsonb_array_elements(p->'components') loop
  seq:=seq+1;item:=(x->>'itemId')::uuid;item_unit:=(x->>'itemUnitId')::uuid;qty:=(x->>'quantity')::numeric;waste:=(x->>'wastePercent')::numeric;
  if qty is null or qty<=0 or qty>100000000 or waste is null or waste<0 or waste>=100 then raise exception 'Invalid ingredient quantity or waste percentage';end if;
  if x->>'kind' is null or x->>'kind' not in ('ingredient','packaging') then raise exception 'Invalid ingredient type';end if;
  if item=output_item or not exists(select 1 from public.inventory_items where id=item and organization_id=org and active) or not exists(select 1 from public.inventory_item_units where id=item_unit and inventory_item_id=item and organization_id=org) then raise exception 'Invalid ingredient or unit';end if;
  -- An existing output cannot depend on itself through another prep recipe.
  if output_item is not null and exists(with recursive descendants(id,path) as (
   select item,array[item] union all
   select c.component_inventory_item_id,d.path||c.component_inventory_item_id from descendants d join public.recipes r on r.output_inventory_item_id=d.id and r.organization_id=org join public.recipe_versions v on v.recipe_id=r.id join public.recipe_components c on c.recipe_version_id=v.id where not c.component_inventory_item_id=any(d.path)
  )select 1 from descendants where id=output_item) then raise exception 'Ingredients create a circular recipe reference';end if;
  insert into public.recipe_components(organization_id,recipe_version_id,component_inventory_item_id,component_item_unit_id,quantity,waste_percent,sort_order,notes,component_type) values(org,version,item,item_unit,qty,waste/100,seq,x->>'notes',x->>'kind');
 end loop;
 seq:=0;
 for x in select value from jsonb_array_elements(p->'steps') loop
  if jsonb_typeof(x) is distinct from 'string' or nullif(btrim(x#>>'{}'),'') is null then raise exception 'Instructions cannot be blank';end if;
  seq:=seq+1;insert into public.recipe_steps(recipe_version_id,step_number,instructions) values(version,seq,x#>>'{}');
 end loop;
 if typ='menu' then
  category:=nullif(p->>'menuCategoryId','')::uuid;price:=nullif(p->>'sellingPrice','')::numeric;
  if category is not null and not exists(select 1 from public.menu_categories where id=category and organization_id=org) then raise exception 'Invalid menu category';end if;
  if price is not null and (price<0 or price>100000000) then raise exception 'Invalid selling price';end if;
  if exists(select 1 from public.menu_items where organization_id=org and lower(btrim(name))=lower(btrim(p->>'name'))) then raise exception 'A menu item with this name already exists';end if;
  insert into public.menu_items(organization_id,name,internal_name,description,recipe_id,category_id) values(org,btrim(p->>'name'),btrim(p->>'name'),p->>'description',recipe,category) returning id into menu;
  if loc is not null then insert into public.location_menu_items(organization_id,menu_item_id,location_id) select org,menu,unnest(locs);end if;
  if price is not null then insert into public.menu_item_prices(organization_id,menu_item_id,location_id,selling_price) values(org,menu,null,price);end if;
 elsif typ='modifier' then
  if p->>'effect' is null or p->>'effect' not in ('fixed_addition','fixed_removal','none') then raise exception 'Choose a modifier effect';end if;
  if p->>'effect'='none' and jsonb_array_length(p->'components')>0 then raise exception 'A modifier with no inventory effect cannot contain ingredients';end if;
  if exists(select 1 from public.modifiers where organization_id=org and lower(btrim(name))=lower(btrim(p->>'name'))) then raise exception 'A modifier with this name already exists';end if;
  insert into public.modifiers(organization_id,name,default_effect_type,default_recipe_id) values(org,btrim(p->>'name'),(p->>'effect')::public.modifier_effect_type,recipe);
 end if;
 result:=jsonb_build_object('id',recipe,'versionId',version,'outputItemId',output_item);
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,new_data) values(org,actor,'recipe.create','recipe',recipe,result);
 insert into private.web_commands(command_id,actor,payload,result) values(p_command_id,actor,canonical,result);
 return result;
end $$;
revoke all on function private.recipe_create(jsonb,uuid) from public,anon;
grant execute on function private.recipe_create(jsonb,uuid) to authenticated;
create or replace function public.recipe_create(p_payload jsonb,p_command_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.recipe_create(p_payload,p_command_id);$$;
revoke all on function public.recipe_create(jsonb,uuid) from public,anon;
grant execute on function public.recipe_create(jsonb,uuid) to authenticated;
notify pgrst,'reload schema';

;
