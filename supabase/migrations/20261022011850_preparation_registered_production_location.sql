-- The multi-location table was removed by 20261007012945; use the
-- production location persisted on recipes. Keep all other atomic checks.
do $migration$
declare definition text;
 old_clause constant text := 'and (r.production_location_id=loc or exists(select 1 from public.recipe_production_locations l where l.recipe_id=r.id and l.location_id=loc and l.organization_id=org))';
begin
 definition := pg_get_functiondef('private.complete_preparation(jsonb,uuid)'::regprocedure);
 if position(old_clause in definition)=0 then
  raise exception 'Unexpected preparation function; review required';
 end if;
 execute replace(definition,old_clause,'and r.production_location_id=loc');
end $migration$;
