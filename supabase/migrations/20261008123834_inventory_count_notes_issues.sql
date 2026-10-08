-- Keep count notes and per-item reports in the existing authorized audit record.
-- The command and quantities commit atomically; no new public write surface is added.
do $migration$
declare definition text;
 old_guard text := $old$if jsonb_typeof(p->'lines') is distinct from 'array' or jsonb_array_length(p->'lines') not between 1 and 500 then raise exception 'Contagem vazia.';end if;$old$;
 new_guard text := $new$if jsonb_typeof(p->'lines') is distinct from 'array' or jsonb_array_length(p->'lines') not between 1 and 500 then raise exception 'Contagem vazia.';end if;
  if p ? 'notes' and (jsonb_typeof(p->'notes')<>'string' or char_length(p->>'notes')>4000) then raise exception 'Invalid count notes.';end if;
  if p ? 'issues' then
   if jsonb_typeof(p->'issues')<>'array' or jsonb_array_length(p->'issues')>500 then raise exception 'Invalid count issues.';end if;
   for x in select value from jsonb_array_elements(p->'issues') loop
    if jsonb_typeof(x->'text') is distinct from 'string' or char_length(btrim(x->>'text')) not between 1 and 2000 or not exists(select 1 from public.location_inventory_items li join public.inventory_item_units iu on iu.inventory_item_id=li.inventory_item_id where li.inventory_item_id=(x->>'itemId')::uuid and li.location_id=loc and li.active and iu.organization_id=org) then raise exception 'Invalid count issue item or text.';end if;
   end loop;
  end if;$new$;
 old_audit text := $old$jsonb_build_object('saved_at',now())$old$;
 new_audit text := $new$jsonb_build_object('saved_at',now()) || case when p_action='counts' then jsonb_build_object('notes',coalesce(p->>'notes',''),'issues',coalesce(p->'issues','[]'::jsonb),'locationId',loc) else '{}'::jsonb end$new$;
begin
 definition:=pg_get_functiondef('private.web_operation(text,jsonb)'::regprocedure);
 if strpos(definition,old_guard)=0 or strpos(definition,old_audit)=0 then raise exception 'Unexpected count command definition';end if;
 execute replace(replace(definition,old_guard,new_guard),old_audit,new_audit);
end $migration$;
notify pgrst,'reload schema';
