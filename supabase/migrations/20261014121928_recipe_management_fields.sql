-- Recipe management: prep recipes keep an optional shelf life in whole days, and the recipe save command can
-- also update the recipe name, the new version's yield and the prep item's unit conversions.
-- Every new key is optional. An absent key leaves the stored value unchanged.
alter table public.recipes add column if not exists use_by_days integer;
alter table public.recipes drop constraint if exists recipes_use_by_days_range;
alter table public.recipes add constraint recipes_use_by_days_range check (use_by_days is null or use_by_days between 1 and 365);

do $migration$
declare definition text; occurrences integer;
anchor text := $a$insert into public.recipe_steps(recipe_version_id,step_number,title,instructions,media_path) select version_id,step_number,title,instructions,media_path from public.recipe_steps where recipe_version_id=old_recipe.id;$a$;
addition text := $n$
  select output_inventory_item_id into item from public.recipes where recipes.id=id and organization_id=org;
  if p ? 'name' then
   if jsonb_typeof(p->'name') is distinct from 'string' or length(btrim(p->>'name')) not between 1 and 120 then raise exception 'Nome inválido.';end if;
   update public.recipes set name=btrim(p->>'name'),updated_at=now() where recipes.id=id and organization_id=org;
   if item is not null then update public.inventory_items set name=btrim(p->>'name') where inventory_items.id=item and organization_id=org;end if;
  end if;
  if p ? 'useByDays' then
   if jsonb_typeof(p->'useByDays') not in ('number','null') or (jsonb_typeof(p->'useByDays')='number' and ((p->>'useByDays')::numeric<>trunc((p->>'useByDays')::numeric) or (p->>'useByDays')::numeric not between 1 and 365)) then raise exception 'Validade inválida.';end if;
   update public.recipes set use_by_days=(p->>'useByDays')::numeric::integer,updated_at=now() where recipes.id=id and organization_id=org;
  end if;
  if p ? 'units' then
   if item is null then raise exception 'Receita sem item de produção.';end if;
   if jsonb_typeof(p->'units') is distinct from 'array' or jsonb_array_length(p->'units')>50 then raise exception 'Conversões inválidas.';end if;
   for x in select value from jsonb_array_elements(p->'units') loop
    quantity:=(x->>'factor')::numeric;if quantity is null or quantity<=0 or quantity>100000000 then raise exception 'Conversão inválida.';end if;
    if not exists(select 1 from public.units where units.id=(x->>'unitId')::uuid and (organization_id is null or organization_id=org)) then raise exception 'Unidade inválida.';end if;
    select * into u from public.inventory_item_units where inventory_item_id=item and unit_id=(x->>'unitId')::uuid and organization_id=org for update;
    if found then
     if u.is_base_unit and quantity<>1 then raise exception 'A unidade-base deve ter fator 1.';end if;
     update public.inventory_item_units set quantity_in_base_unit=quantity where inventory_item_units.id=u.id;
    else
     insert into public.inventory_item_units(organization_id,inventory_item_id,unit_id,quantity_in_base_unit,is_base_unit,is_count_unit) values(org,item,(x->>'unitId')::uuid,quantity,false,false);
    end if;
   end loop;
  end if;
  if p ? 'yieldQuantity' or p ? 'yieldUnitId' then
   quantity:=(p->>'yieldQuantity')::numeric;if quantity is null or quantity<=0 or quantity>100000000 then raise exception 'Rendimento inválido.';end if;
   select * into u from public.inventory_item_units where inventory_item_id=item and unit_id=(p->>'yieldUnitId')::uuid and organization_id=org;
   if item is null or not found then raise exception 'Unidade de rendimento inválida.';end if;
   update public.recipe_versions set yield_quantity=quantity,yield_item_unit_id=u.id where recipe_versions.id=version_id;
  end if;$n$;
begin
 definition:=pg_get_functiondef('private.web_operation(text,jsonb)'::regprocedure);
 if position('useByDays' in definition)>0 then raise exception 'Recipe management already installed';end if;
 occurrences:=(length(definition)-length(replace(definition,anchor,'')))/length(anchor);
 if occurrences<>1 then raise exception 'Unexpected recipe edit command';end if;
 execute replace(definition,anchor,anchor||addition);
end $migration$;
notify pgrst,'reload schema';
