-- Each successful edit becomes the only active version. Historical composition is retained.
do $migration$
declare definition text; old_insert text := $old$insert into public.recipe_versions(organization_id,recipe_id,version_number,status,yield_quantity,yield_item_unit_id,notes,created_by) values(org,id,old_recipe.version_number+1,'draft',old_recipe.yield_quantity,old_recipe.yield_item_unit_id,'Composição editada no aplicativo.',actor) returning recipe_versions.id into version_id;$old$;
new_insert text := $new$update public.recipe_versions set status='archived',effective_to=greatest(clock_timestamp(),effective_from+interval '1 microsecond') where recipe_id=id and organization_id=org and status='active';
  insert into public.recipe_versions(organization_id,recipe_id,version_number,status,effective_from,yield_quantity,yield_item_unit_id,notes,created_by) values(org,id,old_recipe.version_number+1,'active',clock_timestamp(),old_recipe.yield_quantity,old_recipe.yield_item_unit_id,'Composição editada no aplicativo.',actor) returning recipe_versions.id into version_id;$new$;
begin
 definition:=pg_get_functiondef('private.web_operation(text,jsonb)'::regprocedure);
 if position(old_insert in definition)=0 then raise exception 'Unexpected recipe edit command';end if;
 execute replace(definition,old_insert,new_insert);
end $migration$;
notify pgrst,'reload schema';
