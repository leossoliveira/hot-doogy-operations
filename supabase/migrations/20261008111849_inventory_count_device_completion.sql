-- Preserve legacy day/period counts. New counts capture the device completion instant.
alter table public.store_count_observations add column counted_at timestamptz,
 add column device_utc_offset_minutes integer,
 add column employee_name text check (char_length(employee_name)<=80);
alter table public.store_count_observations alter column moment drop not null;
alter table public.store_count_observations add constraint store_count_completion_valid check (
 (counted_at is null and device_utc_offset_minutes is null and moment is not null)
 or (counted_at is not null and isfinite(counted_at) and device_utc_offset_minutes is not null
 and device_utc_offset_minutes between -840 and 840
 and counted_on = ((counted_at at time zone 'UTC') - device_utc_offset_minutes * interval '1 minute')::date)
);
-- Patch only the count INSERT; retain all existing authorization and other commands.
do $migration$
declare definition text; old_insert text := $old$insert into public.store_count_observations(id,organization_id,location_id,inventory_item_id,item_unit_id,quantity,quantity_base,counted_on,moment,session_id,created_by) values(gen_random_uuid(),org,loc,item,u.id,quantity,quantity*u.quantity_in_base_unit,(p->>'date')::date,p->>'moment',id,actor);$old$;
 new_insert text := $new$insert into public.store_count_observations(id,organization_id,location_id,inventory_item_id,item_unit_id,quantity,quantity_base,counted_on,moment,session_id,created_by,counted_at,device_utc_offset_minutes,employee_name) values(gen_random_uuid(),org,loc,item,u.id,quantity,quantity*u.quantity_in_base_unit,(p->>'date')::date,case when p->>'countedAt' is not null then null else p->>'moment' end,id,actor,(p->>'countedAt')::timestamptz,(p->>'countOffsetMinutes')::integer,nullif(btrim(p->>'employeeName'),''));$new$;
begin
 definition := pg_get_functiondef('private.web_operation(text,jsonb)'::regprocedure);
 if strpos(definition,old_insert)=0 then raise exception 'Unexpected count command definition'; end if;
 execute replace(definition,old_insert,new_insert);
end $migration$;
notify pgrst,'reload schema';
