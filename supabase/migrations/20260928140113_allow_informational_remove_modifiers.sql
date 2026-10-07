CREATE OR REPLACE FUNCTION private.validate_modifier_recipe_rule()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $function$
begin
 if new.effect_type='none' then
  if new.recipe_id is not null or new.inventory_item_id is not null or new.item_unit_id is not null or coalesce(new.quantity,0)<>0 then
   raise exception 'Informational modifiers cannot target a recipe or inventory item';
  end if;
 else
  new.effect_type := case when new.action='remove' then 'fixed_removal'::public.modifier_effect_type else 'fixed_addition'::public.modifier_effect_type end;
 end if;
 if new.recipe_id is not null and not exists (select 1 from public.recipes r where r.id=new.recipe_id and r.classification='modifier_recipe') then
  raise exception 'Modifier rules require a Modifier Recipe';
 end if;
 return new;
end $function$;
;
